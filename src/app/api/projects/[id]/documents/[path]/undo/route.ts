import { laterWithContent } from '@/server/doc-rules';
import { batchBusy } from '@/server/runtime';
import { flagUpstream, getDocument, listDocuments, tx, updateDocument } from '@/server/db';
import { resolveDocRef, viewOf } from '@/server/documents';
import { apiError, json } from '@/server/http';

export const runtime = 'nodejs';

// 마지막 생성·재생성 직전 본문으로 되돌린다 (1회분).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id, path } = await ctx.params;
  const ref = resolveDocRef(id, path);
  if (ref instanceof Response) return ref;
  if (batchBusy(ref.projectId)) return apiError(409, 'busy', '전체 초안 작업이 실행 중입니다');
  const view = viewOf(ref);
  if (view.status === 'approved') return apiError(409, 'approved_locked', '승인된 문서는 되돌릴 수 없습니다. 승인을 취소하세요');
  if (view.running) return apiError(409, 'busy', '이 문서가 실행 중입니다');
  const cur = getDocument(ref.projectId, ref.path);
  if (!cur) return apiError(404, 'not_found', '문서를 찾을 수 없습니다');
  if (cur.previousContent === null) return apiError(409, 'nothing_to_undo', '되돌릴 내용이 없습니다');
  tx(() => {
    updateDocument(ref.projectId, ref.path, { content: cur.previousContent!, previousContent: null });
    if (cur.content !== cur.previousContent) flagUpstream(ref.projectId, laterWithContent(ref.path, listDocuments(ref.projectId)));
  });
  return json({ document: viewOf(ref) });
}
