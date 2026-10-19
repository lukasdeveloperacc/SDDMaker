import { isAgentName } from '@/lib/contract';
import { kindOf, stripFence } from '@/server/doc-rules';
import { getAdapter } from '@/server/agents';
import { getDocument, updateDocument } from '@/server/db';
import { generationPrompt, resolveDocRef, viewOf } from '@/server/documents';
import { apiError, gateError, readJson } from '@/server/http';
import { runAgentSse } from '@/server/run-agent-sse';
import { acquireRun } from '@/server/runtime';

export const runtime = 'nodejs';

// 마크다운은 저장하고 done.text에 저장 본문을 준다. 화면 정의서는 저장하지 않고 응답 원문을 준다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id, path } = await ctx.params;
  const ref = resolveDocRef(id, path);
  if (ref instanceof Response) return ref;

  const body = await readJson(req);
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 잘못되었습니다');
  if (!isAgentName(body.agent)) return apiError(400, 'invalid_input', '에이전트를 고르세요');
  if (body.feedback !== undefined && body.feedback !== null && typeof body.feedback !== 'string') {
    return apiError(400, 'invalid_input', '피드백은 글이어야 합니다');
  }
  const agent = body.agent;
  const feedback = typeof body.feedback === 'string' && body.feedback.trim() !== '' ? body.feedback : undefined;

  const view = viewOf(ref);
  if (!view.generate.ok) return gateError(view.generate);
  if (feedback !== undefined && view.content.trim() === '') {
    return apiError(400, 'invalid_input', '본문이 없으면 피드백으로 다시 생성할 수 없습니다');
  }

  const handle = acquireRun(ref.projectId, 'document', ref.path);
  if (!handle) return apiError(409, 'busy', '이 프로젝트에서 다른 작업이 실행 중입니다');
  const isScreen = kindOf(ref.path) === 'screen';

  return runAgentSse({
    req,
    handle,
    agent,
    execute: async ({ onDelta, signal }) => {
      const prompt = generationPrompt(ref.projectId, ref.path, feedback);
      const result = await getAdapter(agent).run({ prompt, signal, onDelta });
      if (isScreen) return result.text;

      const text = stripFence(result.text);
      // 저장 직전: 연결이 끊겼거나 취소됐으면 아무것도 바꾸지 않는다.
      signal.throwIfAborted();
      const cur = getDocument(ref.projectId, ref.path);
      if (!cur) throw new Error('document row vanished');
      updateDocument(ref.projectId, ref.path, {
        content: text,
        status: 'draft',
        agent,
        upstreamChanged: false,
        ...(cur.content !== '' ? { previousContent: cur.content } : {}),
      });
      return text;
    },
  });
}
