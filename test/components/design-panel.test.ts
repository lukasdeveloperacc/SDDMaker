// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentChoice } from '@/components/AgentChoice';
import { DesignPanel } from '@/components/screens/DesignPanel';
import type { AgentName, DocumentView, ProjectDetail } from '@/lib/contract';

function doc(path: string, over: Partial<DocumentView> = {}): DocumentView {
  return { path, kind: 'base', stage: 1, name: path, content: '', status: 'empty', agent: null, updatedAt: '', upstreamChanged: false, missingFromList: false, canUndo: false, running: false, generate: { ok: true }, approve: { ok: true }, links: null, ...over };
}
const req = (over: Partial<DocumentView> = {}) => doc('requirements/project.md', { kind: 'requirement', name: 'project', status: 'approved', content: '# project', ...over });
const screen = (name: string, over: Partial<DocumentView> = {}) => doc(`screens/${name}.html`, { kind: 'screen', name, ...over });

function detail(designMd: string | null, documents: DocumentView[], over: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    project: { id: 3, name: 'p', idea: 'i', designMd, createdAt: '', repo: null },
    batch: null, repoContext: null, interview: null, documents, running: null,
    exportGate: { ok: false, blocking: [], upstreamChanged: [] }, ...over,
  };
}
const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const sse = (text: string) => new Response(`event: done\ndata: ${JSON.stringify({ text })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const refresh = vi.fn(async () => {});
const renderScreen = vi.fn((path: string): ReactNode => createElement('div', { 'data-testid': 'anchor' }, `화면 패널 ${path}`));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  refresh.mockClear();
  renderScreen.mockClear();
});

async function render(d: ProjectDetail, agent: AgentName = 'claude') {
  await act(async () => root.render(createElement(AgentChoice.Provider, { value: agent }, createElement(DesignPanel, { projectId: 3, detail: d, refresh, renderScreen }))));
}
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const area = (label: string) => [...host.querySelectorAll('label')].find((l) => l.textContent === label)?.control as HTMLTextAreaElement;
async function click(el: HTMLElement) { await act(async () => { el.click(); await Promise.resolve(); }); }
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
async function type(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const bodyOf = (call: number) => JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body);

describe('DesignPanel', () => {
  it('요구사항이 다 승인되지 않으면 생성은 막고 이유를 보이되, 붙여 넣어 저장하는 것은 된다', async () => {
    await render(detail(null, [req({ status: 'draft' }), screen('home')]));
    expect(button('디자인 문서 생성')?.disabled).toBe(true);
    expect(host.textContent).toContain('요구사항 문서를 모두 승인하면 생성할 수 있습니다');
    expect(button('저장')?.disabled).toBe(true);

    await type(area('디자인 문서 (DESIGN.md)'), '# 붙여 넣은 문서');
    expect(button('저장')?.disabled).toBe(false);
    fetchMock.mockResolvedValueOnce(json(200, { project: {} }));
    await click(button('저장')!);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/3/design', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ designMd: '# 붙여 넣은 문서' }) }));
    expect(refresh).toHaveBeenCalled();
  });

  it('문서가 없으면 새로 만들고, 결과는 편집기에만 채우고 저장하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(sse('# 새 문서'));
    await render(detail(null, [req(), screen('home')]));
    expect(host.textContent).toContain('getdesign.md');
    expect(host.textContent).not.toContain('피드백 (선택)');
    await click(button('디자인 문서 생성')!);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/3/design/generate');
    expect(bodyOf(0)).toEqual({ agent: 'claude', base: '' });
    expect(area('디자인 문서 (DESIGN.md)').value).toBe('# 새 문서');
    expect(button('저장')?.disabled).toBe(false);
    expect(host.textContent).toContain('저장 안 한 변경이 있습니다');
  });

  it('이미 있는 문서는 base로 보내 반영해 만들고, 선택한 에이전트와 피드백을 싣는다', async () => {
    fetchMock.mockResolvedValueOnce(sse('# 보강된 문서'));
    await render(detail('# 붙여 넣은 문서', [req(), screen('home')]), 'codex');
    expect(button('이 문서를 반영해 다시 생성')).toBeDefined();
    await type(area('피드백 (선택)'), '버튼을 더 둥글게');
    await click(button('이 문서를 반영해 다시 생성')!);
    await flush();
    expect(bodyOf(0)).toEqual({ agent: 'codex', base: '# 붙여 넣은 문서', feedback: '버튼을 더 둥글게' });
    expect(area('디자인 문서 (DESIGN.md)').value).toBe('# 보강된 문서');
    expect(area('피드백 (선택)').value).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1); // PUT 없음
  });

  it('저장하지 않은 작업본은 그대로 base가 되고, 변경 버리기는 저장본으로 돌린다', async () => {
    fetchMock.mockResolvedValueOnce(sse('# 결과'));
    await render(detail('# 저장본', [req(), screen('home')]));
    await type(area('디자인 문서 (DESIGN.md)'), '# 손본 문서');
    await click(button('이 문서를 반영해 다시 생성')!);
    await flush();
    expect(bodyOf(0).base).toBe('# 손본 문서');
    await click(button('변경 버리기')!);
    expect(area('디자인 문서 (DESIGN.md)').value).toBe('# 저장본');
    expect(button('저장')?.disabled).toBe(true);
  });

  it('빈 결과는 작업본을 바꾸지 않고 오류로 알린다', async () => {
    fetchMock.mockResolvedValueOnce(sse('  '));
    await render(detail('# 저장본', [req(), screen('home')]));
    await click(button('이 문서를 반영해 다시 생성')!);
    await flush();
    expect(area('디자인 문서 (DESIGN.md)').value).toBe('# 저장본');
    expect(host.textContent).toContain('생성 결과가 비어 있습니다');
  });

  it('저장소 프로젝트는 요구사항 승인 없이 생성할 수 있고 기준 화면은 없다', async () => {
    const d = detail(null, [req({ status: 'draft' })]);
    d.project.repo = 'owner/repo';
    await render(d);
    expect(button('디자인 문서 생성')?.disabled).toBe(false);
    expect(host.textContent).toContain('저장소의 코드를 읽어');
    expect(host.textContent).not.toContain('기준 화면');
    expect(renderScreen).not.toHaveBeenCalled();
  });

  it('저장소 프로젝트도 화면 링크가 있으면 기준 화면(프로토타입)을 보여 준다', async () => {
    const d = detail('# 저장본', [req(), screen('home')]);
    d.project.repo = 'owner/repo';
    await render(d);
    expect(renderScreen).toHaveBeenLastCalledWith('screens/home.html');
    expect(host.textContent).not.toContain('화면(프로토타입)은 4-USERFLOW.md');
  });

  it('다른 작업이 돌고 있으면 버튼을 모두 막는다', async () => {
    await render(detail('# 저장본', [req(), screen('home')], { running: { kind: 'document', path: 'screens/home.html' } }));
    expect(button('이 문서를 반영해 다시 생성')?.disabled).toBe(true);
    expect(area('디자인 문서 (DESIGN.md)').disabled).toBe(true);
  });

  it('디자인 문서가 저장돼 있으면 기준 화면 패널을 보이고, 없으면 안내만 한다', async () => {
    await render(detail(null, [req(), screen('home')]));
    expect(host.textContent).toContain('디자인 문서를 저장하면 기준 화면을 만들 수 있습니다');
    expect(renderScreen).not.toHaveBeenCalled();

    await render(detail('# 저장본', [req(), screen('detail'), screen('home')]));
    expect(renderScreen).toHaveBeenLastCalledWith('screens/detail.html'); // 승인된 화면이 없으면 첫 화면
    expect(host.querySelector('[data-testid="anchor"]')?.textContent).toBe('화면 패널 screens/detail.html');
  });

  it('승인된 화면이 있으면 그것을 기준 화면으로 먼저 고르고, 목록에서 바꿀 수 있다', async () => {
    await render(detail('# 저장본', [req(), screen('detail'), screen('home', { status: 'approved', content: '<html></html>' }), screen('old', { missingFromList: true })]));
    expect(renderScreen).toHaveBeenLastCalledWith('screens/home.html');
    const select = host.querySelector('select')!;
    expect([...select.options].map((o) => o.value)).toEqual(['screens/detail.html', 'screens/home.html']); // 목록에서 빠진 화면은 없다
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'screens/detail.html');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(renderScreen).toHaveBeenLastCalledWith('screens/detail.html');
  });
});
