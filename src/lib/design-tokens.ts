import yaml from 'js-yaml';

// 2-DESIGN.md 맨 앞 YAML 머리말의 토큰을 CSS 변수로 바꾼다 (에이전트 없이, 매번 같은 결과).
// colors.primary → --colors-primary, typography.body.fontSize → --typography-body-font-size,
// 값 안의 "{colors.primary}" 참조 → var(--colors-primary). 객체가 아닌 최상위 키(name·description)는 건너뛴다.
// 토큰이 없거나 머리말을 읽지 못하면 빈 문자열.
export function designTokensCss(designMd: string | null): string {
  const lines = tokenLines(designMd);
  if (lines.length === 0) return '';
  return `/* 2-DESIGN.md 머리말에서 만든 토큰. 값을 바꾸려면 디자인 문서를 고친다. */\n:root {\n${lines.join('\n')}\n}\n`;
}

// 프로젝트의 토큰 CSS: 머리말 토큰이 있으면 그것, 없으면 디자인 시스템 페이지가 정의한 첫 `:root` 블록.
// (getdesign.md 문서처럼 머리말이 없는 디자인 문서는 페이지가 토큰을 정한다.)
export function projectTokensCss(designMd: string | null, designHtml: string | null): string {
  const fromDoc = designTokensCss(designMd);
  if (fromDoc) return fromDoc;
  const root = (designHtml ?? '').match(/:root\s*\{[^{}<]*\}/);
  return root ? `/* 디자인 시스템 페이지(2-DESIGN.html)가 정의한 토큰. */\n${root[0]}\n` : '';
}

function tokenLines(designMd: string | null): string[] {
  const m = (designMd ?? '').match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!m) return [];
  let data: unknown;
  try {
    data = yaml.load(m[1]);
  } catch {
    return [];
  }
  if (!isObject(data)) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (isObject(value)) flatten(value, cssName(key), out);
  }
  return out;
}

function flatten(obj: Record<string, unknown>, prefix: string, out: string[]): void {
  for (const [key, value] of Object.entries(obj)) {
    const name = `${prefix}-${cssName(key)}`;
    if (isObject(value)) flatten(value, name, out);
    else {
      const v = cssValue(value);
      if (v !== null) out.push(`  --${name}: ${v};`);
    }
  }
}

function cssValue(value: unknown): string | null {
  const raw = Array.isArray(value) ? value.join(', ') : typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  if (raw === null || raw.trim() === '') return null;
  const v = raw.trim().replace(/\{([A-Za-z0-9_.-]+)\}/g, (_, ref: string) => `var(--${ref.split('.').map(cssName).join('-')})`);
  // 변수 선언을 끝내거나 style 밖으로 나가는 글자가 든 값은 버린다.
  return /[;{}<>]/.test(v) ? null : v;
}

function cssName(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
