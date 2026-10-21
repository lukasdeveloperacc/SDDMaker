import type { LoginTarget, RunKind } from '@/lib/contract';
import { randomUUID } from 'node:crypto';

interface RunEntry {
  kind: RunKind;
  path: string | null;
  controller: AbortController;
  released: Promise<void>;
  markReleased: () => void;
}

interface LoginEntry {
  controller: AbortController;
  id: string;
  submit?: (text: string, close?: boolean) => boolean;
  terminal?: { write(data: string): boolean; resize(cols: number, rows: number): boolean };
  released: Promise<void>;
  markReleased: () => void;
}

interface RuntimeState {
  runs: Map<number, RunEntry>;
  logins: Map<LoginTarget, LoginEntry>;
}

// 개발 서버가 모듈을 다시 읽어도 실행 잠금과 자식 목록이 사라지지 않게 globalThis에 둔다.
const g = globalThis as typeof globalThis & { __sddmakerRuntime?: RuntimeState };
const state: RuntimeState = (g.__sddmakerRuntime ??= { runs: new Map(), logins: new Map() });

export interface RunHandle {
  projectId: number;
  kind: RunKind;
  path: string | null;
  controller: AbortController;
  release(): void;
}

export function acquireRun(projectId: number, kind: RunKind, path: string | null): RunHandle | null {
  if (state.runs.has(projectId)) return null;
  const controller = new AbortController();
  let markReleased!: () => void;
  const released = new Promise<void>((resolve) => { markReleased = resolve; });
  const entry: RunEntry = { kind, path, controller, released, markReleased };
  state.runs.set(projectId, entry);

  let done = false;
  return {
    projectId,
    kind,
    path,
    controller,
    release() {
      if (done) return;
      done = true;
      if (state.runs.get(projectId) === entry) state.runs.delete(projectId);
      markReleased();
    },
  };
}

export function getRun(projectId: number): { kind: RunKind; path: string | null } | null {
  const entry = state.runs.get(projectId);
  return entry ? { kind: entry.kind, path: entry.path } : null;
}

// 취소 신호를 보내고, 실행 잠금이 풀릴 때까지 최대 waitMs 기다린다.
export async function cancelRun(projectId: number, waitMs = 5000): Promise<void> {
  const entry = state.runs.get(projectId);
  if (!entry) return;
  entry.controller.abort();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); });
  await Promise.race([entry.released, timeout]);
  clearTimeout(timer);
}

export function acquireLogin(agent: LoginTarget): AbortController | null {
  if (state.logins.has(agent)) return null;
  const controller = new AbortController();
  let markReleased!: () => void;
  const released = new Promise<void>((resolve) => { markReleased = resolve; });
  state.logins.set(agent, { controller, id: randomUUID(), released, markReleased });
  return controller;
}

export function releaseLogin(agent: LoginTarget, controller: AbortController): void {
  const entry = state.logins.get(agent);
  if (entry?.controller !== controller) return;
  state.logins.delete(agent);
  entry.markReleased();
}

export function isLoginRunning(agent: LoginTarget): boolean {
  return state.logins.has(agent);
}

// 204를 받은 화면이 즉시 새 로그인을 시작할 수 있도록 자식 종료와 잠금 해제를 기다린다.
export async function cancelLogin(agent: LoginTarget, waitMs = 5000): Promise<boolean> {
  const entry = state.logins.get(agent);
  if (!entry) return true;
  entry.controller.abort();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      entry.released.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), waitMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function setLoginCodeInput(agent: LoginTarget, controller: AbortController, submit: (text: string, close?: boolean) => boolean): string | null {
  const entry = state.logins.get(agent);
  if (!entry || entry.controller !== controller || controller.signal.aborted) return null;
  entry.submit = submit;
  return entry.id;
}

export function submitLoginCode(agent: LoginTarget, id: string, code: string): boolean {
  const entry = state.logins.get(agent);
  if (!entry || entry.id !== id || entry.controller.signal.aborted || !entry.submit) return false;
  if (!entry.submit(code)) return false;
  // 한 세션에 한 줄만 보낸다. 이전 요청의 재전송이 다음 입력으로 넘어가지 않게 한다.
  entry.submit = undefined;
  return true;
}

export function writeLoginInput(agent: LoginTarget, id: string, input: string): boolean {
  const entry = state.logins.get(agent);
  if (!entry || entry.id !== id || entry.controller.signal.aborted || !entry.submit) return false;
  return entry.submit(input, false);
}

export function setLoginTerminal(agent: LoginTarget, controller: AbortController, terminal: NonNullable<LoginEntry['terminal']>): string | null {
  const entry = state.logins.get(agent);
  if (!entry || entry.controller !== controller || controller.signal.aborted) return null;
  entry.terminal = terminal;
  return entry.id;
}

export function loginTerminal(agent: LoginTarget, id: string): LoginEntry['terminal'] {
  const entry = state.logins.get(agent);
  return entry?.id === id && !entry.controller.signal.aborted ? entry.terminal : undefined;
}

// 자식 프로세스 그룹(pgid = 자식 pid)을 추적한다. 앱이 꺼질 때 남은 CLI를 끝내려고 쓴다.
const pgids = ((g as { __sddmakerPgids?: Set<number> }).__sddmakerPgids ??= new Set<number>());
const EXIT_GRACE_MS = 1000;

export function trackChild(pid: number): void {
  pgids.add(pid);
  installExitCleanup();
}

export function untrackChild(pid: number): void {
  pgids.delete(pid);
}

function signalGroups(sig: NodeJS.Signals): void {
  for (const pid of pgids) {
    try {
      process.kill(-pid, sig);
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        // 이미 끝난 프로세스
      }
    }
  }
}

// 한 번만 등록한다 (개발 서버 재로딩으로 핸들러가 쌓이지 않게 globalThis 표시를 쓴다).
function installExitCleanup(): void {
  const hooks = g as { __sddmakerExitHooked?: boolean };
  if (hooks.__sddmakerExitHooked) return;
  hooks.__sddmakerExitHooked = true;

  // exit 핸들러는 동기여야 하므로 바로 SIGKILL한다.
  process.on('exit', () => signalGroups('SIGKILL'));

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    const onSignal = () => {
      // 우리 핸들러를 떼고 다시 보내서 기본 동작(종료)이 일어나게 한다.
      process.off(sig, onSignal);
      signalGroups('SIGTERM');
      setTimeout(() => {
        signalGroups('SIGKILL');
        process.kill(process.pid, sig);
      }, EXIT_GRACE_MS);
    };
    process.on(sig, onSignal);
  }
}
