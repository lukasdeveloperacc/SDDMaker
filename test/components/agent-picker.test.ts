// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AgentPicker } from '@/components/AgentPicker';

it('작업 화면에서는 로그인 요청 없이 에이전트를 Select로 바꾸고 실행 중에는 잠근다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div');
  const root = createRoot(host);
  const onChange = vi.fn();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  try {
    await act(async () => root.render(createElement(AgentPicker, { value: 'claude', onChange })));
    const select = host.querySelector('select')!;
    expect(select).not.toBeNull();
    expect(host.querySelector('label')?.htmlFor).toBe(select.id);
    expect(host.querySelectorAll('option')).toHaveLength(2);
    expect(host.querySelector('button')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { select.value = 'codex'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith('codex');
    await act(async () => root.render(createElement(AgentPicker, { value: 'codex', onChange, disabled: true, lockedTo: 'codex' })));
    expect(select.disabled).toBe(true);
    expect(host.querySelector('option[value="claude"]')?.hasAttribute('disabled')).toBe(true);
    expect(select.value).toBe('codex');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
