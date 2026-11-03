// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentPanel } from '@/components/documents/DocumentPanel';
import type { DocumentView, ProjectDetail } from '@/lib/contract';

const documentView: DocumentView = { path: '0-PRODUCT.md', kind: 'base', stage: 1, name: '0-PRODUCT.md', content: 'Draft <script>literal</script>', status: 'draft', agent: null, updatedAt: '', upstreamChanged: true, missingFromList: false, canUndo: false, running: false, generate: { ok: true }, approve: { ok: true }, links: null };
const detail: ProjectDetail = { project: { id: 4, name: 'p', idea: 'i', designMd: null, createdAt: '', repo: 'owner/repo' }, batch: null, repoContext: { baselineCommit: 'abc123', originals: [{ path: 'docs/0-PRODUCT.md', originalText: 'Original <script>literal</script>', omissionReason: null }] }, interview: null, documents: [documentView], running: null, exportGate: { ok: false, blocking: [], upstreamChanged: [] } };
let host: HTMLDivElement; let root: Root; let fetchMock: ReturnType<typeof vi.fn>; const refresh = vi.fn(async () => {});
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); refresh.mockClear(); });
async function click(el: HTMLElement) { await act(async () => { el.click(); await Promise.resolve(); }); }

describe('DocumentPanel repository review', () => {
  it('maps repository-relative original paths, renders text literally, and acknowledges a flagged draft without changing its status', async () => {
    await act(async () => root.render(createElement(DocumentPanel, { projectId: 4, detail, path: '0-PRODUCT.md', refresh, onNavigate: () => {} })));
    expect(host.textContent).toContain('기준 커밋 abc123');
    expect(host.textContent).toContain('Original <script>literal</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('현재 초안');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ document: documentView }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === '확인했습니다')!;
    await click(button);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/4/documents/0-PRODUCT.md/acknowledge', expect.objectContaining({ method: 'POST' }));
    expect(refresh).toHaveBeenCalled();
  });
});
