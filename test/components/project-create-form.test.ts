// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateProjectForm } from '@/components/projects/CreateProjectForm';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
let host: HTMLDivElement; let root: Root; let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); router.push.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(CreateProjectForm, { onCancel: () => {} }))); }
async function click(el: HTMLElement) { await act(async () => { el.click(); await Promise.resolve(); }); }
async function flush() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); }
async function input(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function field(label: string) { const target = [...host.querySelectorAll('label')].find((item) => item.textContent?.trim() === label); return target ? document.getElementById(target.htmlFor) as HTMLInputElement | HTMLTextAreaElement : null; }
function submitButton() { return [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === '만들기')!; }
async function submitFromButton() {
  const button = submitButton();
  button.focus();
  expect(document.activeElement).toBe(button);
  await click(button);
}
function described(el: HTMLElement) { const id = el.getAttribute('aria-describedby'); return id ? document.getElementById(id)?.textContent : null; }
function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }

describe('CreateProjectForm mode interactions', () => {
  it('requires a repository for existing mode and omits a retained repository from new mode submission', async () => {
    await render();
    await click(host.querySelector<HTMLInputElement>('input[name="project-mode"][value="existing"]')!);
    expect(field('GitHub 저장소')).not.toBeNull();
    await submitFromButton();
    expect(host.textContent).toContain('기존 프로젝트에는 GitHub 저장소가 필요합니다.');

    await input(field('GitHub 저장소')!, 'owner/repo');
    await click(host.querySelector<HTMLInputElement>('input[name="project-mode"][value="new"]')!);
    expect(field('GitHub 저장소')).toBeNull();
    await input(field('프로젝트 이름')!, 'new idea');
    await input(field('아이디어')!, 'an idea');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ project: { id: 12 } }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    await submitFromButton();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: 'new idea', idea: 'an idea', designMd: '', mode: 'new' });
    expect(router.push).toHaveBeenCalledWith('/projects/12');
  });

  it('focuses each first local validation error and keeps its associated description', async () => {
    await render();
    await submitFromButton();
    const name = field('프로젝트 이름')!;
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(described(name)).toBe('프로젝트 이름을 입력하세요.');
    expect(described(field('아이디어')!)).toBe('아이디어를 입력하세요.');

    await input(name, '새 프로젝트');
    await submitFromButton();
    const idea = field('아이디어')!;
    expect(document.activeElement).toBe(idea);
    expect(idea.getAttribute('aria-invalid')).toBe('true');
    expect(described(idea)).toBe('아이디어를 입력하세요.');

    await click(host.querySelector<HTMLInputElement>('input[name="project-mode"][value="existing"]')!);
    await submitFromButton();
    const repo = field('GitHub 저장소')!;
    expect(document.activeElement).toBe(repo);
    expect(repo.getAttribute('aria-invalid')).toBe('true');
    expect(described(repo)).toBe('기존 프로젝트에는 GitHub 저장소가 필요합니다.');
  });

  it.each([
    ['repo_not_found', 404, '저장소를 찾을 수 없습니다.'],
    ['invalid_input', 400, '저장소 주소 형식이 올바르지 않습니다.'],
  ])('focuses the repository after server %s errors and preserves entered values', async (code, status, message) => {
    await render();
    await click(host.querySelector<HTMLInputElement>('input[name="project-mode"][value="existing"]')!);
    const repo = field('GitHub 저장소')!;
    const name = field('프로젝트 이름 (선택)')!;
    const idea = field('아이디어 (선택)')!;
    await input(repo, 'owner/missing');
    await input(name, 'kept name');
    await input(idea, 'kept idea');
    fetchMock.mockResolvedValueOnce(json(status, { code, message }));
    await submitFromButton();
    await flush();

    expect(document.activeElement).toBe(repo);
    expect(repo.value).toBe('owner/missing');
    expect(name.value).toBe('kept name');
    expect(idea.value).toBe('kept idea');
    expect(repo.getAttribute('aria-invalid')).toBe('true');
    expect(described(repo)).toContain(code === 'repo_not_found' ? '저장소를 찾을 수 없습니다' : message);
  });
});
