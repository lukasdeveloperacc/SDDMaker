import { DOC_PATH_RE } from '@/lib/contract';
import { annotationPromptFor, parseAnnotations } from '@/server/annotations';
import { getDocument, getProject } from '@/server/db';
import { kindOf } from '@/server/doc-rules';
import { apiError, json, parseId, readJson } from '@/server/http';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id: rawId, path } = await ctx.params;
  const projectId = parseId(rawId);
  if (projectId === null || !getProject(projectId)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (!DOC_PATH_RE.test(path) || kindOf(path) !== 'screen') {
    return apiError(400, 'invalid_input', '화면 정의서만 주석을 달 수 있습니다');
  }
  const body = await readJson(req);
  const annotations = body && parseAnnotations(body.annotations);
  if (!annotations) return apiError(400, 'invalid_input', '주석이 올바르지 않습니다 (1개 이상 필요)');
  if (!getDocument(projectId, path)) return apiError(404, 'not_found', '문서를 찾을 수 없습니다');
  const prompt = annotationPromptFor(projectId, path, annotations);
  if (prompt === null) return apiError(404, 'not_found', '문서를 찾을 수 없습니다');
  return json({ prompt });
}
