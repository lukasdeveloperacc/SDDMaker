// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentPicker } from '@/components/AgentPicker';

let host: HTMLDivElement;
let root: Root;
const onChange = vi.fn();

// Node 최신 버전은 --localstorage-file 없이는 localStorage를 비워 두므로 메모리 저장소로 대신한다.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('localStorage', memoryStorage());
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function render(props: Record<string, unknown> = {}) {
  await act(async () => root.render(createElement(AgentPicker, { value: 'claude', onChange, ...props })));
}
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function typeInto(input: HTMLInputElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const saved = () => JSON.parse(localStorage.getItem('sddmaker:agent-options') ?? '{}');
const modelSelect = () => host.querySelector<HTMLSelectElement>('select.agent-model')!;
const optionTexts = (s: HTMLSelectElement) => [...s.options].map((o) => o.textContent);

it('작업 화면에서는 로그인 요청 없이 에이전트를 Select로 바꾸고 실행 중에는 잠근다', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await render();
  const select = host.querySelector('select')!;
  expect(select).not.toBeNull();
  expect(host.querySelector('label')?.htmlFor).toBe(select.id);
  expect(select.querySelectorAll('option')).toHaveLength(2);
  expect(host.querySelectorAll('select')).toHaveLength(3); // 에이전트, 모델, 추론 강도
  expect(host.querySelector('input')).toBeNull(); // 직접 입력을 고르기 전에는 입력란이 없다
  expect(host.querySelector('button')).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  await choose(select, 'codex');
  expect(onChange).toHaveBeenCalledWith('codex');
  await render({ value: 'codex', disabled: true, lockedTo: 'codex' });
  expect(select.disabled).toBe(true);
  expect(modelSelect().disabled).toBe(true);
  expect(host.querySelector('option[value="claude"]')?.hasAttribute('disabled')).toBe(true);
  expect(select.value).toBe('codex');
});

it('모델은 고른 뒤에도 모든 선택지가 남고 고른 값이 저장된다', async () => {
  await render();
  const model = modelSelect();
  expect(host.querySelector(`label[for="${model.id}"]`)?.textContent).toBe('모델');
  expect(optionTexts(model)).toEqual(['기본값', 'opus', 'sonnet', 'haiku', '직접 입력…']);
  await choose(model, 'opus');
  expect(saved().claude.model).toBe('opus');
  expect(optionTexts(model)).toEqual(['기본값', 'opus', 'sonnet', 'haiku', '직접 입력…']);
  await choose(model, 'sonnet');
  expect(saved().claude.model).toBe('sonnet');
  await choose(model, '');
  expect(saved().claude.model).toBeUndefined();
  expect(host.querySelector('input')).toBeNull();
});

it('직접 입력을 고르면 입력란이 생기고 현재 값에서 이어 적는다', async () => {
  await render();
  const model = modelSelect();
  await choose(model, 'opus');
  await choose(model, model.options[model.options.length - 1].value);
  const input = host.querySelector<HTMLInputElement>('input')!;
  expect(input.value).toBe('opus');
  await typeInto(input, 'my-model.v2');
  expect(saved().claude.model).toBe('my-model.v2');
  expect(input.getAttribute('aria-invalid')).toBe('false');
  await typeInto(input, 'bad model!');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(modelSelect().value).toBe(model.options[model.options.length - 1].value);
  await choose(model, 'haiku');
  expect(host.querySelector('input')).toBeNull();
  expect(saved().claude.model).toBe('haiku');
});

it('목록에 없는 모델이 저장돼 있으면 직접 입력 상태로 다시 열고, 에이전트를 바꾸면 그 에이전트의 값을 읽는다', async () => {
  localStorage.setItem('sddmaker:agent-options', JSON.stringify({ claude: { model: 'claude-x-1', effort: 'high' }, codex: { model: 'gpt-6-luna' } }));
  await render();
  expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('claude-x-1');
  expect(host.querySelector<HTMLSelectElement>('select.agent-effort')!.value).toBe('high');
  await render({ value: 'codex' });
  expect(host.querySelector('input')).toBeNull();
  expect(modelSelect().value).toBe('gpt-6-luna');
});
