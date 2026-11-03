import { getProject } from '@/server/db';
import { approveBatch } from '@/server/batch';
import { acquireRun } from '@/server/runtime';
import { apiError, json, parseId, readJson } from '@/server/http';
export const runtime = 'nodejs';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null || !getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const body = await readJson(req);
  if (!body || typeof body.reviewToken !== 'string') return apiError(400, 'invalid_input', '검토 토큰이 필요합니다');
  const handle = acquireRun(id, 'batch', null);
  if (!handle) return apiError(409, 'busy', '다른 작업이 실행 중입니다');
  try { const result = approveBatch(id, body.reviewToken); return result instanceof Response ? result : json({ approved: result }); }
  finally { handle.release(); }
}
