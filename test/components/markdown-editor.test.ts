// @vitest-environment jsdom
import { createElement, useState, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownEditor } from '@/components/documents/MarkdownEditor';

const LABEL = '0-PRODUCT.md 본문';

// 부모가 본문을 쥔 것처럼 입력을 상태로 돌려준다 (탭을 바꿔도 값이 남는지 본다).
function Harness({ initial, readOnly, extra, onLink }: { initial: string; readOnly: boolean; extra?: { label: string; content: ReactNode }; onLink?: (href: string) => boolean }) {
  const [value, setValue] = useState(initial);
  return createElement(MarkdownEditor, { label: LABEL, value, readOnly, onChange: setValue, extra, onLink });
}

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

async function render(initial: string, readOnly = false, more: { extra?: { label: string; content: ReactNode }; onLink?: (href: string) => boolean } = {}) {
  await act(async () => root.render(createElement(Harness, { initial, readOnly, ...more })));
}
function tab(text: string) {
  const el = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === text);
  if (!el) throw new Error(`탭 없음: ${text}`);
  return el;
}
function selectedTab() {
  return container.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
}
function panels() {
  return container.querySelectorAll('[role="tabpanel"]');
}
function textarea() {
  return container.querySelector<HTMLTextAreaElement>('textarea');
}
async function click(el: HTMLElement) {
  await act(async () => el.click());
}
// 링크 클릭이 브라우저 이동으로 이어졌을지(막히지 않았는지)를 돌려준다. jsdom이 실제로 이동하지 않게 마지막에 막는다.
async function clickLink(a: Element): Promise<boolean> {
  let prevented = false;
  const spy = (event: Event) => { prevented = event.defaultPrevented; event.preventDefault(); };
  document.addEventListener('click', spy);
  await act(async () => (a as HTMLElement).click());
  document.removeEventListener('click', spy);
  return prevented;
}
async function press(el: HTMLElement, key: string) {
  await act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
}
// React가 입력으로 알아채도록 값 setter를 거쳐 input 이벤트를 보낸다.
async function typeInto(el: HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('마크다운 편집기 탭', () => {
  it('본문이 있으면 처음부터 미리 보기 탭이고 입력란은 없다', async () => {
    await render('# 제목\n\n본문');
    expect(selectedTab()).toBe('미리 보기');
    expect(textarea()).toBeNull();
    expect(container.querySelector('.editor-preview h1')?.textContent).toBe('제목');
  });

  it('빈 문서를 편집할 수 있으면 처음부터 마크다운 탭이고 입력란이 있다', async () => {
    await render('');
    expect(selectedTab()).toBe('마크다운');
    expect(textarea()?.readOnly).toBe(false);
  });

  it('빈 문서가 읽기 전용이면 미리 보기 탭이다', async () => {
    await render('', true);
    expect(selectedTab()).toBe('미리 보기');
  });

  it('처음 탭은 입력이 시작돼도 다시 고르지 않는다', async () => {
    await render('');
    await typeInto(textarea()!, '# 제목');
    expect(selectedTab()).toBe('마크다운');
  });

  it('탭을 바꿔도 입력한 내용이 남는다', async () => {
    await render('');
    await typeInto(textarea()!, '# 제목\n\n본문');
    await click(tab('미리 보기'));
    expect(container.querySelector('.editor-preview h1')?.textContent).toBe('제목');
    await click(tab('마크다운'));
    expect(textarea()!.value).toBe('# 제목\n\n본문');
  });

  it('읽기 전용 본문은 마크다운 탭에서도 고칠 수 없다', async () => {
    await render('본문', true);
    await click(tab('마크다운'));
    expect(textarea()!.readOnly).toBe(true);
  });

  it('한 번에 한 패널만 보이고 그 패널은 선택된 탭이 이름 붙인다', async () => {
    await render('# 제목');
    expect(panels()).toHaveLength(1);
    expect(panels()[0].getAttribute('aria-labelledby')).toBe(tab('미리 보기').id);
    await click(tab('마크다운'));
    expect(panels()).toHaveLength(1);
    expect(panels()[0].getAttribute('aria-labelledby')).toBe(tab('마크다운').id);
    expect(panels()[0].querySelector('textarea')).not.toBeNull();
  });

  it('탭은 aria-selected·aria-controls·roving tabIndex로 패널과 이어지고 tablist에 이름이 있다', async () => {
    await render('# 제목');
    expect(tab('미리 보기').getAttribute('aria-selected')).toBe('true');
    expect(tab('마크다운').getAttribute('aria-selected')).toBe('false');
    expect(tab('미리 보기').tabIndex).toBe(0);
    expect(tab('마크다운').tabIndex).toBe(-1);
    expect(tab('마크다운').getAttribute('aria-controls')).toBe(panels()[0].id);
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(`${LABEL} 보기 방식`);
  });

  it('화살표 키로 탭을 옮기고 포커스도 따라가며 Home·End도 동작한다', async () => {
    await render('');
    await press(tab('마크다운'), 'ArrowRight');
    expect(selectedTab()).toBe('미리 보기');
    expect(document.activeElement).toBe(tab('미리 보기'));
    await press(tab('미리 보기'), 'ArrowLeft');
    expect(selectedTab()).toBe('마크다운');
    expect(document.activeElement).toBe(tab('마크다운'));
    await press(tab('마크다운'), 'End');
    expect(selectedTab()).toBe('미리 보기');
    await press(tab('미리 보기'), 'Home');
    expect(selectedTab()).toBe('마크다운');
  });

  it('미리 보기에는 미리보기 머리글이 없다', async () => {
    await render('# 제목');
    expect(container.querySelector('.eyebrow')).toBeNull();
    expect(container.textContent).not.toContain('미리보기');
  });
});

describe('보조 탭과 링크', () => {
  const extra = { label: '저장소 원본', content: createElement('p', { id: 'original' }, '원본 내용') };
  const tabNames = () => [...container.querySelectorAll('[role="tab"]')].map((b) => b.textContent);

  it('보조 탭은 마지막에 붙고 열면 그 내용만 보인다', async () => {
    await render('# 제목', true, { extra });
    expect(tabNames()).toEqual(['마크다운', '미리 보기', '저장소 원본']);
    expect(selectedTab()).toBe('미리 보기');
    expect(container.querySelector('#original')).toBeNull();
    await click(tab('저장소 원본'));
    expect(container.querySelector('#original')?.textContent).toBe('원본 내용');
    expect(textarea()).toBeNull();
    expect(container.querySelector('.editor-preview')).toBeNull();
    expect(panels()).toHaveLength(1);
    expect(panels()[0].getAttribute('aria-labelledby')).toBe(tab('저장소 원본').id);
  });

  it('보조 탭이 없으면 탭은 둘이다', async () => {
    await render('# 제목');
    expect(tabNames()).toEqual(['마크다운', '미리 보기']);
  });

  it('화살표 키는 세 탭을 돌고 End는 보조 탭, Home은 마크다운으로 간다', async () => {
    await render('# 제목', true, { extra });
    await press(tab('미리 보기'), 'ArrowRight');
    expect(selectedTab()).toBe('저장소 원본');
    expect(document.activeElement).toBe(tab('저장소 원본'));
    await press(tab('저장소 원본'), 'ArrowRight');
    expect(selectedTab()).toBe('마크다운');
    await press(tab('마크다운'), 'ArrowLeft');
    expect(selectedTab()).toBe('저장소 원본');
    await press(tab('저장소 원본'), 'Home');
    expect(selectedTab()).toBe('마크다운');
    await press(tab('마크다운'), 'End');
    expect(selectedTab()).toBe('저장소 원본');
  });

  it('보조 탭이 사라지면 미리 보기로 돌아온다', async () => {
    await render('# 제목', true, { extra });
    await click(tab('저장소 원본'));
    await render('# 제목', true);
    expect(selectedTab()).toBe('미리 보기');
    expect(container.querySelector('.editor-preview h1')?.textContent).toBe('제목');
  });

  it('미리 보기의 링크는 onLink가 처리하면 브라우저 이동을 막고 아니면 그대로 둔다', async () => {
    const seen: string[] = [];
    await render('[문서](requirements/a.md) [밖](https://example.com)', true, { onLink: (href) => { seen.push(href); return href.startsWith('requirements/'); } });
    const links = container.querySelectorAll('.editor-preview a');
    expect(await clickLink(links[0])).toBe(true);
    expect(await clickLink(links[1])).toBe(false);
    expect(seen).toEqual(['requirements/a.md', 'https://example.com']);
  });

  it('onLink가 없으면 링크를 건드리지 않는다', async () => {
    await render('[문서](requirements/a.md)', true);
    expect(await clickLink(container.querySelector('.editor-preview a')!)).toBe(false);
  });
});
