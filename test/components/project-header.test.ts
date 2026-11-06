// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectHeader } from '@/components/projects/ProjectHeader';
import { RunSettings } from '@/components/RunSettings';
import { beginRun } from '@/lib/run-activity';
import type { AgentName } from '@/lib/contract';

const project = { id: 3, name: '미팅노트', idea: '첫 줄\n\n둘째 줄', designMd: null, designHtml: null, createdAt: '', repo: 'lukasdeveloperacc/MeetingNote' };
let host: HTMLDivElement; let root: Root;
const onAgentChange = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear() });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); onAgentChange.mockClear(); });

type Over = Partial<{ project: typeof project }>;
const render = (over: Over = {}) => act(async () => root.render(createElement(ProjectHeader, { project, ...over })));
type SettingsOver = Partial<{ agent: AgentName; lockedTo: AgentName | null; disabled: boolean }>;
const renderSettings = (over: SettingsOver = {}) => act(async () => root.render(createElement(RunSettings, { agent: 'claude', onAgentChange, lockedTo: null, disabled: false, ...over })));

describe('ProjectHeader', () => {
  it('shows the project as a name tag: colour tile with the initial, title, repository chip and the idea as written', async () => {
    await render();
    expect(host.querySelector('h1')?.textContent).toBe('미팅노트');
    const mark = host.querySelector('.project-mark')!;
    expect(mark.textContent).toBe('미');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.getAttribute('data-tone')).toBe(String(3 % 6));
    const chip = host.querySelector<HTMLAnchorElement>('a.repo-chip')!;
    expect(chip.getAttribute('href')).toBe('https://github.com/lukasdeveloperacc/MeetingNote');
    expect(chip.target).toBe('_blank');
    expect(chip.rel).toContain('noopener');
    expect(chip.getAttribute('aria-label')).toContain('새 탭에서 열림');
    expect(host.querySelector('.project-idea')?.textContent).toBe('첫 줄\n\n둘째 줄');
    expect(host.querySelector('a.project-back')?.getAttribute('href')).toBe('/');
  });

  it('leaves out the repository chip and the idea when the project has neither', async () => {
    await render({ project: { ...project, repo: null as unknown as string, idea: '  ' } });
    expect(host.querySelector('.repo-chip')).toBeNull();
    expect(host.querySelector('.project-idea')).toBeNull();
  });

  it('shows a long idea in a few lines with a toggle, and no toggle when it already fits', async () => {
    // jsdom에는 레이아웃이 없어서, 잘린 글(scrollHeight > clientHeight)을 흉내 낸다.
    const heights = { scroll: 90, client: 90 };
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => heights.scroll });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => heights.client });
    try {
      await render();
      expect(host.querySelector('.idea-toggle')).toBeNull();
      heights.scroll = 300;
      await render({ project: { ...project, idea: '아주 긴 설명' } });
      const toggle = host.querySelector<HTMLButtonElement>('.idea-toggle')!;
      expect(toggle.textContent).toBe('더 보기');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelector('.project-idea')?.hasAttribute('data-open')).toBe(false);
      await act(async () => toggle.click());
      expect(host.querySelector('.idea-toggle')?.textContent).toBe('접기');
      expect(host.querySelector('.idea-toggle')?.getAttribute('aria-expanded')).toBe('true');
      expect(host.querySelector('.project-idea')?.hasAttribute('data-open')).toBe(true);
      await act(async () => host.querySelector<HTMLButtonElement>('.idea-toggle')!.click());
      expect(host.querySelector('.idea-toggle')?.textContent).toBe('더 보기');
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });

  it('has no run settings of its own (they live in the connections page and the work panel)', async () => {
    await render();
    expect(host.querySelector('.agent-picker, .run-settings')).toBeNull();
  });
});

describe('RunSettings', () => {
  it('holds one picker', async () => {
    await renderSettings();
    expect(host.querySelectorAll('.agent-picker')).toHaveLength(1);
    const agent = host.querySelector('select')!;
    await act(async () => { agent.value = 'codex'; agent.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onAgentChange).toHaveBeenCalledWith('codex');
  });

  it('pins the agent to the interview that is running, but still lets model and effort change', async () => {
    await renderSettings({ agent: 'codex', lockedTo: 'codex' });
    const agent = host.querySelector('select')!;
    expect(agent.value).toBe('codex');
    expect(agent.querySelector('option[value="claude"]')?.hasAttribute('disabled')).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('select.agent-model')!.disabled).toBe(false);
    expect(host.querySelector<HTMLSelectElement>('select.agent-effort')!.disabled).toBe(false);
    expect(host.querySelector('.run-settings .caption')?.textContent).toContain('시작한 에이전트');
    await renderSettings();
    expect(host.querySelector('.run-settings .caption')).toBeNull();
  });

  it('locks every setting while the project is running, from the server state or from a run in this browser', async () => {
    await renderSettings({ disabled: true });
    expect([...host.querySelectorAll('select')].every((s) => s.disabled)).toBe(true);
    await renderSettings({ disabled: false });
    expect([...host.querySelectorAll('select')].some((s) => s.disabled)).toBe(false);
    let end = () => {};
    await act(async () => { end = beginRun(); });
    expect([...host.querySelectorAll('select')].every((s) => s.disabled)).toBe(true);
    await act(async () => end());
    expect([...host.querySelectorAll('select')].some((s) => s.disabled)).toBe(false);
  });
});
