// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainNav } from '@/components/MainNav';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(pathname: string) {
  route.pathname = pathname;
  await act(async () => root.render(createElement(MainNav)));
}

function link(label: string) {
  return [...container.querySelectorAll<HTMLAnchorElement>('nav a')].find((a) => a.textContent === label);
}

describe('MainNav', () => {
  it('주 메뉴 이름은 프로젝트와 연결이고 경로는 그대로다', async () => {
    await render('/');
    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('주 메뉴');
    expect([...container.querySelectorAll('nav a')].map((a) => a.textContent)).toEqual(['프로젝트', '연결']);
    expect(link('프로젝트')?.getAttribute('href')).toBe('/');
    expect(link('연결')?.getAttribute('href')).toBe('/settings/agents');
  });

  it.each(['/', '/projects/1'])('%s 에서는 프로젝트가 현재 메뉴다', async (pathname) => {
    await render(pathname);
    expect(link('프로젝트')?.getAttribute('aria-current')).toBe('page');
    expect(link('연결')?.hasAttribute('aria-current')).toBe(false);
  });

  it('/settings/agents 에서는 연결이 현재 메뉴다', async () => {
    await render('/settings/agents');
    expect(link('연결')?.getAttribute('aria-current')).toBe('page');
    expect(link('프로젝트')?.hasAttribute('aria-current')).toBe(false);
  });
});
