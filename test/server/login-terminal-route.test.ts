import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentName } from '@/lib/contract';
import { POST, PUT, DELETE } from '@/app/api/agents/[agent]/login/route';
import { claudeAdapter } from '@/server/agents/claude';
import { codexAdapter } from '@/server/agents/codex';
import { isLoginRunning } from '@/server/runtime';
import { ctx, jsonReq, sseEvents } from '../helpers/route';

const fixture = path.resolve('test/fixtures/fake-login-pty.mjs');
const endpoint = (agent: AgentName) => `http://127.0.0.1:3000/api/agents/${agent}/login`;

async function start(agent: AgentName) {
  process.env[agent === 'claude' ? 'CLAUDE_CLI' : 'CODEX_CLI'] = fixture;
  const controller = new AbortController();
  const response = await POST(jsonReq('POST', endpoint(agent), { terminal: true }, controller.signal), ctx({ agent }));
  expect(response.status).toBe(200);
  const events = sseEvents(response);
  let loginId = '';
  let output = '';
  async function until(predicate: () => boolean) {
    while (!predicate()) {
      const next = await events.next();
      if (next.done) throw new Error(`PTY 스트림이 조기 종료됨: ${output}`);
      if (next.value.event === 'input_ready') loginId = String(next.value.data.loginId);
      if (next.value.event === 'output') output += String(next.value.data.text);
      if (next.value.event === 'error') throw new Error(String(next.value.data.message));
    }
  }
  const put = (body: Record<string, unknown>) => PUT(jsonReq('PUT', endpoint(agent), { loginId, ...body }), ctx({ agent }));
  const finish = async () => {
    const rest = [];
    for await (const event of events) rest.push(event);
    return rest;
  };
  const stop = async () => {
    controller.abort();
    await DELETE(jsonReq('DELETE', endpoint(agent)), ctx({ agent }));
    await finish();
  };
  try {
    await until(() => Boolean(loginId) && output.includes('"type":"ready"'));
  } catch (error) {
    await stop();
    throw error;
  }
  return { put, until, output: () => output, id: () => loginId, finish, stop };
}

afterEach(() => vi.restoreAllMocks());

describe('로그인 PTY API', () => {
  it.each(['claude', 'codex'] as const)('%s POST는 실제 TTY를 열고 PUT은 raw 키와 resize를 전달한다', async (agent) => {
    vi.spyOn(agent === 'claude' ? claudeAdapter : codexAdapter, 'status').mockResolvedValue({ installed: true, loggedIn: true, subscription: true });
    const login = await start(agent);
    try {
      expect(login.output()).toContain('\x1b[32mPTY login\x1b[0m');
      expect(login.output()).toContain('"stdinTTY":true,"stdoutTTY":true');
      const raw = '\x1b[A\x03\t\r';
      expect((await login.put({ data: raw })).status).toBe(204);
      await login.until(() => login.output().includes(`"hex":"${Buffer.from(raw).toString('hex')}"`));
      expect((await login.put({ cols: 113, rows: 39 })).status).toBe(204);
      await login.until(() => login.output().includes('"type":"resize","cols":113,"rows":39'));
      expect((await login.put({ data: 'Q' })).status).toBe(204);
      expect((await login.finish()).at(-1)).toEqual({ event: 'done', data: { loggedIn: true } });
      expect(isLoginRunning(agent)).toBe(false);
      expect((await login.put({ data: 'late' })).status).toBe(409);
    } finally {
      await login.stop();
    }
  });

  it('불완전하거나 혼합된 필드, 큰 입력, 잘못된 크기와 이전 세션을 거부한다', async () => {
    const login = await start('claude');
    try {
      const invalid = [
        { data: '' }, { data: 1 }, { data: 'a'.repeat(16_385) },
        { data: 'x', input: 'x' }, { data: 'x', code: 'code#state' },
        { data: 'x', cols: 80, rows: 24 }, { data: 'x', loginId: 1 },
        { cols: 80 }, { rows: 24 }, { cols: 0, rows: 24 },
        { cols: 501, rows: 24 }, { cols: 80, rows: 201 },
        { cols: 80, rows: 1 }, { cols: 80.5, rows: 24 },
        { cols: '80', rows: 24 }, { cols: 80, rows: 24, input: 'x' },
      ];
      for (const body of invalid) expect((await login.put(body)).status).toBe(400);
      expect((await login.put({ data: '\x1b[A', loginId: 'stale-session' })).status).toBe(409);
      expect((await login.put({ cols: 80, rows: 24, loginId: 'stale-session' })).status).toBe(409);
    } finally {
      await login.stop();
    }
  });

  it('DELETE 완료 직후 새 PTY를 열고 이전 세션 입력은 거부한다', async () => {
    const first = await start('codex');
    try {
      expect((await DELETE(jsonReq('DELETE', endpoint('codex')), ctx({ agent: 'codex' }))).status).toBe(204);
      const second = await start('codex');
      try {
        expect(second.id()).not.toBe(first.id());
        expect((await second.put({ data: 'late', loginId: first.id() })).status).toBe(409);
        expect((await second.put({ data: 'ok' })).status).toBe(204);
        await second.until(() => second.output().includes('"hex":"6f6b"'));
      } finally {
        await second.stop();
      }
    } finally {
      await first.stop();
    }
  });
});
