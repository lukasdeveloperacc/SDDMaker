import { kindOf } from '@/server/doc-rules';
import { getProject, listDocuments, setDesign } from '@/server/db';
import { apiError, json, parseId, readJson } from '@/server/http';

export const runtime = 'nodejs';

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null || !getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const body = await readJson(req);
  if (!body || typeof body.designMd !== 'string') return apiError(400, 'invalid_input', '디자인 문서는 글이어야 합니다');
  const value = body.designMd.trim() === '' ? null : body.designMd;
  if (value === null && listDocuments(id).some((d) => kindOf(d.path) === 'screen')) {
    return apiError(409, 'design_required', '화면 정의서가 있으면 디자인 문서를 비울 수 없습니다');
  }
  return json({ project: setDesign(id, value) });
}
