import { batchBusy } from '@/server/runtime';
import { updateDocument } from '@/server/db';
import { resolveDocRef, viewOf } from '@/server/documents';
import { apiError, json } from '@/server/http';

export const runtime = 'nodejs';

// 승인된 문서의 "앞 문서 변경됨" 표시만 지운다 (상태는 그대로).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id, path } = await ctx.params;
  const ref = resolveDocRef(id, path);
  if (ref instanceof Response) return ref;
  if (batchBusy(ref.projectId)) return apiError(409, 'busy', '전체 초안 작업이 실행 중입니다');
  const view = viewOf(ref);
  if (!['draft', 'approved'].includes(view.status) || !view.upstreamChanged) {
    return apiError(409, 'invalid_state', '본문과 표시가 있는 문서만 확인할 수 있습니다');
  }
  updateDocument(ref.projectId, ref.path, { upstreamChanged: false });
  return json({ document: viewOf(ref) });
}
