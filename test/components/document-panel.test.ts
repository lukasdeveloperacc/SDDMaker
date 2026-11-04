// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentChoice } from '@/components/AgentChoice';
import { DocumentPanel, docLinkPath } from '@/components/documents/DocumentPanel';
import type { DocumentView, ProjectDetail } from '@/lib/contract';

const documentView: DocumentView = { path: '0-PRODUCT.md', kind: 'base', stage: 1, name: '0-PRODUCT.md', content: 'Draft <script>literal</script>', status: 'draft', agent: null, updatedAt: '', upstreamChanged: true, missingFromList: false, canUndo: false, running: false, generate: { ok: true }, approve: { ok: true }, links: null };
const detail: ProjectDetail = { project: { id: 4, name: 'p', idea: 'i', designMd: null, createdAt: '', repo: 'owner/repo' }, batch: null, repoContext: { baselineCommit: 'abc123', originals: [{ path: 'docs/0-PRODUCT.md', originalText: 'Original <script>literal</script>', omissionReason: null }] }, interview: null, documents: [documentView], running: null, exportGate: { ok: false, blocking: [], upstreamChanged: [] } };
let host: HTMLDivElement; let root: Root; let fetchMock: ReturnType<typeof vi.fn>; const refresh = vi.fn(async () => {});
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); refresh.mockClear(); });
async function click(el: HTMLElement) { await act(async () => { el.click(); await Promise.resolve(); }); }
// 링크 클릭이 브라우저 이동으로 이어졌을지(막히지 않았는지)를 돌려준다. jsdom이 실제로 이동하지 않게 마지막에 막는다.
async function clickLink(a: Element): Promise<boolean> {
  let prevented = false;
  const spy = (event: Event) => { prevented = event.defaultPrevented; event.preventDefault(); };
  document.addEventListener('click', spy);
  await act(async () => (a as HTMLElement).click());
  document.removeEventListener('click', spy);
  return prevented;
}
const tabNames = () => [...host.querySelectorAll('[role="tab"]')].map((b) => b.textContent);
const tab = (name: string) => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((b) => b.textContent === name)!;
function show(d: ProjectDetail, path: string, onNavigate: (key: string) => void = () => {}) {
  return act(async () => root.render(createElement(DocumentPanel, { projectId: 4, detail: d, path, refresh, onNavigate })));
}

describe('DocumentPanel repository review', () => {
  it('maps repository-relative original paths, renders text literally, and acknowledges a flagged draft without changing its status', async () => {
    await show(detail, '0-PRODUCT.md');
    // 저장소 원본은 따로 놓인 구역이 아니라 본문과 같은 탭 줄의 탭이다.
    expect(host.querySelector('[aria-label="저장소 원본과 비교"]')).toBeNull();
    expect(tabNames()).toEqual(['마크다운', '미리 보기', '저장소 원본']);
    expect(host.textContent).not.toContain('기준 커밋');
    await click(tab('저장소 원본'));
    expect(host.textContent).toContain('기준 커밋 abc123');
    expect(host.textContent).toContain('Original <script>literal</script>');
    expect(host.querySelector('script')).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ document: documentView }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === '확인했습니다')!;
    await click(button);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/4/documents/0-PRODUCT.md/acknowledge', expect.objectContaining({ method: 'POST' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('shows the omission reason instead of text when the original was not provided', async () => {
    const omitted: ProjectDetail = { ...detail, repoContext: { baselineCommit: 'abc123', originals: [{ path: 'docs/0-PRODUCT.md', originalText: null, omissionReason: 'redacted' }] } };
    await show(omitted, '0-PRODUCT.md');
    await click(tab('저장소 원본'));
    expect(host.textContent).toContain('민감 정보가 감지되어 원본 내용을 표시하지 않습니다.');
    expect(host.querySelector('pre')).toBeNull();
  });

  it('has no repository tab for a document without an original or outside a repository', async () => {
    await show({ ...detail, repoContext: { baselineCommit: 'abc123', originals: [] } }, '0-PRODUCT.md');
    expect(tabNames()).toEqual(['마크다운', '미리 보기']);
    await show({ ...detail, repoContext: null }, '0-PRODUCT.md');
    expect(tabNames()).toEqual(['마크다운', '미리 보기']);
  });

  it('puts an approved document in the same tabs, with the original as one of them instead of a second copy of the text', async () => {
    const approved: ProjectDetail = { ...detail, documents: [{ ...documentView, status: 'approved', upstreamChanged: false, content: '# 제품 정의' }] };
    await show(approved, '0-PRODUCT.md');
    expect(tabNames()).toEqual(['마크다운', '미리 보기', '저장소 원본']);
    expect(host.querySelector('.editor-preview h1')?.textContent).toBe('제품 정의');
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.querySelector('pre')).toBeNull(); // 현재 본문을 날것 그대로 한 번 더 보여 주지 않는다
    await click(tab('마크다운'));
    expect(host.querySelector('textarea')?.readOnly).toBe(true);
  });

  it('shows the original of an empty document below the actions because it has no text to tab with', async () => {
    const empty: ProjectDetail = { ...detail, documents: [{ ...documentView, status: 'empty', upstreamChanged: false, content: '' }] };
    await show(empty, '0-PRODUCT.md');
    expect(host.querySelector('[role="tab"]')).toBeNull();
    expect(host.querySelector('section[aria-label="저장소 원본"]')?.textContent).toContain('Original <script>literal</script>');
  });
});

describe('DocumentPanel run settings', () => {
  it('has no agent picker of its own: generate and regenerate use the agent chosen in the project header', async () => {
    const sse = () => new Response('event: done\ndata: {"text":"본문"}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    const bodyOf = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as { body: string }).body);
    const render = (d: ProjectDetail) => act(async () => root.render(createElement(AgentChoice.Provider, { value: 'codex' }, createElement(DocumentPanel, { projectId: 4, detail: d, path: '0-PRODUCT.md', refresh, onNavigate: () => {} }))));
    const empty: ProjectDetail = { ...detail, repoContext: null, documents: [{ ...documentView, status: 'empty', upstreamChanged: false, content: '' }] };
    await render(empty);
    expect(host.querySelector('select, .agent-picker')).toBeNull();
    fetchMock.mockResolvedValueOnce(sse());
    await click([...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === '생성')!);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/projects/4/documents/0-PRODUCT.md/generate');
    expect(bodyOf()).toEqual({ agent: 'codex' });

    await render({ ...detail, repoContext: null });
    expect(host.querySelector('select, .agent-picker')).toBeNull();
    const feedback = host.querySelector('textarea[aria-label="피드백"], label + textarea') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(feedback, '더 짧게');
      feedback.dispatchEvent(new Event('input', { bubbles: true }));
    });
    fetchMock.mockResolvedValueOnce(sse());
    await click([...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === '피드백으로 재생성')!);
    expect(bodyOf()).toEqual({ agent: 'codex', feedback: '더 짧게' });
  });
});

describe('DocumentPanel document links', () => {
  const recording: DocumentView = { ...documentView, path: 'requirements/recording.md', kind: 'requirement', name: 'recording', content: '', status: 'empty', upstreamChanged: false };
  const product: DocumentView = { ...documentView, status: 'approved', upstreamChanged: false, content: '[녹음](requirements/recording.md) [없음](requirements/none.md) [밖](https://example.com) [위로](#top)' };
  const withLinks: ProjectDetail = { ...detail, repoContext: null, documents: [product, recording] };

  it('moves to the linked document inside the project instead of loading a URL that 404s', async () => {
    const onNavigate = vi.fn();
    await show(withLinks, '0-PRODUCT.md', onNavigate);
    expect(await clickLink(host.querySelector('a[href="requirements/recording.md"]')!)).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith('requirements/recording.md');
    expect(host.textContent).not.toContain('없는 문서');
  });

  it('says so when the linked document is not in the project, and does not navigate', async () => {
    const onNavigate = vi.fn();
    await show(withLinks, '0-PRODUCT.md', onNavigate);
    expect(await clickLink(host.querySelector('a[href="requirements/none.md"]')!)).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('이 프로젝트에 없는 문서입니다: requirements/none.md');
  });

  it('leaves external addresses and anchors to the browser', async () => {
    const onNavigate = vi.fn();
    await show(withLinks, '0-PRODUCT.md', onNavigate);
    expect(await clickLink(host.querySelector('a[href="https://example.com"]')!)).toBe(false);
    expect(await clickLink(host.querySelector('a[href="#top"]')!)).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('follows links from a draft preview too', async () => {
    const onNavigate = vi.fn();
    await show({ ...withLinks, documents: [{ ...product, status: 'draft' }, recording] }, '0-PRODUCT.md', onNavigate);
    expect(await clickLink(host.querySelector('.editor-preview a[href="requirements/recording.md"]')!)).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith('requirements/recording.md');
  });
});

describe('docLinkPath', () => {
  it('resolves a link relative to the document that holds it', () => {
    expect(docLinkPath('0-PRODUCT.md', 'requirements/recording.md')).toBe('requirements/recording.md');
    expect(docLinkPath('0-PRODUCT.md', './requirements/recording.md#a')).toBe('requirements/recording.md');
    expect(docLinkPath('requirements/a.md', 'b.md')).toBe('requirements/b.md');
    expect(docLinkPath('requirements/a.md', '../0-PRODUCT.md?x=1')).toBe('0-PRODUCT.md');
    expect(docLinkPath('4-USERFLOW.md', 'screens/home.html')).toBe('screens/home.html');
  });

  it('leaves external addresses, root paths and anchors to the browser', () => {
    for (const href of ['https://example.com/a.md', 'mailto:a@b.c', '//cdn.example/y', '/requirements/a.md', '#top']) {
      expect(docLinkPath('0-PRODUCT.md', href)).toBeNull();
    }
  });
});
