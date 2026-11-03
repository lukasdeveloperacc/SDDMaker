// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InterviewPanel } from '@/components/InterviewPanel';
import type { ProjectDetail } from '@/lib/contract';

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
});
