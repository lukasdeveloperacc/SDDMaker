import { getProject, getInterview, listDocuments, tx, updateInterview, flagUpstream } from '@/server/db';
import { getRun } from '@/server/runtime';
import { apiError, json, parseId } from '@/server/http';
import { interviewOf } from '@/server/interview-turn';

export const runtime = 'nodejs';

// 승인 취소: approved → summarized. 본문이 있는 문서 전부에 앞 문서 변경 표시를 붙인다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (!getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (getRun(id)) return apiError(409, 'busy', '다른 작업이 진행 중입니다');

  const rec = getInterview(id);
  if (!rec || rec.status !== 'approved') return apiError(409, 'invalid_state', '승인된 요약이 없습니다');

  const flagged = listDocuments(id)
    .filter((d) => d.content !== '')
    .map((d) => d.path);
  tx(() => {
    updateInterview(id, { status: 'summarized' });
    flagUpstream(id, flagged);
  });
  return json({ interview: interviewOf(id), flagged });
}
