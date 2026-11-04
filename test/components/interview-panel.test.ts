// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentChoice } from '@/components/AgentChoice';
import { InterviewPanel, interviewPhase } from '@/components/InterviewPanel';
import type { InterviewMessage, ProjectDetail } from '@/lib/contract';

const detail: ProjectDetail = { project: { id: 5, name: 'p', idea: 'i', designMd: null, createdAt: '', repo: 'owner/repo' }, batch: { state: 'running', currentPath: '0-PRODUCT.md', completedPaths: [], remainingPaths: ['0-PRODUCT.md'], error: null, reviewToken: 'x' }, repoContext: null, interview: null, documents: [], running: { kind: 'batch', path: null }, exportGate: { ok: false, blocking: [], upstreamChanged: [] } };
let host: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('InterviewPanel', () => {
  it('shows the seven coverage themes at start and summary, while batch activity locks interview actions', async () => {
    await act(async () => root.render(createElement(InterviewPanel, { projectId: 5, detail, refresh: async () => {} })));
    expect(host.textContent).toContain('측정 가능한 성공 기준');
    expect(host.textContent).toContain('MVP 포함·제외 범위');
    expect([...host.querySelectorAll('button')].filter((button) => ['인터뷰 시작', '건너뛰기'].includes(button.textContent?.trim() ?? '')).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => root.render(createElement(InterviewPanel, { projectId: 5, detail: { ...detail, running: null, batch: { ...detail.batch!, state: 'completed' }, interview: { status: 'summarized', agent: 'claude', hasSession: true, summary: 'summary', messages: [] } }, refresh: async () => {} })));
    for (const label of ['대상 사용자', '구체적인 문제와 사용 사례', 'MVP에 포함할 범위', 'MVP에서 제외할 범위', '우선순위와 의존성', '측정 가능한 성공 기준', '아직 정하지 못한 가정']) expect(host.textContent).toContain(label);
  });

  const msg = (id: number, role: InterviewMessage['role'], content: string): InterviewMessage => ({ id, role, content, createdAt: '' });
  const chat = (messages: InterviewMessage[]): ProjectDetail => ({ ...detail, running: null, interview: { status: 'active', agent: 'claude', hasSession: true, summary: null, messages } });
  const render = (d: ProjectDetail) => act(async () => root.render(createElement(InterviewPanel, { projectId: 5, detail: d, refresh: async () => {} })));
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  const click = (label: string) => act(async () => { button(label).click(); });
  const QA = [msg(1, 'agent', '질문1'), msg(2, 'user', '답1'), msg(3, 'agent', '질문2'), msg(4, 'user', '답2'), msg(5, 'agent', '질문3')];

  it('shows one question with its answer at a time, starting at the latest, and pages with prev/next', async () => {
    await render(chat(QA));
    expect(host.textContent).toContain('질문3');
    expect(host.textContent).not.toContain('질문2');
    expect(host.textContent).toContain('3 / 3');
    expect(button('다음 >').disabled).toBe(true);
    await click('< 이전');
    expect(host.textContent).toContain('질문2');
    expect(host.textContent).toContain('답2');
    expect(host.textContent).not.toContain('질문3');
    await click('< 이전');
    expect(host.textContent).toContain('질문1');
    expect(host.textContent).toContain('답1');
    expect(button('< 이전').disabled).toBe(true);
    await click('다음 >');
    expect(host.textContent).toContain('2 / 3');
  });

  it('jumps to the newest page when a message arrives, and shows no pager for a single question', async () => {
    await render(chat(QA.slice(0, 1)));
    expect(host.querySelector('[aria-label="질문 이동"]')).toBeNull();
    await render(chat(QA.slice(0, 3)));
    await click('< 이전');
    expect(host.textContent).toContain('질문1');
    await render(chat(QA));
    expect(host.textContent).toContain('질문3');
    expect(host.textContent).toContain('3 / 3');
  });

  it('has no agent picker of its own: a new interview starts with the agent chosen in the project header', async () => {
    const sse = 'event: done\ndata: {"text":"첫 질문"}\n\n';
    const fetchMock = vi.fn(async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await act(async () => root.render(createElement(AgentChoice.Provider, { value: 'codex' }, createElement(InterviewPanel, { projectId: 5, detail: { ...detail, running: null }, refresh: async () => {} }))));
      expect(host.querySelector('select, .agent-picker')).toBeNull();
      await click('인터뷰 시작');
      expect(fetchMock).toHaveBeenCalledWith('/api/projects/5/interview', expect.objectContaining({ body: JSON.stringify({ agent: 'codex' }) }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the interview on its own agent once a session exists, whatever the header chose', async () => {
    await render(chat(QA));
    expect(host.querySelector('select, .agent-picker')).toBeNull();
    expect(host.textContent).toContain('Claude 질문');
    expect(interviewPhase(chat(QA).interview)).toBe('chat');
  });

  it('clears the answer box once the answer was sent and the next question arrived', async () => {
    const sse = 'event: done\ndata: {"text":"다음 질문"}\n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })));
    try {
      await render(chat(QA));
      const box = host.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, '내 답');
        box.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(box.value).toBe('내 답');
      await act(async () => { button('보내기').click(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(box.value).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
