import { buildInterviewAnswerPrompt, buildInterviewRebuildPrompt } from '@/server/prompts';
import { addMessage, getProject, getInterview, listMessages, tx, updateInterview } from '@/server/db';
import { acquireRun, getRun } from '@/server/runtime';
import { apiError, parseId, readJson } from '@/server/http';
import { runAgentSse } from '@/server/run-agent-sse';
import { runTurn } from '@/server/interview-turn';

export const runtime = 'nodejs';

// 답변 보내기. content가 있으면 새 답변, 없으면 마지막 user 메시지로 다시 시도한다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const body = await readJson(req);
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 올바르지 않습니다');

  let content: string | null = null;
  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || body.content.trim() === '') {
      return apiError(400, 'invalid_input', '답변을 입력하세요');
    }
    content = body.content.trim();
  }

  const project = getProject(id);
  if (!project) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (getRun(id)) return apiError(409, 'busy', '다른 작업이 진행 중입니다');

  const rec = getInterview(id);
  if (!rec || rec.status !== 'active' || rec.sessionId === null || !rec.agent) {
    return apiError(409, 'invalid_state', '지금은 답변할 수 없습니다');
  }
  const msgs = listMessages(rec.id);
  const last = msgs[msgs.length - 1];
  if (content !== null) {
    if (!last || last.role !== 'agent') return apiError(409, 'invalid_state', '답변할 질문이 없습니다');
  } else if (!last || last.role !== 'user') {
    return apiError(409, 'invalid_state', '다시 시도할 답변이 없습니다');
  }

  const handle = acquireRun(id, 'interview', null);
  if (!handle) return apiError(409, 'busy', '다른 작업이 진행 중입니다');
  const agent = rec.agent;
  const sessionId = rec.sessionId;

  return runAgentSse({
    req,
    handle,
    agent,
    execute: async ({ onDelta, signal }) => {
      // 사용자 답변은 CLI 실행 전에 따로 저장한다 (실패해도 남아야 한다).
      if (content !== null) addMessage(rec.id, 'user', content);
      const answer = content ?? last.content;

      const r = await runTurn({
        agent,
        prompt: buildInterviewAnswerPrompt(answer),
        sessionId,
        rebuildPrompt: () =>
          buildInterviewRebuildPrompt(project.idea, listMessages(rec.id), { kind: 'answer' }),
        onDelta,
        signal,
      });
      // 저장 직전: 연결이 끊겼으면 agent 메시지와 세션 ID를 저장하지 않는다.
      signal.throwIfAborted();
      tx(() => {
        addMessage(rec.id, 'agent', r.text);
        if (r.sessionId !== sessionId) updateInterview(id, { sessionId: r.sessionId });
      });
      return r.text;
    },
  });
}
