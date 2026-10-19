import { isAgentName } from '@/lib/contract';
import { buildInterviewStartPrompt } from '@/server/prompts';
import { addMessage, createInterview, getInterview, getProject, tx, updateInterview } from '@/server/db';
import { acquireRun, getRun } from '@/server/runtime';
import { apiError, parseId, readJson } from '@/server/http';
import { runAgentSse } from '@/server/run-agent-sse';
import { runTurn } from '@/server/interview-turn';

export const runtime = 'nodejs';

// 인터뷰 시작: 인터뷰가 없거나 세션 없는 active일 때만 (그 외·skipped는 409).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const body = await readJson(req);
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 올바르지 않습니다');
  if (!isAgentName(body.agent)) return apiError(400, 'invalid_input', '에이전트를 고르세요');
  const agent = body.agent;
  const project = getProject(id);
  if (!project) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');

  if (getRun(id)) return apiError(409, 'busy', '다른 작업이 진행 중입니다');
  const rec = getInterview(id);
  if (rec && !(rec.status === 'active' && rec.sessionId === null)) {
    return apiError(409, 'invalid_state', '지금은 인터뷰를 시작할 수 없습니다');
  }
  const handle = acquireRun(id, 'interview', null);
  if (!handle) return apiError(409, 'busy', '다른 작업이 진행 중입니다');

  return runAgentSse({
    req,
    handle,
    agent,
    execute: async ({ onDelta, signal }) => {
      // 상태 확인을 통과한 뒤에만 행을 만들거나 agent를 바꾼다 (CLI 미로그인이면 상태가 그대로).
      // 상태 확인 중 연결이 끊겼으면 행을 만들지 않는다.
      signal.throwIfAborted();
      const cur = getInterview(id);
      if (!cur) createInterview(id, agent, 'active');
      else if (cur.agent !== agent) updateInterview(id, { agent });

      const r = await runTurn({
        agent,
        prompt: buildInterviewStartPrompt(project.idea),
        sessionId: null,
        onDelta,
        signal,
      });
      // 저장 직전: 연결이 끊겼으면 아무것도 저장하지 않는다.
      signal.throwIfAborted();
      const interviewId = getInterview(id)!.id;
      tx(() => {
        addMessage(interviewId, 'agent', r.text);
        updateInterview(id, { sessionId: r.sessionId });
      });
      return r.text;
    },
  });
}
