import { AGENT_NAMES, type AgentName, type AgentUsage, type UsageResponse, type UsageWindow } from '@/lib/contract';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { spawnCli } from './exec';

// 개발 서버가 모듈을 다시 읽어도 마지막 Claude 값이 사라지지 않게 globalThis에 둔다.
const g = globalThis as typeof globalThis & { __sddmakerUsage?: { claude: AgentUsage | null } };
const store: { claude: AgentUsage | null } = (g.__sddmakerUsage ??= { claude: null });

// Codex 읽기는 동시에 하나만 돈다. 같은 시점의 요청은 그 결과를 함께 받는다.
let codexInFlight: Promise<AgentUsage> | null = null;

const emptyUsage = (): AgentUsage => ({ fiveHour: null, weekly: null, readAt: null });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 사용률은 0..100 정수, 리셋 시각(초)은 ISO 문자열로 바꾼다. 숫자가 아니면 null.
export function toWindow(percent: unknown, resetsAtSec: unknown): UsageWindow | null {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
  if (typeof resetsAtSec !== 'number' || !Number.isFinite(resetsAtSec)) return null;
  const at = new Date(resetsAtSec * 1000);
  if (Number.isNaN(at.getTime())) return null; // 날짜 범위를 넘으면 toISOString이 던진다
  return { usedPercent: Math.min(100, Math.max(0, Math.round(percent))), resetsAt: at.toISOString() };
}

// utilization은 0..1 비율이다. 없으면 NaN을 넘겨 null이 되게 한다 (null * 100은 0이라 가짜 0%가 된다).
function claudeWindow(w: unknown): UsageWindow | null {
  if (!isRecord(w)) return null;
  return toWindow(typeof w.utilization === 'number' ? w.utilization * 100 : NaN, w.resetsAt);
}

// 창이 여러 개면 unifiedWindows를 쓰고, 없으면 rateLimitType이 가리키는 창 하나만 읽는다.
export function recordClaudeRateLimit(ev: unknown): void {
  const info = isRecord(ev) ? ev.rate_limit_info : null;
  if (!isRecord(info)) return;
  const windows = isRecord(info.unifiedWindows) ? info.unifiedWindows : { [String(info.rateLimitType)]: info };
  const fiveHour = claudeWindow(windows.five_hour);
  const weekly = claudeWindow(windows.seven_day);
  if (!fiveHour && !weekly) return;
  const prev = store.claude ?? emptyUsage();
  store.claude = {
    fiveHour: fiveHour ?? prev.fiveHour,
    weekly: weekly ?? prev.weekly,
    readAt: new Date().toISOString(),
  };
}

// 5시간 창은 1440분 이하, 그보다 길면 주간 창이다. 같은 칸에 둘이 오면 값이 깨졌어도 primary가 차지한다.
function codexUsage(rateLimits: Record<string, unknown>): AgentUsage {
  const out: AgentUsage = { fiveHour: null, weekly: null, readAt: new Date().toISOString() };
  const taken = new Set<string>();
  for (const w of [rateLimits.primary, rateLimits.secondary]) {
    if (!isRecord(w) || typeof w.windowDurationMins !== 'number' || !Number.isFinite(w.windowDurationMins)) continue;
    const slot = w.windowDurationMins <= 1440 ? 'fiveHour' : 'weekly';
    if (taken.has(slot)) continue;
    taken.add(slot);
    out[slot] = toWindow(w.usedPercent, w.resetsAt);
  }
  return out;
}

function readCodexOnce(timeoutMs: number): Promise<AgentUsage> {
  const ac = new AbortController();
  return new Promise<AgentUsage>((resolve) => {
    spawnCli('codex', ['app-server'], {
      signal: ac.signal,
      timeoutMs,
      onCodeInput: (submit) => {
        // 응답을 기다리지 않고 세 줄을 한 번에 쓴다. stdin을 닫으면 app-server가 끝나므로 close는 false.
        for (const msg of [
          { id: 1, method: 'initialize', params: { clientInfo: { name: 'sddmaker', title: null, version: '0.1' } } },
          { method: 'initialized' },
          { id: 2, method: 'account/rateLimits/read' },
        ]) submit(JSON.stringify(msg), false);
      },
      onLine: (line) => {
        try {
          const msg = JSON.parse(line) as { id?: unknown; result?: { rateLimits?: unknown } };
          if (msg.id !== 2) return;
          // 오류 응답도 여기서 빈 값으로 끝낸다. 시간 초과까지 기다리지 않는다.
          const rl = msg.result?.rateLimits;
          resolve(isRecord(rl) ? codexUsage(rl) : emptyUsage());
          ac.abort();
        } catch {
          // JSON이 아니거나 모양이 다른 줄은 무시한다. 출력 원문은 로그에 남기지 않는다.
        }
      },
    })
      // 정상 종료·취소·시간 초과·실행 파일 없음 모두 여기서 끝낸다. 자식 정리는 spawnCli가 맡는다.
      .catch(() => {})
      .then(() => resolve(emptyUsage()));
  });
}

// 같은 시점의 요청은 하나의 app-server 호출을 함께 받는다.
export function readCodexUsage(timeoutMs = 10_000): Promise<AgentUsage> {
  if (!codexInFlight) codexInFlight = readCodexOnce(timeoutMs).finally(() => { codexInFlight = null; });
  return codexInFlight;
}

// index의 getAdapter를 거치지 않는다: claude.ts가 먼저 로드되면 index의 어댑터 표가 비어 버린다 (순환 import).
async function usageOf(agent: AgentName): Promise<AgentUsage | null> {
  const adapter = agent === 'claude' ? claudeAdapter : codexAdapter;
  let s;
  try {
    s = await adapter.status();
  } catch (e) {
    console.error(`agent usage failed: ${agent} ${e instanceof Error ? e.name : 'unknown'}`);
    return null; // 확인에 실패했을 뿐이므로 저장된 Claude 값은 그대로 둔다
  }
  if (!(s.loggedIn && s.subscription)) {
    if (agent === 'claude') store.claude = null; // 이전 계정의 값이 남지 않게 한다
    return null;
  }
  return agent === 'claude' ? (store.claude ?? emptyUsage()) : readCodexUsage();
}

export async function getUsage(): Promise<UsageResponse> {
  const entries = await Promise.all(AGENT_NAMES.map(async (a) => [a, await usageOf(a)] as const));
  return Object.fromEntries(entries) as UsageResponse;
}

// 테스트 전용: 저장된 Claude 값과 진행 중인 Codex 읽기를 비운다.
export function resetUsageForTest(): void {
  store.claude = null;
  codexInFlight = null;
}
