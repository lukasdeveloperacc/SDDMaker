import type { Box } from '../contract';

// iframe 문서 좌표(스크롤 포함)의 사각형
export interface Rect { left: number; top: number; width: number; height: number }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ratio = (v: number, total: number) => (total > 0 ? clamp01(v / total) : 0);

export function toRatioBox(r: Rect, docWidth: number, docHeight: number): Box {
  return {
    x1: ratio(r.left, docWidth),
    y1: ratio(r.top, docHeight),
    x2: ratio(r.left + r.width, docWidth),
    y2: ratio(r.top + r.height, docHeight),
  };
}

// 안쪽(depth 큰) 것부터, 같은 depth면 면적 작은 것부터. 넓이가 0인 겹침은 제외.
export function overlapping(
  box: Rect,
  items: { name: string; rect: Rect; depth: number }[],
  max = 5,
): string[] {
  const hits = items.filter(({ rect }) => {
    const w = Math.min(box.left + box.width, rect.left + rect.width) - Math.max(box.left, rect.left);
    const h = Math.min(box.top + box.height, rect.top + rect.height) - Math.max(box.top, rect.top);
    return w > 0 && h > 0;
  });
  hits.sort((a, b) => b.depth - a.depth || a.rect.width * a.rect.height - b.rect.width * b.rect.height);
  return hits.slice(0, max).map((h) => h.name);
}

// 공백을 한 칸으로 줄인 뒤 앞 n자 (코드포인트 기준으로 자른다)
export function truncateLabel(text: string, n = 40): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, n).join('');
}
