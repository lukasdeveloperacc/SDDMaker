import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/agents/route';
import { POST, DELETE } from '@/app/api/agents/[agent]/login/route';
import { codexAdapter } from '@/server/agents/codex';
import { AgentError } from '@/server/agents/exec';
import { claudeAdapter } from '@/server/agents/claude';
import { acquireLogin, releaseLogin } from '@/server/runtime';
import { dataDir } from '@/server/env';
import { ctx, jsonReq, readSse, sseEvents } from '../helpers/route';

afterEach(() => {
  vi.restoreAllMocks();
});

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(cond: () => boolean, ms = 10000) {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('GET /api/agents', () => {
  it('두 CLI의 상태와 로그인 안내를 준다', async () => {
    process.env.FAKE_AUTH = 'logged_in';
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claude).toEqual({ installed: true, loggedIn: true, subscription: true, loginCommand: 'claude auth login' });
    expect(body.codex).toEqual({
      installed: true,
      loggedIn: true,
      subscription: true,
      loginCommand: expect.stringContaining('codex login'),
    });
  });

  it('한 CLI의 상태 확인이 실패해도 목록은 200이고 그 CLI만 사용 불가로 보인다', async () => {
    process.env.FAKE_AUTH = 'logged_in';
    vi.spyOn(codexAdapter, 'status').mockRejectedValueOnce(new AgentError('agent_failed', '상태 확인 시간 초과'));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.codex).toEqual({
      installed: false,
      loggedIn: false,
      subscription: false,
      loginCommand: expect.stringContaining('codex login'),
    });
    expect(body.claude.loggedIn).toBe(true);
  });
});

describe('POST /api/agents/:agent/login 상태 확인 실패', () => {
  it('로그인 명령이 성공했는데 상태 확인이 계속 실패하면 done {loggedIn:false}이고 login_failed가 아니다', async () => {
    process.env.FAKE_LOGIN = 'ok';
    vi.spyOn(claudeAdapter, 'status').mockRejectedValue(new AgentError('agent_failed', '상태 확인 시간 초과'));
    const res = await POST(jsonReq('POST', 'http://127.0.0.1:3000/api/agents/claude/login'), ctx({ agent: 'claude' }));
    const events = await readSse(res);
    expect(events[events.length - 1]).toEqual({ event: 'done', data: { loggedIn: false } });
    expect(events.some((e) => e.event === 'error')).toBe(false);
  });

  it('상태 확인이 한 번 실패해도 두 번째 확인으로 done {loggedIn:true}를 보낸다', async () => {
    process.env.FAKE_LOGIN = 'ok';
    process.env.FAKE_AUTH = 'logged_in';
    const original = claudeAdapter.status.bind(claudeAdapter);
    vi.spyOn(claudeAdapter, 'status')
      .mockRejectedValueOnce(new AgentError('agent_failed', '상태 확인 시간 초과'))
      .mockImplementation(original);
    const res = await POST(jsonReq('POST', 'http://127.0.0.1:3000/api/agents/claude/login'), ctx({ agent: 'claude' }));
    const events = await readSse(res);
    expect(events[events.length - 1]).toEqual({ event: 'done', data: { loggedIn: true } });
  });
});

describe('POST /api/agents/:agent/login', () => {
  it('prompt를 보낸 뒤 done {loggedIn:true}로 끝난다', async () => {
    process.env.FAKE_LOGIN = 'ok';
    process.env.FAKE_AUTH = 'logged_in';
    const res = await POST(jsonReq('POST', 'http://127.0.0.1:3000/api/agents/claude/login'), ctx({ agent: 'claude' }));
    const events = await readSse(res);
    expect(events[0]).toEqual({ event: 'prompt', data: { url: 'https://claude.ai/oauth/fake?x=1' } });
    expect(events[events.length - 1]).toEqual({ event: 'done', data: { loggedIn: true } });
  });

  it('잘못된 에이전트는 400', async () => {
    const res = await POST(jsonReq('POST', 'http://127.0.0.1:3000/api/agents/nope/login'), ctx({ agent: 'nope' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_input');
  });

  it('로그인 실패는 error login_failed', async () => {
    process.env.FAKE_LOGIN = 'fail';
    const res = await POST(jsonReq('POST', 'http://127.0.0.1:3000/api/agents/claude/login'), ctx({ agent: 'claude' }));
    const events = await readSse(res);
    expect(events[events.length - 1]).toEqual({ event: 'error', data: expect.objectContaining({ code: 'login_failed' }) });
  });

  it('실행 파일이 없으면 error cli_not_found', async () => {
    process.env.CLAUDE_CLI = '/nonexistent/claude';
    const res = await POST(jsonReq('POST', 'http://127.0.0.1:3000/api/agents/claude/login'), ctx({ agent: 'claude' }));
    const events = await readSse(res);
    expect(events[events.length - 1].data.code).toBe('cli_not_found');
  });

  it('진행 중 두 번째 요청은 409 login_running', async () => {
    process.env.FAKE_LOGIN = 'hang';
    const first = await POST(jsonReq('POST', 'http://127.0.0.1:3000/api/agents/claude/login'), ctx({ agent: 'claude' }));
    const it1 = sseEvents(first)[Symbol.asyncIterator]();
    expect((await it1.next()).value.event).toBe('prompt');

    const second = await POST(jsonReq('POST', 'http://127.0.0.1:3000/api/agents/claude/login'), ctx({ agent: 'claude' }));
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe('login_running');

    await DELETE(jsonReq('DELETE', 'http://127.0.0.1:3000/api/agents/claude/login'), ctx({ agent: 'claude' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let last = null as null | { event: string; data: any };
    for (;;) {
      const r = await it1.next();
      if (r.done) break;
      last = r.value;
    }
    expect(last).toEqual({ event: 'error', data: expect.objectContaining({ code: 'login_failed' }) });
  });

  it('DELETE 뒤 로그인 프로세스가 죽고 첫 스트림은 login_failed로 끝난다', async () => {
    const pidFile = path.join(dataDir(), 'pid-login-cancel');
    process.env.FAKE_LOGIN = 'hang';
    process.env.FAKE_PID_FILE = pidFile;
    const first = await POST(jsonReq('POST', 'http://127.0.0.1:3000/api/agents/codex/login'), ctx({ agent: 'codex' }));
    const consumer = readSse(first);
    await waitUntil(() => fs.existsSync(pidFile));
    const del = await DELETE(jsonReq('DELETE', 'http://127.0.0.1:3000/api/agents/codex/login'), ctx({ agent: 'codex' }));
    expect(del.status).toBe(204);
    const events = await consumer;
    expect(events[events.length - 1]).toEqual({ event: 'error', data: expect.objectContaining({ code: 'login_failed' }) });
    expect(alive(Number(fs.readFileSync(pidFile, 'utf8')))).toBe(false);
  });

  it('연결을 끊으면 로그인 프로세스가 죽고 잠금이 풀린다', async () => {
    const pidFile = path.join(dataDir(), 'pid-login-disconnect');
    process.env.FAKE_LOGIN = 'hang';
    process.env.FAKE_PID_FILE = pidFile;
    const ac = new AbortController();
    const res = await POST(
      jsonReq('POST', 'http://127.0.0.1:3000/api/agents/claude/login', undefined, ac.signal),
      ctx({ agent: 'claude' }),
    );
    await waitUntil(() => fs.existsSync(pidFile));
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    ac.abort();
    await readSse(res);
    await waitUntil(() => !alive(pid));
    expect(alive(pid)).toBe(false);

    // 잠금이 다시 잡혀야 한다.
    let c: AbortController | null = null;
    await waitUntil(() => {
      c = acquireLogin('claude');
      return c !== null;
    });
    releaseLogin('claude', c!);
  });
});

describe('DELETE /api/agents/:agent/login', () => {
  it('진행 중인 로그인이 없어도 204', async () => {
    const res = await DELETE(jsonReq('DELETE', 'http://127.0.0.1:3000/api/agents/claude/login'), ctx({ agent: 'claude' }));
    expect(res.status).toBe(204);
  });

  it('잘못된 에이전트는 400', async () => {
    const res = await DELETE(jsonReq('DELETE', 'http://127.0.0.1:3000/api/agents/x/login'), ctx({ agent: 'x' }));
    expect(res.status).toBe(400);
  });
});
