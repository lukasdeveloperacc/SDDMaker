import { describe, expect, it } from 'vitest';
import { overlapping, toRatioBox, truncateLabel } from '@/lib/screens/geometry';

describe('toRatioBox', () => {
  it('문서 크기 대비 비율로 바꾸고 0..1로 자른다', () => {
    expect(toRatioBox({ left: 100, top: 200, width: 300, height: 100 }, 1000, 1000)).toEqual({
      x1: 0.1,
      y1: 0.2,
      x2: 0.4,
      y2: 0.3,
    });
    expect(toRatioBox({ left: -50, top: 900, width: 2000, height: 500 }, 1000, 1000)).toEqual({
      x1: 0,
      y1: 0.9,
      x2: 1,
      y2: 1,
    });
  });

  it('문서 크기가 0이면 0으로 본다', () => {
    expect(toRatioBox({ left: 10, top: 10, width: 10, height: 10 }, 0, 0)).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });
});

describe('overlapping', () => {
  const r = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

  it('겹치는 것만 안쪽(depth 큰) 것부터, 같은 depth면 면적 작은 것부터 돌려준다', () => {
    const box = r(0, 0, 100, 100);
    const names = overlapping(box, [
      { name: 'page-bg', rect: r(0, 0, 1000, 1000), depth: 1 },
      { name: 'big-card', rect: r(0, 0, 90, 90), depth: 3 },
      { name: 'small-btn', rect: r(10, 10, 5, 5), depth: 3 },
      { name: 'far', rect: r(500, 500, 10, 10), depth: 9 },
    ]);
    expect(names).toEqual(['small-btn', 'big-card', 'page-bg']);
  });

  it('최대 5개까지만 돌려준다', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ name: `c${i}`, rect: r(0, 0, 10 + i, 10), depth: i }));
    expect(overlapping(r(0, 0, 100, 100), items)).toHaveLength(5);
    expect(overlapping(r(0, 0, 100, 100), items)[0]).toBe('c7');
  });

  it('닿기만 하고 넓이가 없는 겹침은 뺀다', () => {
    expect(overlapping(r(0, 0, 10, 10), [{ name: 'x', rect: r(10, 0, 5, 5), depth: 1 }])).toEqual([]);
  });
});

describe('truncateLabel', () => {
  it('공백을 정리한 뒤 앞 40자만 남긴다', () => {
    expect(truncateLabel('  가   나\n다  ')).toBe('가 나 다');
    expect(truncateLabel('가'.repeat(50))).toBe('가'.repeat(40));
    expect(truncateLabel('abcdef', 3)).toBe('abc');
  });
});
