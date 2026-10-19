import { describe, expect, it, vi } from 'vitest';
import { POST, PUT, DELETE } from '@/app/api/agents/[agent]/login/route';
import { ctx, jsonReq, sseEvents } from '../helpers/route';

const url = 'http://127.0.0.1:3000/api/agents/claude/login';
const context = () => ctx({ agent: 'claude' });

async function startCodeLogin(signal?: AbortSignal) {
  process.env.FAKE_LOGIN = 'code';
  const response = await POST(jsonReq('POST', url, undefined, signal), context());
  const events = sseEvents(response)[Symbol.asyncIterator]();
  let loginId = '';
  let output = '';
  while (!loginId || !output.includes('Paste code here if prompted > ')) {
    const next = await events.next();
    if (next.done) throw new Error('로그인 입력을 기다리는 중 종료됨');
    if (next.value.event === 'input_ready') loginId = next.value.data.loginId;
    if (next.value.event === 'output') output += next.value.data.text;
  }
  return { events, loginId, output };
}

async function finish(events: ReturnType<typeof sseEvents>) {
  const rest = [];
  for await (const event of events) rest.push(event);
  return rest;
}

describe('웹 로그인 콘솔', () => {
  it('개행 없는 prompt를 바로 전달하고 전체 code#state를 stdin으로 보낸다. 코드는 출력·로그에 남지 않는다', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { events, loginId, output } = await startCodeLogin();
    expect(output).toContain('https://claude.ai/oauth/fake?x=1');
    expect(output.endsWith('> ')).toBe(true);
    const res = await PUT(jsonReq('PUT', url, { loginId, code: 'test-code#state-value' }), context());
    expect(res.status).toBe(204);
    const rest = await finish(events);
    expect(rest.at(-1)).toEqual({ event: 'done', data: { loggedIn: true } });
    expect(JSON.stringify(rest)).not.toContain('test-code#state-value');
    expect([...log.mock.calls, ...error.mock.calls].flat().join(' ')).not.toContain('test-code#state-value');
    log.mockRestore();
    error.mockRestore();
  });

  it('다른 세션·여러 줄 입력·중복 제출을 거부한다', async () => {
    const { events, loginId } = await startCodeLogin();
    try {
      const wrongSession = await PUT(jsonReq('PUT', url, { loginId: 'stale-login', code: 'test-code#state-value' }), context());
      expect(wrongSession.status).toBe(409);
      for (const code of ['', 'only-partial-code', 'code##state', 'code\nsecond-line', 'a'.repeat(4097), 'code\u0000#state']) {
        const invalid = await PUT(jsonReq('PUT', url, { loginId, code }), context());
        expect(invalid.status).toBe(400);
      }
      expect((await PUT(jsonReq('PUT', url, { loginId, code: 'test-code#state-value' }), context())).status).toBe(204);
      expect((await PUT(jsonReq('PUT', url, { loginId, code: 'test-code#state-value' }), context())).status).toBe(409);
    } finally {
      await DELETE(jsonReq('DELETE', url), context());
      await finish(events);
    }
  });

  it('취소한 세션의 코드는 재시작한 로그인에 전달하지 않는다', async () => {
    const first = await startCodeLogin();
    await DELETE(jsonReq('DELETE', url), context());
    await finish(first.events);
    const second = await startCodeLogin();
    try {
      expect(second.loginId).not.toBe(first.loginId);
      expect((await PUT(jsonReq('PUT', url, { loginId: first.loginId, code: 'test-code#state-value' }), context())).status).toBe(409);
      expect((await PUT(jsonReq('PUT', url, { loginId: second.loginId, code: 'test-code#state-value' }), context())).status).toBe(204);
      expect((await finish(second.events)).at(-1)?.event).toBe('done');
    } finally {
      await DELETE(jsonReq('DELETE', url), context());
    }
  });

  it('연결을 끊으면 입력도 폐기한다', async () => {
    const controller = new AbortController();
    const { events, loginId } = await startCodeLogin(controller.signal);
    controller.abort();
    expect((await PUT(jsonReq('PUT', url, { loginId, code: 'test-code#state-value' }), context())).status).toBe(409);
    await finish(events);
  });

  it('Codex도 콘솔 출력을 전달하고 완료하지만 반환 코드 입력은 받지 않는다', async () => {
    process.env.FAKE_LOGIN = 'ok';
    const response = await POST(jsonReq('POST', url.replace('claude', 'codex')), ctx({ agent: 'codex' }));
    const events = await finish(sseEvents(response));
    expect(events.filter((e) => e.event === 'output').map((e) => e.data.text).join('')).toContain('Enter this code: ABCD-12345');
    expect(events).toContainEqual({ event: 'prompt', data: { url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' } });
    expect(events.some((e) => e.event === 'input_ready')).toBe(true);
    expect(events.at(-1)).toEqual({ event: 'done', data: { loggedIn: true } });
    expect((await PUT(jsonReq('PUT', url.replace('claude', 'codex'), { loginId: 'fake', code: 'x' }), ctx({ agent: 'codex' }))).status).toBe(400);
  });
});


async function startTerminalLogin(agent: 'claude' | 'codex', signal?: AbortSignal) {
  process.env.FAKE_LOGIN = 'terminal';
  const endpoint = url.replace('claude', agent);
  const response = await POST(jsonReq('POST', endpoint, undefined, signal), ctx({ agent }));
  const events = sseEvents(response);
  let loginId = '';
  while (!loginId) {
    const next = await events.next();
    if (next.done) throw new Error('콘솔 입력을 기다리는 중 종료됨');
    if (next.value.event === 'input_ready') loginId = next.value.data.loginId;
  }
  const input = (value: unknown, id = loginId) => PUT(jsonReq('PUT', endpoint, { loginId: id, input: value }), ctx({ agent }));
  const cancel = () => DELETE(jsonReq('DELETE', endpoint), ctx({ agent }));
  return { events, loginId, input, cancel };
}

describe('로그인 콘솔 stdin', () => {
  it('Claude에서 잘못된 코드 뒤에도 같은 세션으로 수정한 줄을 입력한다', async () => {
    const login = await startTerminalLogin('claude');
    try {
      expect((await login.input('wrong-code')).status).toBe(204);
      let invalid = false;
      while (!invalid) {
        const next = await login.events.next();
        if (next.done) throw new Error('수정 입력 전에 종료됨');
        invalid = next.value.event === 'output' && next.value.data.text.includes('Invalid code; try again');
      }
      expect((await login.input('test-code#state-value')).status).toBe(204);
      expect((await finish(login.events)).at(-1)).toEqual({ event: 'done', data: { loggedIn: true } });
      expect((await login.input('late-input')).status).toBe(409);
    } finally {
      await login.cancel();
      await finish(login.events);
    }
  });

  it('Codex도 stdin 줄과 빈 Enter를 받고 완료한다', async () => {
    const login = await startTerminalLogin('codex');
    try {
      expect((await login.input('')).status).toBe(204);
      let receivedEnter = false;
      while (!receivedEnter) {
        const next = await login.events.next();
        if (next.done) throw new Error('Enter 입력 전에 종료됨');
        receivedEnter = next.value.event === 'output' && next.value.data.text.includes('Waiting for device confirmation');
      }
      expect((await login.input('confirm-device')).status).toBe(204);
      const rest = await finish(login.events);
      expect(rest.filter((e) => e.event === 'output').map((e) => e.data.text).join('')).toContain('Device confirmation received');
      expect(rest.at(-1)).toEqual({ event: 'done', data: { loggedIn: true } });
    } finally {
      await login.cancel();
      await finish(login.events);
    }
  });

  it('잘못된 줄과 이전 세션, 취소 뒤 입력을 두 에이전트 모두 거부한다', async () => {
    for (const agent of ['claude', 'codex'] as const) {
      const login = await startTerminalLogin(agent);
      try {
        for (const value of [null, 1, 'one\ntwo', 'one\rtwo', '\u0000', '\u001b[A', '\t', 'a'.repeat(4097)]) {
          expect((await login.input(value)).status).toBe(400);
        }
        expect((await login.input('line', 'old-session')).status).toBe(409);
        const endpoint = url.replace('claude', agent);
        expect((await PUT(jsonReq('PUT', endpoint, { loginId: login.loginId, input: 'line', code: 'code#state' }), ctx({ agent }))).status).toBe(400);
        await login.cancel();
        expect((await login.input('after-cancel')).status).toBe(409);
      } finally {
        await login.cancel();
        await finish(login.events);
      }
      const replacement = await startTerminalLogin(agent);
      try {
        expect((await replacement.input('line', login.loginId)).status).toBe(409);
      } finally {
        await replacement.cancel();
        await finish(replacement.events);
      }
    }
  });

  it('가이드 코드가 입력을 닫은 뒤 콘솔 쓰기는 거부한다', async () => {
    const login = await startCodeLogin();
    expect((await PUT(jsonReq('PUT', url, { loginId: login.loginId, code: 'test-code#state-value' }), context())).status).toBe(204);
    expect((await PUT(jsonReq('PUT', url, { loginId: login.loginId, input: 'late-input' }), context())).status).toBe(409);
    await finish(login.events);
  });
});
