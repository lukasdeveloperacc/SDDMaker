// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPicker } from '@/components/AgentPicker';
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
async function render(agent: AgentName = 'claude') {
  await act(async () => root.render(createElement(AgentPicker, { value: agent, onChange: () => {} })));
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

describe('에이전트 로그인 터미널', () => {
  it.each(['claude', 'codex'] as const)('%s는 PTY 연결을 요청하고 ANSI 출력과 입력 세션을 터미널에 전달한다', async (agent) => {
    await render(agent);
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
