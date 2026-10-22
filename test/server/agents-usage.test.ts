import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentUsage, UsageWindow } from '@/lib/contract';
import { GET } from '@/app/api/agents/usage/route';
import { claudeAdapter } from '@/server/agents/claude';
import { codexAdapter } from '@/server/agents/codex';
import { parseClaudeUsage, readClaudeUsage, readCodexUsage, recordClaudeRateLimit, resetUsageForTest, toWindow } from '@/server/agents/usage';
import { dataDir } from '@/server/env';

const HOUR = 3600;
const DAY = 86400;
// 고정 리셋 시각(유닉스 초). 저장값을 정확히 비교하려고 쓴다.
const RESET_5H = 1_800_000_000;
const RESET_7D = 1_800_500_000;
const ISO_AT = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

const g = globalThis as typeof globalThis & { __sddmakerUsage?: { claude?: AgentUsage | null } };
const claudeStore = (): AgentUsage | null => g.__sddmakerUsage?.claude ?? null;
const iso = (sec: number) => new Date(sec * 1000).toISOString();
const signal = () => new AbortController().signal;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claudeEvent(rateLimitInfo: unknown) {
  return { type: 'rate_limit_event', rate_limit_info: rateLimitInfo };
}

function validEvent() {
  return claudeEvent({
    unifiedWindows: {
      five_hour: { utilization: 0.45, resetsAt: RESET_5H },
      seven_day: { utilization: 0.38, resetsAt: RESET_7D },
    },
  });
}

// 가짜 CLI는 응답 시각(before~after 사이)을 기준으로 리셋 시각을 만든다. 그래서 범위로 확인한다.
function expectResetsIn(resetsAt: string, offsetSec: number, before: number, after: number) {
  const ms = Date.parse(resetsAt);
  expect(ms).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 + offsetSec * 1000);
  expect(ms).toBeLessThanOrEqual(Math.floor(after / 1000) * 1000 + offsetSec * 1000);
}

function expectReadAt(readAt: string | null, before: number, after: number) {
  expect(readAt).not.toBeNull();
  expect(Date.parse(readAt!)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(readAt!)).toBeLessThanOrEqual(after);
}

// 기대값: 퍼센트와, 응답 시각부터 리셋까지의 초. null이면 그 창은 없어야 한다.
type Want = { usedPercent: number; offsetSec: number } | null;

function expectWindow(w: UsageWindow | null, want: Want, before: number, after: number) {
  if (want === null) {
    expect(w).toBeNull();
    return;
  }
  expect(w).toEqual({ usedPercent: want.usedPercent, resetsAt: expect.any(String) });
  expectResetsIn(w!.resetsAt, want.offsetSec, before, after);
}

// 자식 pid는 FAKE_PID_FILE로 받는다. 테스트마다 새 파일을 쓴다.
function pidFileFor(name: string) {
  const file = path.join(dataDir(), `pid-usage-${name}`);
  fs.rmSync(file, { force: true });
  process.env.FAKE_PID_FILE = file;
  return file;
}

// 앱이 자식을 끝내는 것은 응답 뒤(SIGTERM)에 일어나므로 잠시 기다렸다가 확인한다.
async function expectChildExits(pidFile: string) {
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  const started = Date.now();
  while (alive(pid) && Date.now() - started < 2500) await sleep(25);
  expect(alive(pid)).toBe(false);
}

beforeEach(() => {
  resetUsageForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toWindow', () => {
  it('유한한 숫자만 받고 퍼센트는 정수 0..100으로 맞춘다', () => {
    expect(toWindow(null, RESET_5H)).toBeNull();
    expect(toWindow(45, 'x')).toBeNull();
    expect(toWindow(45, Infinity)).toBeNull();
    expect(toWindow(7.6, RESET_5H)).toEqual({ usedPercent: 8, resetsAt: iso(RESET_5H) });
    expect(toWindow(104, RESET_5H)).toEqual({ usedPercent: 100, resetsAt: iso(RESET_5H) });
    expect(toWindow(-3, RESET_5H)).toEqual({ usedPercent: 0, resetsAt: iso(RESET_5H) });
  });
});

describe('Claude rate_limit_event 해석', () => {
  it('unifiedWindows의 five_hour는 5시간, seven_day는 주간으로 넣는다', () => {
    recordClaudeRateLimit(validEvent());
    expect(claudeStore()).toEqual({
      fiveHour: { usedPercent: 45, resetsAt: iso(RESET_5H) },
      weekly: { usedPercent: 38, resetsAt: iso(RESET_7D) },
      readAt: ISO_AT,
    });
  });

  it('unifiedWindows가 없으면 최상위 rateLimitType으로 한 창만 넣는다', () => {
    recordClaudeRateLimit(claudeEvent({ rateLimitType: 'five_hour', utilization: 0.3, resetsAt: RESET_5H }));
    expect(claudeStore()).toMatchObject({ fiveHour: { usedPercent: 30, resetsAt: iso(RESET_5H) }, weekly: null });
    recordClaudeRateLimit(claudeEvent({ rateLimitType: 'seven_day', utilization: 0.6, resetsAt: RESET_7D }));
    expect(claudeStore()).toMatchObject({
      fiveHour: { usedPercent: 30 },
      weekly: { usedPercent: 60, resetsAt: iso(RESET_7D) },
    });
  });

  it('이벤트에 없는 창은 이전 값을 유지한다', () => {
    recordClaudeRateLimit(validEvent());
    recordClaudeRateLimit(claudeEvent({ unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: RESET_5H + 600 } } }));
    expect(claudeStore()).toMatchObject({
      fiveHour: { usedPercent: 50, resetsAt: iso(RESET_5H + 600) },
      weekly: { usedPercent: 38, resetsAt: iso(RESET_7D) },
    });
  });

  it('퍼센트는 반올림하고 0..100 범위로 자른다', () => {
    recordClaudeRateLimit(claudeEvent({
      unifiedWindows: {
        five_hour: { utilization: 0.456, resetsAt: RESET_5H },
        seven_day: { utilization: 1.5, resetsAt: RESET_7D },
      },
    }));
    expect(claudeStore()).toMatchObject({ fiveHour: { usedPercent: 46 }, weekly: { usedPercent: 100 } });
    recordClaudeRateLimit(claudeEvent({ unifiedWindows: { five_hour: { utilization: -0.2, resetsAt: RESET_5H } } }));
    expect(claudeStore()).toMatchObject({ fiveHour: { usedPercent: 0 } });
  });

  it.each([
    ['ev가 null', null],
    ['rate_limit_info가 문자열', { type: 'rate_limit_event', rate_limit_info: 'oops' }],
    ['unifiedWindows의 utilization이 null', claudeEvent({ unifiedWindows: { five_hour: { utilization: null, resetsAt: RESET_5H } } })],
    ['최상위 utilization이 null', claudeEvent({ rateLimitType: 'five_hour', utilization: null, resetsAt: RESET_5H })],
    ['resetsAt이 숫자가 아님', claudeEvent({ unifiedWindows: { five_hour: { utilization: 0.45, resetsAt: 'x' } } })],
    ['최상위 resetsAt 없음', claudeEvent({ rateLimitType: 'five_hour', utilization: 0.45 })],
  ])('%s이면 저장 상태를 그대로 둔다', (_name, ev) => {
    recordClaudeRateLimit(validEvent());
    const before = structuredClone(claudeStore());
    expect(() => recordClaudeRateLimit(ev)).not.toThrow();
    expect(claudeStore()).toEqual(before);

    // 빈 저장소에서도 값을 만들지 않는다 (readAt도 null로 남는다).
    resetUsageForTest();
    recordClaudeRateLimit(ev);
    expect(claudeStore()).toBeNull();
  });
});

describe('Claude 실행 중 사용량 기록', () => {
  it('실행이 받은 rate_limit_event를 저장한다', async () => {
    const before = Date.now();
    await claudeAdapter.run({ prompt: '대상 문서: 0-PRODUCT.md', signal: signal() });
    const after = Date.now();
    const s = claudeStore();
    expect(s).toMatchObject({ fiveHour: { usedPercent: 45 }, weekly: { usedPercent: 38 } });
    expectResetsIn(s!.fiveHour!.resetsAt, 2 * HOUR, before, after);
    expectResetsIn(s!.weekly!.resetsAt, 5 * DAY, before, after);
  });

  it('이벤트가 깨져도 실행은 성공하고 저장값은 비어 있다', async () => {
    process.env.FAKE_USAGE = 'malformed';
    const res = await claudeAdapter.run({ prompt: '대상 문서: 0-PRODUCT.md', signal: signal() });
    expect(res.text).toContain('# 제품');
    expect(claudeStore()).toBeNull();
  });
});

describe('Claude /usage 해석', () => {
  const NOW = Date.UTC(2026, 9, 21, 7, 30); // 2026-10-21 07:30 UTC
  const TEXT = [
    'You are currently using your subscription to power your Claude Code usage',
    '',
    'Current session: 47% used · resets Oct 21 at 10:50am (UTC)',
    'Current week (all models): 63% used · resets Oct 25 at 4pm (UTC)',
    'Current week (Fable): 1% used · resets Oct 25 at 4pm (UTC)',
  ].join('\n');

  it('세션은 5시간, all models 주간은 주간 창이다 (모델별 주간 줄은 쓰지 않는다)', () => {
    expect(parseClaudeUsage(TEXT, NOW)).toEqual({
      fiveHour: { usedPercent: 47, resetsAt: '2026-10-21T10:50:00.000Z' },
      weekly: { usedPercent: 63, resetsAt: '2026-10-25T16:00:00.000Z' },
      readAt: new Date(NOW).toISOString(),
    });
  });

  it('날짜가 없으면 오늘(지났으면 내일), 12am·12pm과 해 넘김을 맞춘다', () => {
    const at = (line: string, now = NOW) => parseClaudeUsage(`Current session: 5% used · resets ${line}`, now).fiveHour?.resetsAt;
    expect(at('9am (UTC)')).toBe('2026-10-21T09:00:00.000Z');
    expect(at('7am (UTC)')).toBe('2026-10-22T07:00:00.000Z');
    expect(at('Oct 22 at 12am (UTC)')).toBe('2026-10-22T00:00:00.000Z');
    expect(at('Oct 21, 9:59pm (UTC)')).toBe('2026-10-21T21:59:00.000Z'); // Claude Code 2.1.303 형식
    expect(at('Oct 22 at 12:05pm (UTC)')).toBe('2026-10-22T12:05:00.000Z');
    expect(at('Jan 2 at 1am (UTC)', Date.UTC(2026, 11, 30))).toBe('2027-01-02T01:00:00.000Z');
  });

  it('한도 줄이 없거나 모양이 다르면 빈 값이다', () => {
    expect(parseClaudeUsage('Unknown command: /usage', NOW)).toEqual({ fiveHour: null, weekly: null, readAt: null });
    expect(parseClaudeUsage('Current session: 47% used · resets Foo 21 at 10am (UTC)', NOW).fiveHour).toBeNull();
  });

  it('가짜 CLI에서 읽고 TZ=UTC로 실행한다', async () => {
    const before = Date.now();
    const usage = await readClaudeUsage();
    expect(usage).toMatchObject({ fiveHour: { usedPercent: 52 }, weekly: { usedPercent: 31 } });
    // 출력은 분 단위라 최대 1분 이르다. 가짜 CLI는 TZ가 UTC가 아니면 다른 시간대를 적어 읽기가 실패한다.
    const ms = Date.parse(usage.fiveHour!.resetsAt);
    expect(ms).toBeGreaterThan(before + 2 * HOUR * 1000 - 61_000);
    expect(ms).toBeLessThanOrEqual(Date.now() + 2 * HOUR * 1000);
  });

  it('응답이 없으면 제한 시간 뒤 빈 값이다', async () => {
    process.env.FAKE_CLAUDE_USAGE = 'hang';
    expect(await readClaudeUsage(300)).toEqual({ fiveHour: null, weekly: null, readAt: null });
  });
});

describe('Codex 사용량 읽기 (app-server)', () => {
  it.each<[string, Want, Want]>([
    ['both', { usedPercent: 45, offsetSec: 2 * HOUR }, { usedPercent: 7, offsetSec: 6 * DAY }],
    ['weekly_only', null, { usedPercent: 7, offsetSec: 6 * DAY }],
    ['primary_null', null, { usedPercent: 7, offsetSec: 6 * DAY }],
    ['reset_null', null, { usedPercent: 7, offsetSec: 6 * DAY }],
    ['float', { usedPercent: 8, offsetSec: 2 * HOUR }, { usedPercent: 100, offsetSec: 6 * DAY }],
    ['clash', { usedPercent: 45, offsetSec: 2 * HOUR }, null],
    ['clash_invalid', null, null],
    ['boundary', { usedPercent: 45, offsetSec: 2 * HOUR }, { usedPercent: 7, offsetSec: 6 * DAY }],
  ])('FAKE_USAGE=%s면 창을 기대한 값으로 넣는다', async (mode, fiveHour, weekly) => {
    process.env.FAKE_USAGE = mode;
    const before = Date.now();
    const usage = await readCodexUsage();
    const after = Date.now();
    expectWindow(usage.fiveHour, fiveHour, before, after);
    expectWindow(usage.weekly, weekly, before, after);
    expectReadAt(usage.readAt, before, after);
  });

  it('기간이 null이거나 문자열이면 두 창 모두 무시한다', async () => {
    process.env.FAKE_USAGE = 'no_minutes';
    const usage = await readCodexUsage();
    expect(usage.fiveHour).toBeNull();
    expect(usage.weekly).toBeNull();
  });

  it('응답을 받으면 app-server 자식을 죽인다', async () => {
    const pidFile = pidFileFor('reply');
    await readCodexUsage();
    await expectChildExits(pidFile);
  });

  it('JSON-RPC 오류는 제한 시간을 기다리지 않고 빈 값으로 끝나며 자식도 죽는다', async () => {
    process.env.FAKE_USAGE = 'error';
    const pidFile = pidFileFor('error');
    const started = Date.now();
    const usage = await readCodexUsage(5000);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(usage).toEqual({ fiveHour: null, weekly: null, readAt: null });
    await expectChildExits(pidFile);
  });

  it('응답이 없으면 제한 시간 뒤 빈 값이고 자식은 죽는다', async () => {
    process.env.FAKE_USAGE = 'hang';
    const pidFile = pidFileFor('hang');
    expect(await readCodexUsage(300)).toEqual({ fiveHour: null, weekly: null, readAt: null });
    await expectChildExits(pidFile);
  });

  it('동시에 부르면 같은 진행 중 읽기를 함께 쓴다', async () => {
    const first = readCodexUsage();
    const second = readCodexUsage();
    expect(second).toBe(first);
    await first;
  });
});

describe('GET /api/agents/usage', () => {
  it('로그인된 CLI는 실행 전에도 Claude 값(/usage)과 Codex 값을 준다', async () => {
    process.env.FAKE_AUTH = 'logged_in';
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      claude: {
        fiveHour: { usedPercent: 52, resetsAt: ISO_AT },
        weekly: { usedPercent: 31, resetsAt: ISO_AT },
        readAt: ISO_AT,
      },
      codex: {
        fiveHour: { usedPercent: 45, resetsAt: ISO_AT },
        weekly: { usedPercent: 7, resetsAt: ISO_AT },
        readAt: ISO_AT,
      },
    });
  });

  it('/usage를 읽지 못하면 Claude 실행에서 받아 둔 값을 준다', async () => {
    process.env.FAKE_CLAUDE_USAGE = 'none';
    expect((await (await GET()).json()).claude).toEqual({ fiveHour: null, weekly: null, readAt: null });
    await claudeAdapter.run({ prompt: '대상 문서: 0-PRODUCT.md', signal: signal() });
    const body = await (await GET()).json();
    expect(body.claude).toMatchObject({ fiveHour: { usedPercent: 45 }, weekly: { usedPercent: 38 } });
  });

  it.each(['logged_out', 'api_key'])('FAKE_AUTH=%s면 두 CLI 모두 null이고 Claude 저장값도 지운다', async (auth) => {
    recordClaudeRateLimit(validEvent());
    process.env.FAKE_AUTH = auth;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claude: null, codex: null });
    expect(claudeStore()).toBeNull();
  });

  it('Claude 상태 확인이 throw하면 Claude만 null이고 저장값은 남는다', async () => {
    recordClaudeRateLimit(validEvent());
    const before = structuredClone(claudeStore());
    vi.spyOn(claudeAdapter, 'status').mockRejectedValueOnce(new Error('x'));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claude).toBeNull();
    expect(body.codex.fiveHour.usedPercent).toBe(45);
    expect(claudeStore()).toEqual(before);
  });
});

describe('실행 출력의 JSON null 줄', () => {
  it.each([['claude', claudeAdapter], ['codex', codexAdapter]] as const)('%s 실행은 null 줄을 무시하고 성공한다', async (_name, adapter) => {
    process.env.FAKE_NULL_LINE = '1';
    const r = await adapter.run({ prompt: 'x', signal: signal() });
    expect(r.text).toBe('답변');
  });
});
