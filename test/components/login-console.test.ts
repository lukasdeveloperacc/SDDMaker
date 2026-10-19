// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentPicker } from '@/components/AgentPicker';

let root: Root;
let container: HTMLDivElement;
let stream: ReadableStreamDefaultController<Uint8Array> | null;
let loggedIn: boolean;
let requests: Array<{ url: string; method: string; body?: string }>;

function emit(event: string, data: unknown) {
  stream!.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

function button(text: string) {
  const el = [...container.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!el) throw new Error(`버튼 없음: ${text}`);
  return el;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  stream = null;
  loggedIn = false;
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET';
    requests.push({ url, method, body: options?.body as string | undefined });
    if (method === 'GET') {
      const status = { installed: true, loggedIn, subscription: loggedIn, loginCommand: 'scoped login command' };
      return new Response(JSON.stringify({ claude: status, codex: status }));
    }
    if (method === 'POST') {
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        stream = controller;
        options?.signal?.addEventListener('abort', () => { stream?.close(); stream = null; }, { once: true });
      } }));
    }
    return new Response(null, { status: 204 });
  }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('에이전트 로그인 콘솔', () => {
  it('Claude 코드를 Enter로 제출하고 성공하면 콘솔을 지우고 로그인 상태를 갱신한다', async () => {
    await act(async () => root.render(createElement(AgentPicker, { value: 'claude', onChange: () => {} })));
    await act(async () => button('계정 연결').click());
    await act(async () => {
      emit('input_ready', { loginId: 'current-session' });
      emit('output', { text: 'Paste code here if prompted > ' });
      emit('prompt', { url: 'https://claude.ai/oauth/fake' });
    });
    expect(container.querySelector('[role="log"]')?.textContent).toContain('Paste code here');
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'test-code#state-value');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(button('코드 제출').disabled).toBe(false);
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(requests.find((r) => r.method === 'PUT')).toEqual({
      url: '/api/agents/claude/login', method: 'PUT', body: JSON.stringify({ loginId: 'current-session', code: 'test-code#state-value' }),
    });
    expect(container.textContent).not.toContain('test-code#state-value');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    await act(async () => {
      loggedIn = true;
      emit('done', { loggedIn: true });
      stream!.close();
      stream = null;
    });
    expect(container.querySelector('.login-console')).toBeNull();
    expect(container.textContent).toContain('로그인됨');
  });

  it('Codex는 링크·기기 코드·콘솔을 보여주고 취소하면 모두 지운다', async () => {
    await act(async () => root.render(createElement(AgentPicker, { value: 'codex', onChange: () => {} })));
    const connect = [...container.querySelectorAll('button')].filter((b) => b.textContent === '계정 연결')[1];
    await act(async () => connect.click());
    await act(async () => {
      emit('output', { text: '<script>not executable</script>\nEnter this code: ABCD-12345' });
      emit('prompt', { url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' });
    });
    expect(container.querySelector('.login-connection a')?.getAttribute('href')).toBe('https://auth.openai.com/codex/device');
    expect(container.querySelector<HTMLDetailsElement>('.login-console-details')?.open).toBe(false);
    expect(container.querySelector('.login-code')?.textContent).toBe('ABCD-12345');
    expect(container.textContent).toContain('OpenAI 인증 페이지에 입력하세요');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    await act(async () => button('로그인 취소').click());
    expect(requests.some((r) => r.method === 'DELETE' && r.url.includes('codex'))).toBe(true);
    expect(container.querySelector('.login-console')).toBeNull();
    expect(container.textContent).not.toContain('ABCD-12345');
  });

  it('취소 전 코드 제출의 늦은 응답이 새 로그인 입력칸을 닫지 않는다', async () => {
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    let complete!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((url, options) => options?.method === 'PUT'
      ? new Promise((resolve) => { complete = resolve; }) : baseFetch(url, options));
    await act(async () => root.render(createElement(AgentPicker, { value: 'claude', onChange: () => {} })));
    await act(async () => button('계정 연결').click());
    await act(async () => {
      emit('input_ready', { loginId: 'old-session' });
      emit('prompt', { url: 'https://claude.ai/oauth/fake' });
    });
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'test-code#state-value');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => button('로그인 취소').click());
    await act(async () => button('계정 연결').click());
    await act(async () => {
      emit('input_ready', { loginId: 'new-session' });
      emit('prompt', { url: 'https://claude.ai/oauth/new' });
    });
    await act(async () => complete(new Response(null, { status: 204 })));
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.querySelector('.login-connection a')?.getAttribute('href')).toContain('/new');
  });
});
