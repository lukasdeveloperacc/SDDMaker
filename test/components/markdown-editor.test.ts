// @vitest-environment jsdom
import { createElement, useState, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkdownEditor } from '@/components/documents/MarkdownEditor';

const LABEL = '0-PRODUCT.md 본문';

// 부모가 본문을 쥔 것처럼 입력을 상태로 돌려준다 (탭을 바꿔도 값이 남는지 본다).
function Harness({ initial, readOnly }: { initial: string; readOnly: boolean }) {
  const [value, setValue] = useState(initial);
  return createElement(MarkdownEditor, { label: LABEL, value, readOnly, onChange: setValue });
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

async function render(initial: string, readOnly = false) {
  await act(async () => root.render(createElement(Harness, { initial, readOnly })));
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
