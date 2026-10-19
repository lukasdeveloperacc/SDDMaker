import MarkdownIt from 'markdown-it';
import {
  BASE_DOCS,
  CHANGE_DOC,
  NAME_RE,
  type DocKind,
  type DocumentRecord,
  type DocumentView,
  type Gate,
  type HttpErrorCode,
  type InterviewStatus,
  type ProjectDetail,
  type RunKind,
} from '@/lib/contract';

const md = new MarkdownIt({ html: false });
type Token = ReturnType<typeof md.parse>[number];

const STAGE_OF: Record<string, number> = {
  '0-PRODUCT.md': 1,
  '1-SYSTEM-ARCHITECTURE.md': 2,
  '3-DATABASE.md': 3,
  '4-USERFLOW.md': 4,
};

export function stageOf(path: string): number {
  if (path in STAGE_OF) return STAGE_OF[path];
  if (path.startsWith('requirements/')) return 5;
  if (path.startsWith('screens/')) return 6;
  if (path === CHANGE_DOC) return 7;
  throw new Error(`unknown document path: ${path}`);
}

export function kindOf(path: string): DocKind {
  if ((BASE_DOCS as readonly string[]).includes(path)) return 'base';
  if (path.startsWith('requirements/')) return 'requirement';
  if (path.startsWith('screens/')) return 'screen';
  if (path === CHANGE_DOC) return 'change';
  throw new Error(`unknown document path: ${path}`);
}

// 'requirements/project.md' -> 'project', 'screens/home.html' -> 'home'. 나머지는 경로 그대로.
export function nameOf(path: string): string {
  const kind = kindOf(path);
  if (kind === 'requirement' || kind === 'screen') {
    return path.slice(path.indexOf('/') + 1).replace(/\.(md|html)$/, '');
  }
  return path;
}

const RESERVED_NAMES = ['agents', 'claude'];

// 본문의 마크다운 링크 중 대상 문서 모양인 것만 센다. 코드 안의 링크는 파서가 링크로 주지 않는다.
export function extractLinks(
  markdown: string,
  kind: 'requirements' | 'screens',
): { names: string[]; invalid: string[] } {
  const prefix = `${kind}/`;
  const suffix = kind === 'requirements' ? '.md' : '.html';
  const names = new Set<string>();
  const invalid = new Set<string>();
  const tokens: Token[] = md.parse(markdown, {});
  for (const tok of tokens) {
    if (tok.type !== 'inline' || !tok.children) continue;
    for (const child of tok.children) {
      if (child.type !== 'link_open') continue;
      const href = String(child.attrGet('href') ?? '').replace(/^\.\//, '').replace(/[#?].*$/, '');
      if (!href.startsWith(prefix) || !href.endsWith(suffix)) continue;
      const name = href.slice(prefix.length, href.length - suffix.length);
      const ok = NAME_RE.test(name) && !(kind === 'requirements' && RESERVED_NAMES.includes(name));
      (ok ? names : invalid).add(name);
    }
  }
  return { names: [...names], invalid: [...invalid] };
}

// 전체가 울타리 하나(``` 또는 ```markdown/```md)일 때만 벗긴다.
const FENCE_RE = /^```(?:markdown|md)?[^\S\n]*\n([\s\S]*?)\n?```$/;
export function stripFence(text: string): string {
  const t = text.trim();
  const m = FENCE_RE.exec(t);
  if (!m || m[1].includes('```')) return t;
  return m[1].trim();
}

function byStageThenPath(a: { path: string }, b: { path: string }): number {
  return stageOf(a.path) - stageOf(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

// 목록에서 빠진 요구사항·화면 경로. 기준 문서(0-PRODUCT·4-USERFLOW)가 승인된 경우에만 판정한다.
export function computeMissing(docs: DocumentRecord[]): Set<string> {
  const missing = new Set<string>();
  const find = (path: string) => docs.find((d) => d.path === path);
  const product = find('0-PRODUCT.md');
  if (product?.status === 'approved') {
    const names = new Set(extractLinks(product.content, 'requirements').names);
    for (const d of docs) {
      if (kindOf(d.path) === 'requirement' && !names.has(nameOf(d.path))) missing.add(d.path);
    }
  }
  const flow = find('4-USERFLOW.md');
  if (flow?.status === 'approved') {
    const names = new Set(extractLinks(flow.content, 'screens').names);
    for (const d of docs) {
      if (kindOf(d.path) === 'screen' && !names.has(nameOf(d.path))) missing.add(d.path);
    }
  }
  return missing;
}

// 승인 취소 시 "앞 문서 변경됨"을 붙일 경로: 뒤 단계 중 본문이 있는 문서.
export function laterWithContent(path: string, docs: DocumentRecord[]): string[] {
  return docs
    .filter((d) => stageOf(d.path) > stageOf(path) && d.content !== '')
    .sort(byStageThenPath)
    .map((d) => d.path);
}

interface Ctx {
  byPath: Map<string, DocumentRecord>;
  missing: Set<string>;
  interviewStatus: InterviewStatus | null;
  hasDesign: boolean;
}

type Check = { ok: true } | { ok: false; code: HttpErrorCode; reason: string };

// 생성 조건 (§4.4). 직전 단계 조건만 본다.
function creationCheck(path: string, ctx: Ctx): Check {
  const stage = stageOf(path);
  const approved = (p: string) => ctx.byPath.get(p)?.status === 'approved';
  const pre = (reason: string): Check => ({ ok: false, code: 'precondition', reason });
  if (stage === 1) {
    return ctx.interviewStatus === 'approved' || ctx.interviewStatus === 'skipped'
      ? { ok: true }
      : pre('인터뷰를 승인하거나 건너뛰어야 합니다');
  }
  if (stage <= 5) {
    const prev = BASE_DOCS[stage - 2];
    return approved(prev) ? { ok: true } : pre(`${prev}을(를) 먼저 승인해야 합니다`);
  }
  const reqs = [...ctx.byPath.values()].filter(
    (d) => kindOf(d.path) === 'requirement' && !ctx.missing.has(d.path),
  );
  if (stage === 6) {
    if (!reqs.every((d) => d.status === 'approved')) return pre('요구사항 문서를 모두 승인해야 합니다');
    return ctx.hasDesign ? { ok: true } : { ok: false, code: 'design_required', reason: '디자인 문서가 필요합니다' };
  }
  // stage 7
  const screens = [...ctx.byPath.values()].filter(
    (d) => kindOf(d.path) === 'screen' && !ctx.missing.has(d.path),
  );
  if (reqs.length === 0) return pre('요구사항 문서가 하나 이상 필요합니다');
  if (![...reqs, ...screens].every((d) => d.status === 'approved')) {
    return pre('요구사항 문서와 화면 정의서를 모두 승인해야 합니다');
  }
  return { ok: true };
}

function toGate(c: Check): Gate {
  return c.ok ? { ok: true } : { ok: false, code: c.code, reason: c.reason };
}

function generateGate(doc: DocumentRecord, ctx: Ctx, projectRunning: boolean): Gate {
  if (projectRunning) return { ok: false, code: 'busy', reason: '다른 작업이 실행 중입니다' };
  if (doc.status === 'approved') {
    return { ok: false, code: 'approved_locked', reason: '승인된 문서는 생성할 수 없습니다. 승인을 취소하세요' };
  }
  return toGate(creationCheck(doc.path, ctx));
}

function approveGate(
  doc: DocumentRecord,
  ctx: Ctx,
  self: boolean,
  links: DocumentView['links'],
): Gate {
  if (self) return { ok: false, code: 'busy', reason: '이 문서가 실행 중입니다' };
  if (ctx.missing.has(doc.path)) {
    return { ok: false, code: 'invalid_state', reason: '목록에서 빠진 문서는 승인할 수 없습니다' };
  }
  if (doc.status !== 'draft') return { ok: false, code: 'invalid_state', reason: '초안 상태에서만 승인할 수 있습니다' };
  if (doc.content.trim() === '') return { ok: false, code: 'invalid_state', reason: '본문이 비어 있습니다' };
  const c = creationCheck(doc.path, ctx);
  if (!c.ok) return toGate(c);
  if (doc.path === '0-PRODUCT.md' && links) {
    if (links.invalid.length > 0) {
      return { ok: false, code: 'invalid_links', reason: '이름 규칙에 어긋나는 요구사항 링크가 있습니다', items: links.invalid };
    }
    if (links.names.length === 0) {
      return { ok: false, code: 'invalid_links', reason: '요구사항 링크가 없습니다', items: [] };
    }
  }
  if (doc.path === '4-USERFLOW.md' && links && links.invalid.length > 0) {
    return { ok: false, code: 'invalid_links', reason: '이름 규칙에 어긋나는 화면 링크가 있습니다', items: links.invalid };
  }
  return { ok: true };
}

export function buildDocumentViews(input: {
  docs: DocumentRecord[];
  interviewStatus: InterviewStatus | null;
  hasDesign: boolean;
  running: { kind: RunKind; path: string | null } | null;
}): DocumentView[] {
  const byPath = new Map(input.docs.map((d) => [d.path, d] as const));
  const missing = computeMissing(input.docs);
  const ctx: Ctx = { byPath, missing, interviewStatus: input.interviewStatus, hasDesign: input.hasDesign };
  return [...input.docs].sort(byStageThenPath).map((d) => {
    const kind = kindOf(d.path);
    const links =
      d.path === '0-PRODUCT.md'
        ? extractLinks(d.content, 'requirements')
        : d.path === '4-USERFLOW.md'
          ? extractLinks(d.content, 'screens')
          : null;
    const running = input.running !== null && input.running.path === d.path;
    return {
      path: d.path,
      kind,
      stage: stageOf(d.path),
      name: nameOf(d.path),
      content: d.content,
      status: d.status,
      agent: d.agent,
      updatedAt: d.updatedAt,
      upstreamChanged: d.upstreamChanged,
      missingFromList: missing.has(d.path),
      canUndo: d.previousContent !== null,
      running,
      generate: generateGate(d, ctx, input.running !== null),
      approve: approveGate(d, ctx, running, links),
      links,
    };
  });
}

export function exportGate(views: DocumentView[]): ProjectDetail['exportGate'] {
  const blocking = views.filter((v) => v.status !== 'approved' || v.missingFromList).map((v) => v.path);
  const upstreamChanged = views.filter((v) => v.upstreamChanged).map((v) => v.path);
  return { ok: blocking.length === 0, blocking, upstreamChanged };
}

// 생성 입력으로 넘길 승인된 앞 문서 (§ documents.md#생성-입력).
export function inputDocsFor(path: string, docs: DocumentRecord[]): { path: string; content: string }[] {
  const missing = computeMissing(docs);
  const kind = kindOf(path);
  const approved = docs.filter((d) => d.status === 'approved' && !missing.has(d.path));
  const baseApproved = approved.filter((d) => kindOf(d.path) === 'base');
  let picked: DocumentRecord[];
  if (kind === 'base') {
    picked = baseApproved.filter((d) => stageOf(d.path) < stageOf(path));
  } else if (kind === 'requirement') {
    picked = baseApproved.slice(0, 4);
  } else if (kind === 'screen') {
    picked = [...baseApproved, ...approved.filter((d) => kindOf(d.path) === 'requirement')];
  } else {
    picked = approved.filter((d) => kindOf(d.path) !== 'screen');
  }
  return picked.sort(byStageThenPath).map((d) => ({ path: d.path, content: d.content }));
}

// 화면 파일 목록 ('screens/home.html'). 목록에서 빠진 화면은 뺀다.
export function screenFiles(docs: DocumentRecord[]): string[] {
  const missing = computeMissing(docs);
  return docs
    .filter((d) => kindOf(d.path) === 'screen' && !missing.has(d.path))
    .map((d) => d.path)
    .sort();
}
