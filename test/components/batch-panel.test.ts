// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentChoice } from '@/components/AgentChoice';
import { BatchPanel } from '@/components/documents/BatchPanel';
import type { DocumentView, ProjectDetail } from '@/lib/contract';

function doc(path: string, over: Partial<DocumentView> = {}): DocumentView {
  return { path, kind: 'base', stage: 1, name: path, content: 'draft', status: 'draft', agent: 'claude', updatedAt: '', upstreamChanged: false, missingFromList: false, canUndo: false, running: false, generate: { ok: true }, approve: { ok: true }, links: null, ...over };
}
function detail(over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    project: { id: 9, name: 'repo', idea: 'idea', designMd: null, designHtml: null, createdAt: '', repo: 'owner/repo' },
    batch: { state: 'partial', currentPath: null, completedPaths: ['0-PRODUCT.md'], remainingPaths: ['1-SYSTEM-ARCHITECTURE.md'], error: null, reviewToken: 'review1' },
    repoContext: null, interview: { status: 'skipped', agent: null, hasSession: false, summary: null, messages: [] }, documents: [doc('0-PRODUCT.md')], running: null,
    exportGate: { ok: false, blocking: [], upstreamChanged: [] }, ...over,
  };
}
function json(status: number, value: unknown) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
let host: HTMLDivElement; let root: Root; let fetchMock: ReturnType<typeof vi.fn>; const refresh = vi.fn(async () => {});
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>; if (!proto.showModal) { proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); }; proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); }; } host = document.createElement('div'); document.body.append(host); root = createRoot(host); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); refresh.mockClear(); });
async function render(d: ProjectDetail) { await act(async () => root.render(createElement(BatchPanel, { projectId: 9, detail: d, refresh }))); }
function button(label: string) { return [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === label); }
async function click(el: HTMLElement) { await act(async () => { el.click(); await Promise.resolve(); }); }
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }

describe('BatchPanel', () => {
  it('requires explicit interview completion and offers remaining work after a partial run', async () => {
    await render(detail({ interview: { status: 'active', agent: 'claude', hasSession: true, summary: null, messages: [] } }));
    expect(button('남은 초안 이어 만들기')?.disabled).toBe(true);
    expect(host.textContent).toContain('인터뷰를 승인하거나 건너뛰면 시작할 수 있습니다');
    expect(host.textContent).toContain('완료 1개 · 남음 1개');
  });

  it('disables batch start while another run owns the project', async () => {
    await render(detail({ running: { kind: 'document', path: '0-PRODUCT.md' } }));
    expect(button('남은 초안 이어 만들기')?.disabled).toBe(true);
    expect(button('실행 취소')).toBeUndefined();
  });

  it('has no agent picker of its own: it runs with the agent chosen in the project header', async () => {
    const sse = () => new Response('event: done\ndata: {"batch":{"state":"completed","currentPath":null,"completedPaths":["0-PRODUCT.md"],"remainingPaths":[],"error":null,"reviewToken":"r"}}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    fetchMock.mockResolvedValueOnce(sse());
    await act(async () => root.render(createElement(AgentChoice.Provider, { value: 'codex' }, createElement(BatchPanel, { projectId: 9, detail: detail(), refresh }))));
    expect(host.querySelector('select, input, .agent-picker')).toBeNull();
    await click(button('남은 초안 이어 만들기')!);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/9/batch', expect.objectContaining({ body: JSON.stringify({ agent: 'codex' }) }));
  });

  it('keeps batch approval disabled for partial results and flagged drafts', async () => {
    await render(detail({ documents: [doc('0-PRODUCT.md', { upstreamChanged: true })] }));
    expect(button('검토한 초안 일괄 승인')?.disabled).toBe(true);
    await act(async () => root.render(createElement(BatchPanel, { projectId: 9, detail: { ...detail(), batch: { ...detail().batch!, state: 'completed' }, documents: [doc('0-PRODUCT.md', { upstreamChanged: true })] }, refresh })));
    expect(button('검토한 초안 일괄 승인')?.disabled).toBe(true);
  });

  it('ignores an obsolete flagged draft outside the active batch set', async () => {
    const stale = doc('requirements/old.md', { kind: 'requirement', upstreamChanged: true, missingFromList: true });
    const d = detail({ batch: { ...detail().batch!, state: 'completed' }, documents: [doc('0-PRODUCT.md'), stale] });
    await render(d);
    expect(button('검토한 초안 일괄 승인')?.disabled).toBe(false);
    await click(button('검토한 초안 일괄 승인')!);
    expect(host.querySelector('dialog')?.textContent).toContain('0-PRODUCT.md');
    expect(host.querySelector('dialog')?.textContent).not.toContain('requirements/old.md');
  });

  it('consumes batch SSE progress, delta, and completion events then refreshes the project', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('event: progress\ndata: {"batch":{"state":"running","currentPath":"0-PRODUCT.md","completedPaths":[],"remainingPaths":["0-PRODUCT.md"],"error":null,"reviewToken":"review1"}}\n\n'));
      controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"path":"0-PRODUCT.md","text":"draft"}\n\n'));
      controller.enqueue(new TextEncoder().encode('event: done\ndata: {"batch":{"state":"completed","currentPath":null,"completedPaths":["0-PRODUCT.md"],"remainingPaths":[],"error":null,"reviewToken":"review1"}}\n\n'));
      controller.close();
    } });
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    await render(detail());
    await click(button('남은 초안 이어 만들기')!);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/9/batch', expect.objectContaining({ method: 'POST', body: JSON.stringify({ agent: 'claude' }) }));
    // 에이전트 선택기에서 고른 모델·강도를 담은 헤더가 함께 간다
    expect((fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers).toHaveProperty('x-agent-options');
    expect(refresh).toHaveBeenCalled();
  });

  it('cancels an active batch using the DELETE route', async () => {
    await render(detail({ batch: { ...detail().batch!, state: 'running', currentPath: '0-PRODUCT.md' }, running: { kind: 'batch', path: null } }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await click(button('실행 취소')!);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/9/batch', expect.objectContaining({ method: 'DELETE' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the exact draft paths before one explicit token-bearing approval', async () => {
    const d = detail({ batch: { ...detail().batch!, state: 'completed', completedPaths: ['0-PRODUCT.md', 'changes/001-baseline.md'], remainingPaths: [] }, documents: [doc('0-PRODUCT.md'), doc('changes/001-baseline.md', { kind: 'change' })] });
    await render(d);
    await click(button('검토한 초안 일괄 승인')!);
    expect(host.querySelector('dialog')?.textContent).toContain('0-PRODUCT.md');
    expect(host.querySelector('dialog')?.textContent).toContain('changes/001-baseline.md');
    fetchMock.mockResolvedValueOnce(json(200, { approved: ['0-PRODUCT.md', 'changes/001-baseline.md'] }));
    await click(button('목록의 초안 승인')!);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/9/batch/approve', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reviewToken: 'review1' }) }));
    expect(refresh).toHaveBeenCalled();
  });

  it('keeps a stale review snapshot disabled until the user closes and rereviews', async () => {
    await render(detail({ batch: { ...detail().batch!, state: 'completed' } }));
    await click(button('검토한 초안 일괄 승인')!);
    fetchMock.mockResolvedValueOnce(json(409, { code: 'review_changed', message: 'changed' }));
    await click(button('목록의 초안 승인')!);
    await flush();
    expect(host.textContent).toContain('문서가 검토 후 바뀌었습니다');
    expect(button('목록의 초안 승인')?.disabled).toBe(true);
  });
});
