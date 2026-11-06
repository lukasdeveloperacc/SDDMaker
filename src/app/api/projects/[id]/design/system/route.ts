import { acquireRun, batchBusy } from '@/server/runtime';
import { isAgentName } from '@/lib/contract';
import { extractHtml } from '@/lib/screens/html';
import { log } from '@/lib/log';
import { AgentError, getAdapter } from '@/server/agents';
import { getProject, setDesignHtml } from '@/server/db';
import { UNSAFE_HTML } from '@/server/doc-rules';
import { designSystemPrompt, runDirOf } from '@/server/documents';
import { apiError, parseId, readJson } from '@/server/http';
import { runAgentSse } from '@/server/run-agent-sse';

export const runtime = 'nodejs';

// 디자인 시스템 페이지(2-DESIGN.html)를 만든다. 서버가 저장하므로 화면을 떠나도 이어 간다.
// 저장된 디자인 문서를 기준으로 하고, feedback이 있으면 현재 페이지를 고친다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  const project = id === null ? null : getProject(id);
  if (id === null || !project) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (batchBusy(id)) return apiError(409, 'busy', '전체 초안 작업이 실행 중입니다');

  const body = await readJson(req);
  if (batchBusy(id)) return apiError(409, 'busy', '전체 초안 작업이 실행 중입니다');
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 잘못되었습니다');
  if (!isAgentName(body.agent)) return apiError(400, 'invalid_input', '에이전트를 고르세요');
  if (body.feedback !== undefined && body.feedback !== null && typeof body.feedback !== 'string') {
    return apiError(400, 'invalid_input', '피드백은 글이어야 합니다');
  }
  const agent = body.agent;
  const feedback = typeof body.feedback === 'string' && body.feedback.trim() !== '' ? body.feedback : undefined;
  if (!project.designMd?.trim()) return apiError(409, 'design_required', '디자인 문서를 먼저 저장하세요');
  if (feedback !== undefined && !project.designHtml?.trim()) {
    return apiError(400, 'invalid_input', '디자인 시스템 페이지가 없으면 피드백으로 다시 생성할 수 없습니다');
  }

  const handle = acquireRun(id, 'design', null);
  if (!handle) return apiError(409, 'busy', '이 프로젝트에서 다른 작업이 실행 중입니다');

  return runAgentSse({
    req,
    handle,
    agent,
    detached: true,
    execute: async ({ onDelta, signal }) => {
      const dir = runDirOf(id); // 클론이 없으면 프롬프트를 만들기 전에 멈춘다
      const result = await getAdapter(agent).run({ prompt: designSystemPrompt(id, feedback), signal, onDelta, repoDir: dir });
      const html = extractHtml(result.text);
      if (!html.includes('<')) throw new AgentError('agent_failed', '생성 결과에 HTML이 없습니다');
      if (UNSAFE_HTML.test(html)) throw new AgentError('agent_failed', '스크립트나 이벤트 속성이 들어 있어 저장하지 않았습니다');
      signal.throwIfAborted(); // 취소됐으면 저장하지 않는다
      setDesignHtml(id, html);
      log('info', 'design_system_saved', { projectId: id, via: feedback ? 'feedback' : 'generate', agent, bytes: html.length });
      return html;
    },
  });
}
