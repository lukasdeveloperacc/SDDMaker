import { getProject, tx, insertEmptyDocuments, updateDocument } from '@/server/db';
import { resolveDocRef, viewOf } from '@/server/documents';
import { gateError, json } from '@/server/http';
import type { ApproveResponse } from '@/lib/contract';

export const runtime = 'nodejs';

// 승인 상태와 새로 생긴 목록 문서 행을 한 묶음으로 쓴다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id, path } = await ctx.params;
  const ref = resolveDocRef(id, path);
  if (ref instanceof Response) return ref;
  const view = viewOf(ref);
  if (!view.approve.ok) return gateError(view.approve);

  const names = view.links?.names ?? [];
  const body: ApproveResponse = { document: view };
  tx(() => {
    updateDocument(ref.projectId, ref.path, { status: 'approved', upstreamChanged: false });
    if (path === '0-PRODUCT.md') {
      insertEmptyDocuments(ref.projectId, names.map((n) => `requirements/${n}.md`));
    } else if (path === '4-USERFLOW.md' && !getProject(ref.projectId)?.repo) {
      // 저장소 프로젝트는 화면 정의서를 만들지 않는다.
      insertEmptyDocuments(ref.projectId, names.map((n) => `screens/${n}.html`));
    }
  });
  if (path === '0-PRODUCT.md') body.requirements = names;
  if (path === '4-USERFLOW.md') body.screens = names;
  body.document = viewOf(ref);
  return json(body);
}
