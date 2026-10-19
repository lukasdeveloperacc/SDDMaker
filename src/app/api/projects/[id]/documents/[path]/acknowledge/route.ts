import { updateDocument } from '@/server/db';
import { resolveDocRef, viewOf } from '@/server/documents';
import { apiError, json } from '@/server/http';

export const runtime = 'nodejs';

// 승인된 문서의 "앞 문서 변경됨" 표시만 지운다 (상태는 그대로).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id, path } = await ctx.params;
  const ref = resolveDocRef(id, path);
  if (ref instanceof Response) return ref;
  const view = viewOf(ref);
  if (view.status !== 'approved' || !view.upstreamChanged) {
    return apiError(409, 'invalid_state', '승인되고 표시가 있는 문서만 확인할 수 있습니다');
  }
  updateDocument(ref.projectId, ref.path, { upstreamChanged: false });
  return json({ document: viewOf(ref) });
}
