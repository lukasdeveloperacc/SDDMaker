import { getProject } from '@/server/db';
import { apiError, parseId } from '@/server/http';
import { cancelRun, getRun } from '@/server/runtime';

export const runtime = 'nodejs';

// 화면을 떠나도 이어 가는 문서 생성(문서·요구사항 한 번에 만들기)을 취소한다. 다른 종류의 실행은 각자의 취소 경로를 쓴다.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null || !getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const run = getRun(id);
  if (!run) return new Response(null, { status: 204 });
  if (run.kind !== 'document' && run.kind !== 'requirements') return apiError(409, 'busy', '이 실행은 여기서 취소할 수 없습니다');
  await cancelRun(id);
  return new Response(null, { status: 204 });
}
