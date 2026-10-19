import { NAME_RE, type Annotation, type AnnotationTarget, type Box } from '@/lib/contract';
import { getDocument, getProject, listDocuments } from './db';
import { inputDocsFor, kindOf } from './doc-rules';
import { buildAnnotationPrompt } from './prompts';

const TAG_RE = /^[a-z][a-z0-9-]*$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function parseBox(v: unknown): Box | null {
  if (!isObj(v)) return null;
  const { x1, y1, x2, y2 } = v;
  if (![x1, y1, x2, y2].every((n) => typeof n === 'number' && n >= 0 && n <= 1)) return null;
  const box = { x1, y1, x2, y2 } as Box;
  return box.x1 <= box.x2 && box.y1 <= box.y2 ? box : null;
}

function parseTarget(v: unknown): AnnotationTarget | null {
  if (!isObj(v)) return null;
  if ('drawing' in v) {
    if (!isObj(v.drawing)) return null;
    const box = parseBox(v.drawing.box);
    const comps = v.drawing.components;
    if (!box || !Array.isArray(comps) || comps.length > 5) return null;
    if (!comps.every((c) => typeof c === 'string' && NAME_RE.test(c))) return null;
    return { drawing: { box, components: comps as string[] } };
  }
  const { component, tag, text } = v;
  if (typeof component !== 'string' || !NAME_RE.test(component)) return null;
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) return null;
  if (typeof text !== 'string') return null;
  return { component, tag, text };
}

// 주석 목록 검증. 1개 이상, 상한 없음. 어긋나면 null (호출한 쪽이 400을 낸다).
export function parseAnnotations(v: unknown): Annotation[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: Annotation[] = [];
  for (const item of v) {
    if (!isObj(item)) return null;
    if (item.kind !== 'change' && item.kind !== 'question') return null;
    if (typeof item.note !== 'string' || item.note.trim() === '') return null;
    const target = parseTarget(item.target);
    if (!target) return null;
    out.push({ kind: item.kind, target, note: item.note });
  }
  return out;
}

// 미리보기와 보내기가 함께 쓰는 프롬프트 조립. 프로젝트·문서가 없거나 화면이 아니면 null.
export function annotationPromptFor(projectId: number, path: string, annotations: Annotation[]): string | null {
  const project = getProject(projectId);
  const doc = getDocument(projectId, path);
  if (!project || !doc || kindOf(path) !== 'screen') return null;
  return buildAnnotationPrompt({
    path,
    annotations,
    html: doc.content,
    refs: inputDocsFor(path, listDocuments(projectId)),
    designMd: project.designMd,
  });
}
