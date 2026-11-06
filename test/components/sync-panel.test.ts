// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncPanel } from '@/components/documents/SyncPanel';
import type { DocumentView, ProjectDetail } from '@/lib/contract';

function doc(path: string, over: Partial<DocumentView> = {}): DocumentView {
  return { path, kind: 'requirement', stage: 5, name: path, content: '본문', status: 'approved', agent: 'claude', updatedAt: '', upstreamChanged: false, missingFromList: false, canUndo: false, running: false, generate: { ok: true }, approve: { ok: true }, links: null, ...over };
}
function detail(documents: DocumentView[], running: ProjectDetail['running'] = null): ProjectDetail {
  return {
    project: { id: 9, name: 'p', idea: 'i', designMd: null, designHtml: null, createdAt: '', repo: null },
    batch: null, repoContext: null, interview: null, documents, running,
    exportGate: { ok: false, blocking: [], upstreamChanged: [] },
  };
}
let host: HTMLDivElement; let root: Root; const refresh = vi.fn(async () => {}); let fetchMock: ReturnType<typeof vi.fn>;
const sse = () => new Response(`event: done\ndata: ${JSON.stringify({ text: JSON.stringify({ done: ['requirements/a.md'], unchanged: ['screens/s.html'], failed: [] }) })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  fetchMock = vi.fn(async () => sse()); vi.stubGlobal('fetch', fetchMock);
  const store = new Map<string, string>(); // 이 환경의 localStorage는 믿을 수 없어 가짜로 바꾼다
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), clear: () => store.clear() });
  localStorage.setItem('sddmaker:auto-sync', 'off'); // 기본 테스트는 자동 실행 없이 본다
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); refresh.mockClear(); vi.unstubAllGlobals(); });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
async function render(d: ProjectDetail) { await act(async () => root.render(createElement(SyncPanel, { projectId: 9, detail: d, refresh }))); }

describe('SyncPanel', () => {
  it('표시된 요구사항·화면만 세어 버튼에 보인다', async () => {
    await render(detail([
      doc('requirements/a.md', { upstreamChanged: true }),
      doc('screens/s.html', { kind: 'screen', stage: 6, upstreamChanged: true }),
      doc('requirements/b.md'),
      doc('requirements/c.md', { upstreamChanged: true, content: '' }),
      doc('changes/001-mvp.md', { kind: 'change', stage: 7, upstreamChanged: true }),
    ]));
    expect(host.querySelector('button')?.textContent).toContain('2개');
  });

  it('표시된 문서가 없으면 아무것도 그리지 않고, 다른 작업 중이면 비활성이다', async () => {
    await render(detail([doc('requirements/a.md')]));
    expect(host.innerHTML).toBe('');
    await render(detail([doc('requirements/a.md', { upstreamChanged: true })], { kind: 'document', path: 'x' }));
    expect((host.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
  });

  const base = () => ['0-PRODUCT.md', '1-SYSTEM-ARCHITECTURE.md', '3-DATABASE.md', '4-USERFLOW.md'].map((p) => doc(p, { kind: 'base', stage: 1 }));

  it('기본 문서가 모두 승인돼 있고 표시된 문서가 있으면 자동으로 한 번 실행한다', async () => {
    localStorage.setItem('sddmaker:auto-sync', 'on');
    const d = detail([...base(), doc('requirements/a.md', { upstreamChanged: true })]);
    await render(d);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/projects/9/sync');
    expect(host.textContent).toContain('1개 갱신 · 1개는 고칠 곳이 없어');
    await render(d); // 같은 문서를 다시 자동으로 시도하지 않는다
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('기본 문서가 승인 전이면 자동으로 실행하지 않는다', async () => {
    localStorage.setItem('sddmaker:auto-sync', 'on');
    await render(detail([...base().slice(0, 3), doc('4-USERFLOW.md', { kind: 'base', status: 'draft' }), doc('requirements/a.md', { upstreamChanged: true })]));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('기본 문서를 모두 승인하면');
  });

  it('자동 반영을 끄면 실행하지 않는다 (버튼으로만)', async () => {
    await render(detail([...base(), doc('requirements/b.md', { upstreamChanged: true })])); // 설정은 off
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
