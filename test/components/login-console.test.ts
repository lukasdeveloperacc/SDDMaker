// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentConnections } from '@/components/AgentConnections';
import type { AgentName } from '@/lib/contract';

vi.mock('@/components/AgentTerminal', () => ({
  AgentTerminal: ({ agent, output, loginId, running }: { agent: string; output: string; loginId: string | null; running: boolean }) =>
    createElement('pre', { 'data-testid': 'terminal', 'data-agent': agent, 'data-login-id': loginId, 'data-running': String(running) }, output),
}));

type Session = { controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean };
type Intercept = (url: string, options?: RequestInit) => Promise<Response> | undefined;
let root: Root;
let container: HTMLDivElement;
let sessions: Session[];
let loggedIn: boolean;
let loginRunning: boolean;
let ignoreAbort: boolean;
let intercept: Intercept | undefined;
let requests: Array<{ url: string; method: string; body?: string }>;

function emit(event: string, data: unknown, session = sessions.at(-1)!) {
  session.controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}
function close(session = sessions.at(-1)!) {
  if (session.closed) return;
  session.closed = true;
  session.controller.close();
}
function button(text: string, index = 0) {
  const el = [...container.querySelectorAll('button')].filter((b) => b.textContent === text)[index];
  if (!el) throw new Error(`버튼 없음: ${text}`);
  return el;
}
async function render(terminal = true) {
  await act(async () => root.render(createElement(AgentConnections)));
  if (terminal) await act(async () => button('터미널').click());
}
async function connect(agent: AgentName = 'claude') {
  await act(async () => button('계정 연결', agent === 'claude' ? 0 : 1).click());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  sessions = [];
  loggedIn = false;
  loginRunning = false;
  ignoreAbort = false;
  intercept = undefined;
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    const url = String(input);
    const method = options?.method ?? 'GET';
    requests.push({ url, method, body: options?.body as string | undefined });
    const custom = intercept?.(url, options);
    if (custom) return custom;
    if (method === 'GET') {
      const status = { installed: true, loggedIn, subscription: loggedIn, loginCommand: 'scoped login command', loginRunning };
      return new Response(JSON.stringify({ claude: status, codex: status }));
    }
    if (method === 'POST' && url.endsWith('/logout')) {
      loggedIn = false;
      return new Response(null, { status: 204 });
    }
    if (method === 'POST') {
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        const session = { controller, closed: false };
        sessions.push(session);
        options?.signal?.addEventListener('abort', () => { if (!ignoreAbort) close(session); }, { once: true });
      } }));
    }
    if (method === 'DELETE') loginRunning = false;
    return new Response(null, { status: 204 });
  }));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    for (const session of sessions) close(session);
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe('연결 해제', () => {
  it.each(['claude', 'codex'] as const)('%s의 연결을 해제한 뒤 상태를 다시 읽고 재연결을 제공한다', async (agent) => {
    loggedIn = true;
    await render(false);
    const label = agent === 'claude' ? 'Claude Code' : 'Codex';
    const disconnect = container.querySelector(`[aria-label="${label} 연결 해제"]`) as HTMLButtonElement;
    expect(disconnect).not.toBeNull();
    await act(async () => disconnect.click());
    expect(requests).toContainEqual({ url: `/api/agents/${agent}/logout`, method: 'POST', body: undefined });
    expect(requests.at(-1)?.url).toBe('/api/agents');
    expect(container.textContent).not.toContain('로그인됨');
    expect(button('계정 연결', agent === 'claude' ? 0 : 1).disabled).toBe(false);
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('해제 중 중복 조작을 막고 실패하면 연결 상태와 재시도를 유지한다', async () => {
    loggedIn = true;
    let fail!: () => void;
    intercept = (url) => url.endsWith('/logout') ? new Promise((resolve) => {
      fail = () => resolve(new Response(JSON.stringify({ code: 'agent_failed', message: '연결을 해제하지 못했습니다.' }), { status: 500 }));
    }) : undefined;
    await render(false);
    await act(async () => button('연결 해제').click());
    expect(button('해제 중…').disabled).toBe(true);
    expect(button('연결 해제').disabled).toBe(true);
    expect(button('터미널').disabled).toBe(true);
    await act(async () => fail());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('연결을 해제하지 못했습니다.');
    expect(container.textContent).toContain('로그인됨');
    expect(button('연결 해제').disabled).toBe(false);
    expect(button('터미널').disabled).toBe(false);
  });
});

describe('에이전트 로그인 터미널', () => {
  it.each(['claude', 'codex'] as const)('%s는 PTY 연결을 요청하고 ANSI 출력과 입력 세션을 터미널에 전달한다', async (agent) => {
    await render();
    await connect(agent);
    expect(requests.find((r) => r.method === 'POST')).toEqual({ url: `/api/agents/${agent}/login`, method: 'POST', body: JSON.stringify({ terminal: true }) });
    const output = '\x1b[32mPTY login\x1b[0m\r\n<script>plain text</script>';
    await act(async () => {
      emit('input_ready', { loginId: 'terminal-session' });
      emit('output', { text: output });
    });
    const terminal = container.querySelector('[data-testid="terminal"]')!;
    expect(terminal.textContent).toBe(output);
    expect(terminal.getAttribute('data-agent')).toBe(agent);
    expect(terminal.getAttribute('data-login-id')).toBe('terminal-session');
    expect(terminal.getAttribute('data-running')).toBe('true');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).not.toContain('터미널에서 직접 로그인');
    expect(container.textContent).not.toContain('전용 저장소');
    expect(container.querySelectorAll('[role="tooltip"]')).toHaveLength(2);
    expect(container.querySelector('[aria-label="Codex 로그인 도움말"]')?.getAttribute('href')).toContain('/docs/auth');
    await act(async () => button('종료').click());
    expect(requests.some((r) => r.method === 'DELETE' && r.url.includes(agent))).toBe(true);
    expect(container.querySelector('[data-testid="terminal"]')).toBeNull();
  });

  it('성공 이벤트 이후 상태를 갱신하고 터미널을 제거한다', async () => {
    await render();
    await connect();
    await act(async () => {
      emit('input_ready', { loginId: 'current-session' });
      emit('output', { text: 'Login successful\r\n' });
      loggedIn = true;
      emit('done', { loggedIn: true });
      close();
    });
    expect(container.querySelector('[data-testid="terminal"]')).toBeNull();
    expect(container.textContent).toContain('로그인됨');
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(2);
  });

  it('실패를 표시하고 재시도하면 새 터미널 세션을 받는다', async () => {
    await render();
    await connect();
    await act(async () => {
      emit('output', { text: 'CLI failure' });
      emit('error', { code: 'login_failed', message: '인증을 완료하지 못했습니다' });
      close();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('인증을 완료하지 못했습니다');
    expect(container.querySelector('[data-testid="terminal"]')?.getAttribute('data-running')).toBe('false');
    await act(async () => button('다시 시도').click());
    await act(async () => emit('input_ready', { loginId: 'replacement' }));
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2);
    expect(container.querySelector('[data-testid="terminal"]')?.getAttribute('data-login-id')).toBe('replacement');
    expect(container.textContent).not.toContain('CLI failure');
  });

  it('초기 조회에 남은 로그인은 DELETE가 끝날 때까지 새 연결을 시작하지 않는다', async () => {
    loginRunning = true;
    let finishCancel!: () => void;
    intercept = (_url, options) => options?.method === 'DELETE'
      ? new Promise((resolve) => { finishCancel = () => { loginRunning = false; resolve(new Response(null, { status: 204 })); }; }) : undefined;
    await render();
    expect(container.textContent).toContain('로그인 진행 중');
    await act(async () => button('연결 재시작').click());
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
    expect(button('종료 중…').disabled).toBe(true);
    await act(async () => finishCancel());
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    await act(async () => emit('input_ready', { loginId: 'recovered-session' }));
    expect(container.querySelector('[data-testid="terminal"]')?.getAttribute('data-login-id')).toBe('recovered-session');
  });

  it('POST 409 충돌은 재시작으로 복구한다', async () => {
    let conflict = true;
    intercept = (_url, options) => {
      if (options?.method === 'POST' && conflict) {
        conflict = false;
        return Promise.resolve(new Response(JSON.stringify({ code: 'login_running', message: '이미 로그인이 진행 중입니다' }), { status: 409 }));
      }
    };
    await render();
    await connect();
    expect(container.textContent).toContain('로그인 진행 중');
    expect(container.querySelector('[data-testid="terminal"]')).toBeNull();
    await act(async () => button('연결 재시작').click());
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(2);
    expect(requests.some((r) => r.method === 'DELETE')).toBe(true);
    await act(async () => emit('input_ready', { loginId: 'new-session' }));
    expect(container.querySelector('[data-testid="terminal"]')?.getAttribute('data-login-id')).toBe('new-session');
  });

  it('기존 로그인 종료가 실패하면 오류와 복구 버튼을 유지한다', async () => {
    loginRunning = true;
    intercept = (_url, options) => options?.method === 'DELETE'
      ? Promise.resolve(new Response(JSON.stringify({ code: 'login_running', message: '종료 처리 중입니다. 다시 시도하세요.' }), { status: 409 })) : undefined;
    await render();
    await act(async () => button('연결 재시작').click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('종료 처리 중입니다');
    expect(button('연결 재시작').disabled).toBe(false);
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('취소한 이전 스트림의 늦은 출력이 새 로그인에 섞이지 않는다', async () => {
    ignoreAbort = true;
    await render();
    await connect();
    const previous = sessions[0];
    await act(async () => emit('input_ready', { loginId: 'old-session' }, previous));
    await act(async () => button('종료').click());
    await connect();
    await act(async () => {
      emit('input_ready', { loginId: 'new-session' });
      emit('output', { text: 'new output' });
      emit('input_ready', { loginId: 'old-late-id' }, previous);
      emit('output', { text: 'old late output' }, previous);
      emit('done', { loggedIn: true }, previous);
      close(previous);
    });
    const terminal = container.querySelector('[data-testid="terminal"]')!;
    expect(terminal.getAttribute('data-login-id')).toBe('new-session');
    expect(terminal.textContent).toBe('new output');
    expect(terminal.getAttribute('data-running')).toBe('true');
  });
});

describe('간편 로그인 탭', () => {
  it('Claude는 브라우저 인증과 인증 코드 입력을 제공하고 현재 세션으로 코드를 보낸다', async () => {
    await render(false);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('간편 로그인');
    expect(container.querySelector('input[type="radio"]')).toBeNull();
    await connect();
    expect(requests.find((r) => r.method === 'POST')?.body).toBe(JSON.stringify({ terminal: false }));
    expect(button('터미널').disabled).toBe(true);
    await act(async () => {
      emit('prompt', { url: 'https://claude.ai/oauth/authorize?state=test' });
      emit('input_ready', { loginId: 'guided-claude-session' });
      emit('output', { text: 'CLI output stays out of guided view' });
    });
    expect(container.querySelector('a.btn-primary')?.getAttribute('href')).toBe('https://claude.ai/oauth/authorize?state=test');
    expect(container.querySelector('[data-testid="terminal"]')).toBeNull();
    expect(container.textContent).not.toContain('CLI output stays out');
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'authorization#state');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button('연결 완료').disabled).toBe(false);
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(requests.find((r) => r.method === 'PUT')).toEqual({ url: '/api/agents/claude/login', method: 'PUT', body: JSON.stringify({ loginId: 'guided-claude-session', code: 'authorization#state' }) });
    expect(input.value).toBe('');
    await act(async () => button('취소').click());
    expect(button('터미널').disabled).toBe(false);
  });

  it('Codex는 브라우저 링크와 복사 가능한 기기 코드를 제공한다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await render(false);
    await connect('codex');
    await act(async () => emit('prompt', { url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' }));
    expect(container.querySelector('a.btn-primary')?.getAttribute('href')).toBe('https://auth.openai.com/codex/device');
    expect(container.querySelector('.connection-code code')?.textContent).toBe('ABCD-12345');
    expect(container.querySelector('form')).toBeNull();
    await act(async () => button('코드 복사').click());
    expect(writeText).toHaveBeenCalledWith('ABCD-12345');
    expect(button('복사됨')).toBeTruthy();
    await act(async () => { loggedIn = true; emit('done', { loggedIn: true }); close(); });
    expect(container.querySelector('.connection-code')).toBeNull();
    expect(container.textContent).toContain('로그인됨');
  });

  it('탭은 방향키와 Home·End로 선택할 수 있고 활성 로그인 중에는 변경하지 않는다', async () => {
    await render(false);
    await act(async () => button('간편 로그인').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('터미널');
    expect(document.activeElement).toBe(button('터미널'));
    expect(container.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(button('터미널').id);
    await act(async () => button('터미널').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('간편 로그인');
    await connect();
    await act(async () => button('간편 로그인').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('간편 로그인');
  });

  it('CLI가 전달한 실행 가능한 URL은 링크로 만들지 않는다', async () => {
    await render(false);
    await connect();
    await act(async () => emit('prompt', { url: 'javascript:alert(1)' }));
    expect(container.querySelector('a.btn-primary')).toBeNull();
    expect(container.textContent).toContain('로그인 준비 중');
  });
});
