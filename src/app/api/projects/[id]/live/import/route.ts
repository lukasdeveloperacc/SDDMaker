import { getProject } from '@/server/db';
import { apiError, json, parseId } from '@/server/http';
import { batchBusy } from '@/server/runtime';
import { importLive } from '@/server/live';

export const runtime = 'nodejs';

// live에서 바뀐 화면을 프로젝트에 저장한다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null || !getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (batchBusy(id)) return apiError(409, 'busy', '전체 초안 작업이 실행 중입니다');
  return json(importLive(id));
}
