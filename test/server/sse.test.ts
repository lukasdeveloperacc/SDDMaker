import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSse } from '@/server/sse';
import { runAgentSse } from '@/server/run-agent-sse';
import { getAdapter } from '@/server/agents';
import { acquireRun, getRun } from '@/server/runtime';
import { dataDir } from '@/server/env';
import { jsonReq, readSse, sseEvents } from '../helpers/route';

const PROJECT = 1;

afterEach(() => {
  vi.restoreAllMocks();
});

// 실행 잠금을 잡고 Claude 실행을 runAgentSse로 감싼다.
function startRun(opts: {
  signal?: AbortSignal;
  agent?: 'claude' | 'codex';
  execute?: (ctx: { onDelta: (t: string) => void; signal: AbortSignal }) => Promise<string>;
}) {
  const handle = acquireRun(PROJECT, 'interview', null);
  if (!handle) throw new Error('lock busy');
  const req = jsonReq('POST', 'http://127.0.0.1:3000/api/x', undefined, opts.signal);
  const adapter = getAdapter(opts.agent ?? 'claude');
  const defaultExecute = async ({ onDelta, signal }: { onDelta: (t: string) => void; signal: AbortSignal }) => {
    const r = await adapter.run({ prompt: '대상 문서: 0-PRODUCT.md', onDelta, signal });
    return r.text;
  };
  const res = runAgentSse({ req, handle, agent: opts.agent ?? 'claude', execute: opts.execute ?? defaultExecute });
  return { res, handle };
}

describe('createSse', () => {
  it('닫은 뒤의 send는 아무것도 하지 않고 던지지도 않는다', async () => {
    const sse = createSse(new AbortController().signal);
    sse.send('a', { n: 1 });
    sse.close();
    expect(() => sse.send('b', {})).not.toThrow();
    const events = await readSse(sse.response);
    expect(events).toEqual([{ event: 'a', data: { n: 1 } }]);
  });

  it('요청이 끊기면 signal이 abort된다', () => {
    const ac = new AbortController();
    const sse = createSse(ac.signal);
    expect(sse.signal.aborted).toBe(false);
    ac.abort();
    expect(sse.signal.aborted).toBe(true);
  });

  it('스트림을 cancel하면 signal이 abort된다', async () => {
    const sse = createSse(new AbortController().signal);
    await sse.response.body!.cancel();
    expect(sse.signal.aborted).toBe(true);
  });

  it('헤더는 SSE 형식이다', () => {
    const sse = createSse(new AbortController().signal);
    expect(sse.response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(sse.response.headers.get('cache-control')).toBe('no-cache, no-transform');
    sse.close();
  });
});

describe('runAgentSse', () => {
  it('delta 세 번 뒤 done이 온다', async () => {
    process.env.FAKE_MODE = 'ok';
    const { res } = startRun({});
    const events = await readSse(res);
    expect(events.map((e) => e.event)).toEqual(['delta', 'delta', 'delta', 'done']);
    expect(events[3].data.text).toBe(events.slice(0, 3).map((e) => e.data.text).join(''));
  });

  it('done을 받는 시점에 실행 잠금은 이미 풀려 있다', async () => {
    process.env.FAKE_MODE = 'ok';
    const { res } = startRun({});
    let sawDone = false;
    for await (const ev of sseEvents(res)) {
      if (ev.event === 'done') {
        sawDone = true;
        expect(getRun(PROJECT)).toBeNull();
      }
    }
    expect(sawDone).toBe(true);
  });

  it('미로그인이면 error not_logged_in이고 execute는 불리지 않는다', async () => {
    process.env.FAKE_AUTH = 'logged_out';
    const execute = vi.fn(async () => 'x');
    const { res } = startRun({ execute });
    const events = await readSse(res);
    expect(events).toEqual([{ event: 'error', data: expect.objectContaining({ code: 'not_logged_in' }) }]);
    expect(execute).not.toHaveBeenCalled();
    expect(getRun(PROJECT)).toBeNull();
  });

  it('API 키 로그인이면 not_subscription', async () => {
    process.env.FAKE_AUTH = 'api_key';
    const { res } = startRun({});
    const events = await readSse(res);
    expect(events[0].data.code).toBe('not_subscription');
  });

  it('실행 파일이 없으면 cli_not_found', async () => {
    process.env.CLAUDE_CLI = '/nonexistent/claude';
    const { res } = startRun({});
    const events = await readSse(res);
    expect(events[0].data.code).toBe('cli_not_found');
  });

  it('실패 응답이면 error agent_failed', async () => {
    process.env.FAKE_MODE = 'fail';
    const { res } = startRun({});
    const events = await readSse(res);
    expect(events[events.length - 1]).toEqual({ event: 'error', data: expect.objectContaining({ code: 'agent_failed' }) });
    expect(getRun(PROJECT)).toBeNull();
  });

  it('연결을 끊으면 자식 프로세스가 죽고 잠금이 풀리며 저장되지 않는다', async () => {
    const pidFile = path.join(dataDir(), 'pid-sse-abort');
    process.env.FAKE_MODE = 'slow';
    process.env.FAKE_PID_FILE = pidFile;
    const save = vi.fn();
    const ac = new AbortController();
    const { res } = startRun({
      signal: ac.signal,
      execute: async ({ onDelta, signal }) => {
        const r = await getAdapter('claude').run({ prompt: '대상 문서: 0-PRODUCT.md', onDelta, signal });
        signal.throwIfAborted();
        save(r.text);
        return r.text;
      },
    });
    // pid 파일이 생길 때까지 기다린 뒤 끊는다.
    for (let i = 0; i < 500 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await readSse(res);
    for (let i = 0; i < 500 && getRun(PROJECT); i++) await new Promise((r) => setTimeout(r, 20));
    expect(getRun(PROJECT)).toBeNull();
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it('CLI 결과를 받은 뒤 저장 전에 끊기면 저장 함수가 불리지 않는다', async () => {
    process.env.FAKE_MODE = 'ok';
    const save = vi.fn();
    const ac = new AbortController();
    let reached!: () => void;
    const reachedP = new Promise<void>((r) => { reached = r; });
    const { res } = startRun({
      signal: ac.signal,
      execute: async ({ onDelta, signal }) => {
        const r = await getAdapter('claude').run({ prompt: '대상 문서: 0-PRODUCT.md', onDelta, signal });
        reached();
        await new Promise((r2) => setTimeout(r2, 200)); // 저장 직전 지연
        signal.throwIfAborted();
        save(r.text);
        return r.text;
      },
    });
    const seen: string[] = [];
    const reading = (async () => {
      for await (const ev of sseEvents(res)) seen.push(ev.event);
    })();
    await reachedP;
    ac.abort();
    await reading;
    // 저장 직전 지연이 끝나고 잠금이 풀릴 때까지 기다린다.
    for (let i = 0; i < 500 && getRun(PROJECT); i++) await new Promise((r) => setTimeout(r, 20));
    expect(save).not.toHaveBeenCalled();
    expect(seen).not.toContain('done');
    expect(getRun(PROJECT)).toBeNull();
  });
});
