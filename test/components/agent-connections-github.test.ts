// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentConnections } from '@/components/AgentConnections';
import type { GithubStatus } from '@/lib/contract';

vi.mock('@/components/AgentTerminal', () => ({
  AgentTerminal: ({ agent, loginId, running }: { agent: string; loginId: string | null; running: boolean }) =>
    createElement('pre', { 'data-testid': 'terminal', 'data-agent': agent, 'data-login-id': loginId, 'data-running': String(running) }),
}));

type Session = { controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean };
let root: Root;
let container: HTMLDivElement;
let sessions: Session[];
let github: GithubStatus;
let requests: Array<{ url: string; method: string; body?: string }>;

const NOT_INSTALLED: GithubStatus = { installed: false, loggedIn: false, login: null, loginCommand: 'gh auth login --hostname github.com --web' };
const LOGGED_OUT: GithubStatus = { ...NOT_INSTALLED, installed: true };
const LOGGED_IN: GithubStatus = { ...LOGGED_OUT, loggedIn: true, login: 'octo' };
const AGENT_OFF = { installed: false, loggedIn: false, subscription: false, loginCommand: 'x' };

function emit(event: string, data: unknown) {
  const session = sessions.at(-1)!;
  session.controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}
function close() {
  const session = sessions.at(-1)!;
  if (session.closed) return;
  session.closed = true;
  session.controller.close();
}
// GitHub 행은 세 번째 연결 행이다 (Claude, Codex, GitHub 순서).
function githubRow() {
  const row = container.querySelectorAll<HTMLElement>('.connection-provider')[2];
  if (!row) throw new Error('GitHub 행 없음');
  return row;
}
function rowButton(text: string) {
  const el = [...githubRow().querySelectorAll('button')].find((b) => b.textContent === text);
  if (!el) throw new Error(`버튼 없음: ${text}`);
  return el;
}
async function render() {
  await act(async () => root.render(createElement(AgentConnections)));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  sessions = [];
  github = LOGGED_OUT;
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    const url = String(input);
    const method = options?.method ?? 'GET';
    requests.push({ url, method, body: options?.body as string | undefined });
    if (method === 'GET') {
      return new Response(JSON.stringify({ claude: AGENT_OFF, codex: AGENT_OFF, github }));
    }
    if (url.endsWith('/logout')) {
      github = LOGGED_OUT;
      return new Response(null, { status: 204 });
    }
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      sessions.push({ controller, closed: false });
    } }));
  }));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    for (const session of sessions) if (!session.closed) { session.closed = true; session.controller.close(); }
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe('GitHub 연결 행', () => {
  it('설치되지 않으면 미설치와 gh 안내를 보여 주고 연결 버튼을 숨긴다', async () => {
    github = NOT_INSTALLED;
    await render();
    expect(githubRow().querySelector('.connection-name')?.textContent).toBe('GitHub');
    expect(githubRow().textContent).toContain('미설치');
    expect(githubRow().textContent).toContain('gh 설치 후 GH_CLI로 경로를 지정할 수 있습니다.');
    expect([...githubRow().querySelectorAll('button')].map((b) => b.textContent)).toEqual([]);
  });

  it('로그아웃 상태면 미로그인으로 보여 주고 계정 연결을 제공한다', async () => {
    await render();
    expect(githubRow().textContent).toContain('미로그인');
    expect(githubRow().textContent).not.toContain('gh 설치 후');
    expect(rowButton('계정 연결')).toBeTruthy();
    expect(githubRow().querySelector('[aria-label="GitHub 연결 해제"]')).toBeNull();
  });

  it('간편 로그인은 기기 코드와 인증 페이지 링크를 보여 주고 완료하면 로그인됨이 된다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await render();
    await act(async () => rowButton('계정 연결').click());
    expect(requests.find((r) => r.method === 'POST')).toEqual({ url: '/api/agents/github/login', method: 'POST', body: JSON.stringify({ terminal: false }) });
    await act(async () => emit('prompt', { url: 'https://github.com/login/device', code: 'ABCD-1234' }));
    expect(githubRow().querySelector('a.btn-primary')?.getAttribute('href')).toBe('https://github.com/login/device');
    expect(githubRow().querySelector('.connection-code code')?.textContent).toBe('ABCD-1234');
    expect(githubRow().querySelector('form')).toBeNull();
    await act(async () => rowButton('코드 복사').click());
    expect(writeText).toHaveBeenCalledWith('ABCD-1234');
    expect(githubRow().querySelector('[role="tooltip"]')?.textContent).toBe('GitHub 페이지에서 기기 코드를 입력하세요.');

    github = LOGGED_IN;
    await act(async () => { emit('done', { loggedIn: true }); close(); });
    expect(githubRow().querySelector('.connection-code')).toBeNull();
    expect(githubRow().textContent).toContain('로그인됨 · octo');
  });

  it('터미널 탭에서는 GitHub 이름의 로그인 콘솔을 쓴다', async () => {
    await render();
    await act(async () => [...container.querySelectorAll('button')].find((b) => b.textContent === '터미널')!.click());
    await act(async () => rowButton('계정 연결').click());
    const terminal = githubRow().querySelector('[data-testid="terminal"]');
    expect(terminal?.getAttribute('data-agent')).toBe('github');
    expect(githubRow().querySelector('section.login-console')?.getAttribute('aria-label')).toBe('GitHub 계정 연결');
    expect(githubRow().querySelector('.login-terminal-header code')?.textContent).toBe('gh auth login --hostname github.com --web');
  });

  it('로그인되면 계정 이름과 연결 해제를 보여 주고, 해제하면 공식 로그아웃을 호출한 뒤 다시 읽는다', async () => {
    github = LOGGED_IN;
    await render();
    expect(githubRow().textContent).toContain('로그인됨 · octo');
    expect(githubRow().querySelector('[aria-label="GitHub 연결 해제"]')).not.toBeNull();
    await act(async () => rowButton('연결 해제').click());
    expect(requests).toContainEqual({ url: '/api/agents/github/logout', method: 'POST', body: undefined });
    expect(requests.at(-1)?.url).toBe('/api/agents');
    expect(githubRow().textContent).toContain('미로그인');
    expect(rowButton('계정 연결')).toBeTruthy();
  });
});
