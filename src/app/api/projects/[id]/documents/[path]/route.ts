import { isAgentName, type AgentName } from '@/lib/contract';
import { kindOf } from '@/server/doc-rules';
import { deleteDocument, getDocument, updateDocument } from '@/server/db';
import { documentView, resolveDocRef, viewOf } from '@/server/documents';
import { apiError, json, readJson } from '@/server/http';

export const runtime = 'nodejs';

// 직접 저장. 화면 정의서만 keepUndo·generatedBy를 쓸 수 있다 (documents.md·screens.md).
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id, path } = await ctx.params;
  const ref = resolveDocRef(id, path);
  if (ref instanceof Response) return ref;

  const body = await readJson(req);
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 잘못되었습니다');
  if (typeof body.content !== 'string') return apiError(400, 'invalid_input', '본문은 글이어야 합니다');
  const screen = kindOf(path) === 'screen';
  const keepUndo = body.keepUndo;
  if (keepUndo !== undefined && typeof keepUndo !== 'boolean') {
    return apiError(400, 'invalid_input', 'keepUndo는 참·거짓 값이어야 합니다');
  }
  if (keepUndo !== undefined && !screen) {
    return apiError(400, 'invalid_input', 'keepUndo는 화면 정의서에만 쓸 수 있습니다');
  }
  let agent: AgentName | undefined;
  if (body.generatedBy !== undefined) {
    if (!isAgentName(body.generatedBy)) return apiError(400, 'invalid_input', '잘못된 에이전트입니다');
    if (!screen || keepUndo !== true) {
      return apiError(400, 'invalid_input', 'generatedBy는 화면 정의서의 keepUndo 저장에서만 쓸 수 있습니다');
    }
    agent = body.generatedBy;
  }

  const view = viewOf(ref);
  if (view.status === 'approved') return apiError(409, 'approved_locked', '승인된 문서는 저장할 수 없습니다. 승인을 취소하세요');
  if (view.running) return apiError(409, 'busy', '이 문서가 실행 중입니다');
  // 빈 문서를 빈 본문으로 저장해 draft가 되는 것을 막는다.
  if (view.status === 'empty' && body.content.trim() === '') {
    return apiError(400, 'invalid_input', '빈 문서는 내용을 써야 저장할 수 있습니다');
  }
  if (screen && /<script/i.test(body.content)) {
    return apiError(400, 'script_rejected', '화면 정의서에 스크립트를 넣을 수 없습니다');
  }

  const cur = getDocument(ref.projectId, ref.path);
  if (!cur) return apiError(404, 'not_found', '문서를 찾을 수 없습니다');
  const patch: Parameters<typeof updateDocument>[2] = {
    content: body.content,
    status: cur.status === 'empty' ? 'draft' : cur.status,
  };
  if (keepUndo === true && cur.content !== '') patch.previousContent = cur.content;
  if (agent !== undefined) {
    patch.agent = agent;
    patch.upstreamChanged = false;
  }
  updateDocument(ref.projectId, ref.path, patch);
  return json({ document: viewOf(ref) });
}

// "목록에서 빠짐" 문서만 지울 수 있다.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id, path } = await ctx.params;
  const ref = resolveDocRef(id, path);
  if (ref instanceof Response) return ref;
  const view = documentView(ref.projectId, ref.path);
  if (!view) return apiError(404, 'not_found', '문서를 찾을 수 없습니다');
  if (!view.missingFromList) return apiError(409, 'invalid_state', '목록에서 빠진 문서만 삭제할 수 있습니다');
  if (view.running) return apiError(409, 'busy', '이 문서가 실행 중입니다');
  deleteDocument(ref.projectId, ref.path);
  return new Response(null, { status: 204 });
}
