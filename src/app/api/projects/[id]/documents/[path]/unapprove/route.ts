import { flagUpstream, listDocuments, tx, updateDocument } from '@/server/db';
import { resolveDocRef, viewOf } from '@/server/documents';
import { laterWithContent } from '@/server/doc-rules';
import { apiError, json } from '@/server/http';

export const runtime = 'nodejs';

// 승인을 취소해 draft로 돌리고, 뒤 단계 본문에 "앞 문서 변경됨"을 붙인다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id, path } = await ctx.params;
  const ref = resolveDocRef(id, path);
  if (ref instanceof Response) return ref;
  const view = viewOf(ref);
  if (view.running) return apiError(409, 'busy', '이 문서가 실행 중입니다');
  if (view.status !== 'approved') return apiError(409, 'invalid_state', '승인된 문서만 승인을 취소할 수 있습니다');

  const flagged = laterWithContent(path, listDocuments(ref.projectId));
  tx(() => {
    updateDocument(ref.projectId, ref.path, { status: 'draft' });
    flagUpstream(ref.projectId, flagged);
  });
  return json({ document: viewOf(ref), flagged });
}
