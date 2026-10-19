import { getProject, getInterview, createInterview, tx, updateInterview } from '@/server/db';
import { getRun } from '@/server/runtime';
import { apiError, json, parseId } from '@/server/http';
import { interviewOf } from '@/server/interview-turn';

export const runtime = 'nodejs';

// 건너뛰기: 인터뷰가 없거나 active·summarized일 때. 대화는 지우지 않는다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (!getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (getRun(id)) return apiError(409, 'busy', '다른 작업이 진행 중입니다');

  const rec = getInterview(id);
  if (rec && (rec.status === 'approved' || rec.status === 'skipped')) {
    return apiError(409, 'invalid_state', '지금은 건너뛸 수 없습니다');
  }
  tx(() => {
    if (!rec) createInterview(id, null, 'skipped');
    else updateInterview(id, { status: 'skipped' });
  });
  return json({ interview: interviewOf(id) });
}
