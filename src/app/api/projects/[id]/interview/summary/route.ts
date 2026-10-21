import { buildInterviewRebuildPrompt, buildInterviewSummaryPrompt } from '@/server/prompts';
import { getProject, getInterview, listMessages, tx, updateInterview } from '@/server/db';
import { acquireRun, getRun } from '@/server/runtime';
import { apiError, json, parseId, readJson } from '@/server/http';
import { runAgentSse } from '@/server/run-agent-sse';
import { runTurn, interviewOf } from '@/server/interview-turn';
import { runDirOf } from '@/server/documents';
import { stripFence } from '@/server/doc-rules';

export const runtime = 'nodejs';

// 요약 생성: active + 세션 있음일 때만. 저장은 summary와 summarized 상태를 함께 한다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const project = getProject(id);
  if (!project) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (getRun(id)) return apiError(409, 'busy', '다른 작업이 진행 중입니다');

  const rec = getInterview(id);
  if (!rec || rec.status !== 'active' || rec.sessionId === null || !rec.agent) {
    return apiError(409, 'invalid_state', '지금은 요약할 수 없습니다');
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
      const dir = runDirOf(id);
      const r = await runTurn({
        agent,
        prompt: buildInterviewSummaryPrompt(project.repo),
        sessionId,
        rebuildPrompt: () =>
          buildInterviewRebuildPrompt(project.idea, listMessages(rec.id), { kind: 'summary' }, project.repo),
        onDelta,
        signal,
        repoDir: dir,
      });
      const summary = stripFence(r.text);
      // 저장 직전: 연결이 끊겼으면 요약을 저장하지 않는다.
      signal.throwIfAborted();
      tx(() => {
        updateInterview(id, {
          summary,
          status: 'summarized',
          ...(r.sessionId !== sessionId ? { sessionId: r.sessionId } : {}),
        });
      });
      return summary;
    },
  });
}

// 요약 편집 저장: summarized에서만.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const body = await readJson(req);
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 올바르지 않습니다');
  if (typeof body.summary !== 'string') return apiError(400, 'invalid_input', '요약을 입력하세요');
  if (!getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (getRun(id)) return apiError(409, 'busy', '다른 작업이 진행 중입니다');

  const rec = getInterview(id);
  if (!rec || rec.status !== 'summarized') return apiError(409, 'invalid_state', '요약 단계가 아닙니다');
  updateInterview(id, { summary: body.summary });
  return json({ interview: interviewOf(id) });
}
