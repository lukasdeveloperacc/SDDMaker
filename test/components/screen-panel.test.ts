// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentChoice } from '@/components/AgentChoice';
import { ScreenPanel } from '@/components/screens/ScreenPanel';
import type { DocumentView, ProjectDetail } from '@/lib/contract';

const screen = (name: string): DocumentView => ({
  path: `screens/${name}.html`, kind: 'screen', stage: 5, name, content: '', status: 'empty', agent: null, updatedAt: '', upstreamChanged: false,
  missingFromList: false, canUndo: false, running: false, generate: { ok: true }, approve: { ok: true }, links: null,
});
const detail: ProjectDetail = {
  project: { id: 3, name: 'p', idea: 'i', designMd: null, designHtml: null, createdAt: '', repo: null },
  batch: null, repoContext: null, interview: null, documents: [screen('a'), screen('b'), screen('c')], running: null,
  exportGate: { ok: false, blocking: [], upstreamChanged: [] },
};

let host: HTMLDivElement;
let root: Root;
const onNavigate = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  onNavigate.mockClear();
});
async function render(path: string) {
  await act(async () => root.render(createElement(AgentChoice.Provider, { value: 'claude' }, createElement(ScreenPanel, {
    projectId: 3, detail, path, refresh: async () => {}, onNavigate, trail: [], onLinkNavigate: () => {}, onBack: () => {},
  }))));
}
const btn = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const key = (k: string, target: EventTarget = window) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

it('화면을 이전·다음 버튼과 ←/→ 키로 넘긴다', async () => {
  await render('screens/b.html');
  expect(host.textContent).toContain('2 / 3');
  btn('이전 화면').click();
  btn('다음 화면').click();
  await key('ArrowRight');
  await key('ArrowLeft');
  expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(['screens/a.html', 'screens/c.html', 'screens/c.html', 'screens/a.html']);

  const input = document.createElement('textarea');
  host.append(input);
  await key('ArrowRight', input); // 입력 중에는 넘기지 않는다
  expect(onNavigate).toHaveBeenCalledTimes(4);
});

it('처음과 끝에서는 더 넘기지 않는다', async () => {
  await render('screens/a.html');
  expect(btn('이전 화면').disabled).toBe(true);
  await key('ArrowLeft');
  expect(onNavigate).not.toHaveBeenCalled();
});
