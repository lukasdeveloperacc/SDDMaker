// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentUsage } from '@/components/AgentUsage';
import type { AgentUsage as Usage, UsageResponse, UsageWindow } from '@/lib/contract';
import { USAGE_REFRESH_EVENT } from '@/lib/use-agent-run';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LEFT = 2 * HOUR + 12 * MIN; // 화면에는 '2h 12m'
const NOW = Date.parse('2026-10-20T12:00:00.000Z');
// 로컬 시각 09:05로 만든 ISO 값이라 TZ와 무관하게 '09:05'가 나와야 한다.
const READ_AT = new Date(2026, 9, 20, 9, 5).toISOString();

const win = (usedPercent: number, leftMs: number): UsageWindow => ({ usedPercent, resetsAt: new Date(NOW + leftMs).toISOString() });
const usage = (fiveHour: UsageWindow | null, weekly: UsageWindow | null = null, readAt: string | null = READ_AT): Usage => ({ fiveHour, weekly, readAt });
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

let root: Root;
let container: HTMLDivElement;
let payload: UsageResponse;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // 간격 타이머와 Date만 가짜로 둔다. setTimeout은 실제 값이어야 응답 본문 읽기가 끝난다.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  payload = { claude: null, codex: null };
  fetchMock = vi.fn(async () => json(payload));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

async function mount(next: UsageResponse) {
  payload = next;
  await act(async () => root.render(createElement(AgentUsage)));
  await flush();
}

function item(name: string) {
  return [...container.querySelectorAll<HTMLElement>('.usage-item')].find((el) => el.querySelector('.usage-name')?.textContent === name);
}

// 화면에 보이는 글자만 본다 (sr-only 라벨 제외).
function shown(el: Element | null | undefined): string {
  if (!el) throw new Error('요소 없음');
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('.sr-only').forEach((node) => node.remove());
  return copy.textContent ?? '';
}

function part(name: string, selector: '.usage-fivehour' | '.usage-weekly' | '.usage-compact'): string {
  return shown(item(name)?.querySelector(selector));
}

function fill(name: string) {
  return item(name)?.querySelector<HTMLElement>('.usage-fill');
}

describe('AgentUsage 표시', () => {
  it('두 에이전트의 5시간·주간 값과 마지막 읽은 시각을 보여 준다', async () => {
    await mount({
      claude: usage(win(45, LEFT), win(38, 5 * DAY + 7 * HOUR)),
      codex: usage(null, win(7, 6 * DAY + 4 * HOUR), null),
    });
    expect(part('Claude', '.usage-fivehour')).toBe('45% 2h 12m');
    expect(part('Claude', '.usage-weekly')).toBe('· 38% 5d 7h');
    expect(part('Codex', '.usage-fivehour')).toBe('—');
    expect(part('Codex', '.usage-weekly')).toBe('· 7% 6d 4h');
    expect(item('Claude')?.title).toBe('마지막으로 읽은 시각 09:05');
    expect(item('Codex')?.title).toBe('아직 읽은 값이 없습니다');
  });

  it('창 값이 없으면 —로 보이고 막대는 비어 있다', async () => {
    await mount({ claude: usage(null, null), codex: null });
    expect(part('Claude', '.usage-fivehour')).toBe('—');
    expect(part('Claude', '.usage-weekly')).toBe('· —');
    expect(part('Claude', '.usage-compact')).toBe('—');
    expect(fill('Claude')?.style.width).toBe('0%');
  });

  it('로그인되지 않은 에이전트는 숨긴다', async () => {
    await mount({ claude: null, codex: usage(win(7, 6 * DAY), null) });
    expect(container.querySelectorAll('.usage-item')).toHaveLength(1);
    expect(item('Claude')).toBeUndefined();
    expect(item('Codex')).toBeDefined();
  });

  it('두 에이전트가 모두 없으면 아무것도 그리지 않는다', async () => {
    await mount({ claude: null, codex: null });
    expect(container.childNodes).toHaveLength(0);
  });

  it.each<[number, string | undefined]>([
    [79, undefined],
    [80, 'is-warn'],
    [99, 'is-warn'],
    [100, 'is-danger'],
  ])('사용률 %d에서 막대와 축약 숫자의 톤이 바뀌고 숫자는 그대로 보인다', async (percent, tone) => {
    await mount({ claude: usage(win(percent, LEFT)), codex: null });
    const compact = item('Claude')?.querySelector('.usage-compact');
    expect(fill('Claude')?.classList.contains('is-warn')).toBe(tone === 'is-warn');
    expect(fill('Claude')?.classList.contains('is-danger')).toBe(tone === 'is-danger');
    expect(compact?.classList.contains('is-warn')).toBe(tone === 'is-warn');
    expect(compact?.classList.contains('is-danger')).toBe(tone === 'is-danger');
    expect(fill('Claude')?.style.width).toBe(`${percent}%`);
    expect(part('Claude', '.usage-fivehour')).toBe(`${percent}% 2h 12m`);
    expect(part('Claude', '.usage-compact')).toBe(`${percent}%`);
  });

  it('축약 숫자와 톤은 5시간·주간 중 높은 사용률을 쓰고, 막대 길이는 5시간 값을 쓴다', async () => {
    await mount({ claude: usage(win(85, LEFT), win(100, DAY)), codex: null });
    expect(fill('Claude')?.style.width).toBe('85%');
    expect(fill('Claude')?.classList.contains('is-danger')).toBe(true);
    expect(item('Claude')?.querySelector('.usage-compact')?.classList.contains('is-danger')).toBe(true);
    expect(part('Claude', '.usage-compact')).toBe('100%');
  });

  it('5시간이 낮고 주간이 높으면 축약 숫자와 톤은 주간 값, 막대 길이는 5시간 값을 쓴다', async () => {
    await mount({ claude: usage(win(10, LEFT), win(85, DAY)), codex: null });
    expect(fill('Claude')?.style.width).toBe('10%');
    expect(fill('Claude')?.classList.contains('is-warn')).toBe(true);
    expect(item('Claude')?.querySelector('.usage-compact')?.classList.contains('is-warn')).toBe(true);
    expect(part('Claude', '.usage-compact')).toBe('85%');
  });

  it('리셋이 지난 창의 사용률은 톤과 축약 숫자에 쓰지 않는다', async () => {
    await mount({ claude: usage(win(95, -MIN), win(30, 3 * DAY)), codex: null });
    expect(fill('Claude')?.classList.contains('is-warn')).toBe(false);
    expect(fill('Claude')?.classList.contains('is-danger')).toBe(false);
    expect(item('Claude')?.querySelector('.usage-compact')?.classList.contains('is-warn')).toBe(false);
    expect(part('Claude', '.usage-compact')).toBe('30%');
  });

  it('리셋 시각이 지난 창은 —로 보고 막대에도 쓰지 않는다', async () => {
    await mount({ claude: usage(win(95, -MIN)), codex: null });
    expect(part('Claude', '.usage-fivehour')).toBe('—');
    expect(part('Claude', '.usage-compact')).toBe('—');
    expect(fill('Claude')?.style.width).toBe('0%');
    expect(fill('Claude')?.classList.contains('is-warn')).toBe(false);
  });

  it('5시간 창이 지났으면 살아 있는 주간 창을 대표 값으로 쓴다', async () => {
    await mount({ claude: usage(win(95, -MIN), win(30, 3 * DAY)), codex: null });
    expect(part('Claude', '.usage-compact')).toBe('30%');
    expect(fill('Claude')?.style.width).toBe('30%');
  });

  it('주간 창만 있으면 막대와 축약 값을 주간 값으로 쓴다', async () => {
    await mount({ claude: null, codex: usage(null, win(7, 6 * DAY + 4 * HOUR)) });
    expect(part('Codex', '.usage-compact')).toBe('7%');
    expect(fill('Codex')?.style.width).toBe('7%');
    expect(part('Codex', '.usage-fivehour')).toBe('—');
  });

  it.each<[number, string]>([
    [30_000, '<1m'],
    [59 * MIN + 59_000, '59m'],
    [2 * HOUR + 12 * MIN + 30_000, '2h 12m'],
    [5 * DAY + 7 * HOUR, '5d 7h'],
  ])('남은 시간 %d ms는 %s로 보인다', async (leftMs, text) => {
    await mount({ claude: usage(win(45, leftMs)), codex: null });
    expect(part('Claude', '.usage-fivehour')).toBe(`45% ${text}`);
  });

  it('접근성: 묶음에 이름을 주고 5시간·주간 라벨은 낭독기에만 들리며 막대는 숨긴다', async () => {
    await mount({ claude: usage(win(45, LEFT), win(38, DAY)), codex: null });
    const group = container.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('에이전트 사용량');
    expect(group?.classList.contains('agent-usage')).toBe(true);
    expect(item('Claude')?.querySelector('.usage-fivehour .sr-only')?.textContent).toBe('5시간');
    expect(item('Claude')?.querySelector('.usage-weekly .sr-only')?.textContent).toBe('주간');
    expect(item('Claude')?.querySelector('.usage-bar')?.getAttribute('aria-hidden')).toBe('true');
    expect(item('Claude')?.querySelector('.usage-compact')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('AgentUsage 갱신', () => {
  it('1분마다 다시 계산해 리셋된 창을 —로 바꾸고, 탭이 보이면 다시 읽는다', async () => {
    await mount({ claude: usage(win(45, 30_000)), codex: null });
    expect(part('Claude', '.usage-fivehour')).toBe('45% <1m');
    await act(async () => { vi.advanceTimersByTime(MIN); });
    await flush();
    expect(part('Claude', '.usage-fivehour')).toBe('—');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('탭이 숨어 있으면 1분이 지나도 읽지 않고, 돌아오면 바로 읽는다', async () => {
    await mount({ claude: usage(win(45, LEFT)), codex: null });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => { vi.advanceTimersByTime(MIN); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    payload = { claude: usage(win(70, LEFT)), codex: null };
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(part('Claude', '.usage-fivehour')).toBe('70% 2h 11m');
  });

  it('USAGE_REFRESH_EVENT를 받으면 다시 읽고 새 값을 보여 준다', async () => {
    await mount({ claude: usage(win(45, LEFT)), codex: null });
    payload = { claude: usage(win(60, LEFT)), codex: null };
    await act(async () => { window.dispatchEvent(new Event(USAGE_REFRESH_EVENT)); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/agents/usage');
    expect(part('Claude', '.usage-fivehour')).toBe('60% 2h 12m');
  });

  it('다시 읽기가 실패하면 마지막으로 받은 값을 그대로 둔다', async () => {
    await mount({ claude: usage(win(45, LEFT)), codex: null });
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await act(async () => { window.dispatchEvent(new Event(USAGE_REFRESH_EVENT)); });
    await flush();
    expect(part('Claude', '.usage-fivehour')).toBe('45% 2h 12m');
  });

  it('처음 읽기가 실패하면 아무것도 그리지 않는다', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await mount({ claude: usage(win(45, LEFT)), codex: null });
    expect(container.childNodes).toHaveLength(0);
  });

  it('응답이 뒤섞여 와도 가장 나중에 요청한 응답만 쓰고, 읽는 중에는 그리지 않는다', async () => {
    const replies: Array<(res: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => replies.push(resolve)));
    await act(async () => root.render(createElement(AgentUsage)));
    await act(async () => { window.dispatchEvent(new Event(USAGE_REFRESH_EVENT)); });
    expect(replies).toHaveLength(2);
    expect(container.childNodes).toHaveLength(0);
    const [first, second] = replies;
    await act(async () => second!(json({ claude: usage(win(20, LEFT)), codex: null })));
    await act(async () => first!(json({ claude: usage(win(90, LEFT)), codex: null })));
    await flush();
    expect(part('Claude', '.usage-fivehour')).toBe('20% 2h 12m');
  });

  it('언마운트하면 타이머와 새로고침 리스너를 정리한다', async () => {
    await mount({ claude: usage(win(45, LEFT)), codex: null });
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new Event(USAGE_REFRESH_EVENT));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
