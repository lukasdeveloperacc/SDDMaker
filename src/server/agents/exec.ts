import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { AgentName, AgentErrorCode } from '@/lib/contract';
import { agentWorkdir, cliPath, claudeHome, codexHome } from '../env';
import { trackChild, untrackChild } from '../runtime';

export class AgentError extends Error {
  constructor(public code: AgentErrorCode, message: string) {
    super(message);
    this.name = 'AgentError';
  }
}

// 실행이 응답 시간 안에 끝나지 않았다. 재시도 판단에서 일반 agent_failed와 구분한다.
export class RunTimeoutError extends AgentError {
  constructor() {
    super('agent_failed', '응답 시간이 초과되었습니다');
    this.name = 'RunTimeoutError';
  }
}

// 생성·인터뷰 한 번의 실행 상한. 넘으면 프로세스 그룹을 끝내고 RunTimeoutError.
export const RUN_TIMEOUT_MS = 10 * 60_000;

// 구독 대신 API 키·다른 과금 경로로 실행되지 않게 자식 환경에서 지운다.
export const STRIPPED_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_BASE_URL',
] as const;

const STDERR_TAIL_BYTES = 4096;
const KILL_GRACE_MS = 2000;

export interface SpawnResult { code: number | null; stderr: string }

// 자식이 띄운 손자 프로세스까지 함께 끝내려고 자식 그룹 전체에 신호를 보낸다.
// 그룹에 보내지 못하면 자식에게만 보낸다.
function signalGroup(child: ChildProcess, sig: NodeJS.Signals) {
  if (child.pid) {
    try {
      process.kill(-child.pid, sig);
      return;
    } catch {
      // 그룹이 이미 없으면 아래에서 자식만 확인한다
    }
  }
  child.kill(sig);
}

export function childEnv(agent: AgentName): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of STRIPPED_ENV) delete env[k];
  if (agent === 'claude') env.CLAUDE_CONFIG_DIR = claudeHome();
  if (agent === 'codex') env.CODEX_HOME = codexHome();
  return env;
}

export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

// 셸을 거치지 않는다. 자식이 끝나거나 취소·시간 초과로 죽은 뒤에 resolve/reject한다.
export function spawnCli(agent: AgentName, args: string[], opts: {
  stdin?: string;
  signal: AbortSignal;
  onLine?: (line: string) => void;
  onStderrLine?: (line: string) => void; // 로그인 안내가 표준 오류로 나올 때 쓴다
  timeoutMs?: number;
  timeoutError?: Error; // 시간 초과 시 reject할 오류는 부르는 쪽이 정한다
}): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    // detached: 자식이 새 프로세스 그룹의 대장이 되어 손자 프로세스를 함께 끌 수 있다.
    const child = spawn(cliPath(agent), args, {
      cwd: agentWorkdir(),
      env: childEnv(agent),
      stdio: 'pipe',
      detached: true,
    });
    let settled = false;
    let stderr = Buffer.alloc(0);
    let lineBuf = '';
    let errLineBuf = '';
    const errDecoder = new StringDecoder('utf8');
    let failure: Error | null = null;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      opts.signal.removeEventListener('abort', onAbort);
      fn();
    };

    // 자식이 끝났으면 SIGKILL이 필요 없다. 살아 있을 때만 죽인다.
    const stop = (reason: Error) => {
      if (failure) return;
      failure = reason;
      signalGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), KILL_GRACE_MS);
    };
    const onAbort = () => stop(new DOMException('Aborted', 'AbortError'));
    const timer = opts.timeoutMs
      ? setTimeout(() => stop(opts.timeoutError ?? new AgentError('agent_failed', '시간 초과')), opts.timeoutMs)
      : undefined;
    opts.signal.addEventListener('abort', onAbort, { once: true });

    // 자식이 입력을 읽기 전에 끝나면 EPIPE가 나는데, 서버 프로세스가 죽지 않게 삼킨다.
    child.stdin.on('error', () => {});
    child.stdin.end(opts.stdin ?? '');

    const emitLine = (line: string) => opts.onLine?.(line.endsWith('\r') ? line.slice(0, -1) : line);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!opts.onLine) return;
      lineBuf += chunk;
      let i: number;
      while ((i = lineBuf.indexOf('\n')) !== -1) {
        emitLine(lineBuf.slice(0, i));
        lineBuf = lineBuf.slice(i + 1);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > STDERR_TAIL_BYTES) stderr = stderr.subarray(-STDERR_TAIL_BYTES);
      if (opts.onStderrLine) {
        errLineBuf += errDecoder.write(chunk);
        let i: number;
        while ((i = errLineBuf.indexOf('\n')) !== -1) {
          opts.onStderrLine(errLineBuf.slice(0, i).replace(/\r$/, ''));
          errLineBuf = errLineBuf.slice(i + 1);
        }
      }
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      signalGroup(child, 'SIGKILL');
      const mapped = err.code === 'ENOENT' || err.code === 'EACCES'
        ? new AgentError('cli_not_found', '실행 파일을 찾을 수 없습니다')
        : new AgentError('agent_failed', '실행에 실패했습니다');
      finish(() => reject(mapped));
    });

    // 자식이 끝난 뒤에도 그룹에 남은 손자가 stdout을 쥐고 있으면 close가 안 온다. 남은 그룹을 정리한다.
    if (child.pid) trackChild(child.pid);
    child.on('exit', () => {
      signalGroup(child, 'SIGKILL');
      if (child.pid) untrackChild(child.pid);
    });

    child.on('close', (code) => {
      if (lineBuf && opts.onLine) emitLine(lineBuf);
      lineBuf = '';
      errLineBuf += errDecoder.end();
      if (errLineBuf && opts.onStderrLine) opts.onStderrLine(errLineBuf);
      errLineBuf = '';
      finish(() => {
        if (failure) reject(failure);
        else resolve({ code, stderr: stderr.toString('utf8') });
      });
    });
  });
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const URL_RE = /https?:\/\/[^\s"'<>]+/;
const CODE_RE = /\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/;

// 로그인 CLI를 실행하고 URL·코드 안내를 onPrompt로 넘긴다. 출력 원문은 저장하거나 로그에 남기지 않는다.
export async function runLogin(agent: AgentName, args: string[], i: {
  onPrompt: (p: { url: string; code?: string }) => void;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<void> {
  let url: string | null = null;
  let code: string | undefined;
  const scan = (raw: string) => {
    const line = raw.replace(ANSI_RE, '');
    const u = line.match(URL_RE);
    const c = line.match(CODE_RE);
    const prevUrl = url;
    const prevCode = code;
    if (u) url = u[0];
    if (c) code = c[0];
    if (url && (url !== prevUrl || code !== prevCode)) i.onPrompt(code ? { url, code } : { url });
  };
  try {
    const result = await spawnCli(agent, args, {
      stdin: '',
      signal: i.signal,
      onLine: scan,
      onStderrLine: scan,
      timeoutMs: i.timeoutMs ?? 600_000,
      timeoutError: new AgentError('login_failed', '시간 초과'),
    });
    if (result.code !== 0) throw new AgentError('login_failed', '로그인에 실패했습니다');
  } catch (e) {
    if (e instanceof AgentError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new AgentError('login_failed', '로그인이 취소되었습니다');
    throw e;
  }
}
