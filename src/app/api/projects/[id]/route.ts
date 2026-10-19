import { cancelRun, getRun } from '@/server/runtime';
import { deleteProject, getProject } from '@/server/db';
import { projectDetail } from '@/server/documents';
import { apiError, json, parseId } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  const detail = id === null ? null : projectDetail(id);
  if (!detail) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  return json(detail);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null || !getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  // 실행 중이면 먼저 끝내고, 잠금이 풀리지 않으면 지우지 않는다.
  await cancelRun(id);
  if (getRun(id) !== null) return apiError(409, 'busy', '실행이 끝난 뒤 삭제할 수 있습니다');
  deleteProject(id);
  return new Response(null, { status: 204 });
}
