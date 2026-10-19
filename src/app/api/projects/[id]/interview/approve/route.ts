import { getProject, getInterview, updateInterview } from '@/server/db';
import { getRun } from '@/server/runtime';
import { apiError, json, parseId } from '@/server/http';
import { interviewOf } from '@/server/interview-turn';

export const runtime = 'nodejs';

// 요약 승인: summarized이고 요약이 비어 있지 않을 때만.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (!getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (getRun(id)) return apiError(409, 'busy', '다른 작업이 진행 중입니다');

  const rec = getInterview(id);
  if (!rec || rec.status !== 'summarized' || (rec.summary ?? '').trim() === '') {
    return apiError(409, 'invalid_state', '승인할 요약이 없습니다');
  }
  updateInterview(id, { status: 'approved' });
  return json({ interview: interviewOf(id) });
}
