export interface MergeResult {
  html: string;
  applied: string[];
  warnings: { name: string | null; reason: 'not_found' | 'multiple_roots' | 'no_component' | 'duplicate' | 'nested' }[];
  text: string;
}

const REMOVED_TAGS = ['script', 'iframe', 'object', 'embed'];
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);

// 브라우저는 공백·제어문자를 무시하고 스킴을 읽으므로 그것들을 뺀 뒤 검사한다
function isScriptUrl(value: string): boolean {
  const v = value.replace(/[\u0000-\u0020]/g, '').toLowerCase();
  return v.startsWith('javascript:') || v.startsWith('vbscript:') || v.startsWith('data:text/html');
}
const BLOCK_SOURCE = '```html[ \\t]*\\r?\\n([\\s\\S]*?)```';

function blockRe(): RegExp {
  return new RegExp(BLOCK_SOURCE, 'g');
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

// 요소와 <template> 안 내용까지 모두 돈다 (template 안 스크립트도 지우려고)
function walk(root: ParentNode, fn: (el: Element) => void): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    fn(el);
    if (el.localName === 'template') walk((el as HTMLTemplateElement).content, fn);
  }
}

function sanitizeDoc(doc: Document): void {
  walk(doc, (el) => {
    if (REMOVED_TAGS.includes(el.localName)) {
      el.remove();
      return;
    }
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || (URL_ATTRS.has(attr.name) && isScriptUrl(attr.value))) {
        el.removeAttribute(attr.name);
      }
    }
  });
}

function serialize(doc: Document): string {
  return (doc.doctype ? '<!DOCTYPE html>\n' : '') + doc.documentElement.outerHTML;
}

export function extractHtml(response: string): string {
  const m = new RegExp(BLOCK_SOURCE).exec(response);
  return (m ? m[1] : response).trim();
}

export function sanitizeHtml(html: string): string {
  const doc = parse(html);
  sanitizeDoc(doc);
  return serialize(doc);
}

export function frameOf(doc: Document): 'mobile' | 'page' {
  return doc.documentElement.getAttribute('data-frame') === 'mobile' ? 'mobile' : 'page';
}

export function componentNames(doc: Document): { unique: string[]; duplicates: string[] } {
  const count = new Map<string, number>();
  for (const el of Array.from(doc.querySelectorAll('[data-component]'))) {
    const name = el.getAttribute('data-component') ?? '';
    if (name) count.set(name, (count.get(name) ?? 0) + 1);
  }
  const unique: string[] = [];
  const duplicates: string[] = [];
  for (const [name, n] of count) (n === 1 ? unique : duplicates).push(name);
  return { unique, duplicates };
}

// '<name>.html' 또는 './<name>.html' (#앵커 허용) → 'screens/<name>.html'. 그 밖은 null.
export function screenLinkTarget(href: string | null): string | null {
  const m = href === null ? null : /^(?:\.\/)?([a-z0-9-]+)\.html(?:#.*)?$/.exec(href);
  return m ? `screens/${m[1]}.html` : null;
}

// 링크 대상은 'screens/<name>.html' 형식이고, existing도 같은 형식이다.
export function missingScreenLinks(doc: Document, existing: string[]): string[] {
  const missing: string[] = [];
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const target = screenLinkTarget(a.getAttribute('href'));
    if (target && !existing.includes(target) && !missing.includes(target)) missing.push(target);
  }
  return missing;
}

export function applyBlocks(currentHtml: string, response: string): MergeResult {
  const blocks = Array.from(response.matchAll(blockRe()), (m) => m[1]);
  const text = response.replace(blockRe(), '').trim();
  const doc = parse(currentHtml);
  const existing = Array.from(doc.querySelectorAll('[data-component]'));
  const sameName = (name: string) => existing.filter((el) => el.getAttribute('data-component') === name);

  const warnings: MergeResult['warnings'] = [];
  const candidates: { name: string; root: Element; target: Element }[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const roots = Array.from(parse(`<body>${block}</body>`).body.children);
    if (roots.length !== 1) {
      warnings.push({ name: null, reason: 'multiple_roots' });
      continue;
    }
    const root = roots[0];
    const name = root.getAttribute('data-component');
    if (!name) {
      warnings.push({ name: null, reason: 'no_component' });
      continue;
    }
    const targets = sameName(name);
    if (targets.length === 0) {
      warnings.push({ name, reason: 'not_found' });
    } else if (targets.length > 1 || seen.has(name)) {
      warnings.push({ name, reason: 'duplicate' });
    } else {
      seen.add(name);
      candidates.push({ name, root, target: targets[0] });
    }
  }

  // 다른 후보 안에 든 후보는 뺀다 (바깥 것만 적용, 순서와 무관)
  const applied: typeof candidates = [];
  for (const c of candidates) {
    if (candidates.some((o) => o.target !== c.target && o.target.contains(c.target))) {
      warnings.push({ name: c.name, reason: 'nested' });
    } else {
      applied.push(c);
    }
  }

  if (applied.length === 0) return { html: currentHtml, applied: [], warnings, text };

  for (const c of applied) c.target.replaceWith(doc.importNode(c.root, true));
  sanitizeDoc(doc);
  return { html: serialize(doc), applied: applied.map((c) => c.name), warnings, text };
}

// 미리보기 표시용 사본. 저장 HTML은 바꾸지 않는다.
export function previewDocument(html: string): string {
  const doc = parse(html);
  const base = doc.createElement('base');
  base.setAttribute('target', '_blank');
  const csp = doc.createElement('meta');
  csp.setAttribute('http-equiv', 'Content-Security-Policy');
  csp.setAttribute('content', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  for (const meta of Array.from(doc.querySelectorAll('meta[http-equiv]'))) {
    if ((meta.getAttribute('http-equiv') ?? '').toLowerCase() === 'refresh') meta.remove();
  }
  doc.head.prepend(base, csp);
  return serialize(doc);
}
