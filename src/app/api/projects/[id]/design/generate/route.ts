import { batchBusy, acquireRun } from '@/server/runtime';
import { isAgentName } from '@/lib/contract';
import { getAdapter } from '@/server/agents';
import { getProject, listDocuments } from '@/server/db';
import { designGate, stripFence } from '@/server/doc-rules';
import { designPrompt, runDirOf } from '@/server/documents';
import { apiError, gateError, parseId, readJson } from '@/server/http';
import { runAgentSse } from '@/server/run-agent-sse';

export const runtime = 'nodejs';

// 저장하지 않는다. 결과를 done.text로 주면 화면이 편집기에 채우고, 사용자가 저장(PUT /design)해야 반영된다.
// base(화면에서 다듬던 문서)가 있으면 그것을, 없으면 저장된 디자인 문서를 반영해 만든다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  const project = id === null ? null : getProject(id);
  if (id === null || !project) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (batchBusy(id)) return apiError(409, 'busy', '전체 초안 작업이 실행 중입니다');

  const body = await readJson(req);
  if (batchBusy(id)) return apiError(409, 'busy', '전체 초안 작업이 실행 중입니다');
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 잘못되었습니다');
  if (!isAgentName(body.agent)) return apiError(400, 'invalid_input', '에이전트를 고르세요');
  for (const key of ['base', 'feedback'] as const) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') {
      return apiError(400, 'invalid_input', `${key === 'base' ? '디자인 문서' : '피드백'}는 글이어야 합니다`);
    }
  }
  const agent = body.agent;
  const base = typeof body.base === 'string' ? body.base : project.designMd;
  const feedback = typeof body.feedback === 'string' && body.feedback.trim() !== '' ? body.feedback : undefined;
  if (feedback !== undefined && (base ?? '').trim() === '') {
    return apiError(400, 'invalid_input', '디자인 문서가 없으면 피드백으로 다시 생성할 수 없습니다');
  }

  // 저장소 프로젝트는 승인된 문서가 없어도 코드에서 만든다.
  const gate = project.repo ? { ok: true as const } : designGate(listDocuments(id));
  if (!gate.ok) return gateError(gate);

  const handle = acquireRun(id, 'design', null);
  if (!handle) return apiError(409, 'busy', '이 프로젝트에서 다른 작업이 실행 중입니다');

  return runAgentSse({
    req,
    handle,
    agent,
    execute: async ({ onDelta, signal }) => {
      const dir = runDirOf(id); // 클론이 없으면 프롬프트를 만들기 전에 멈춘다
      const result = await getAdapter(agent).run({ prompt: designPrompt(id, base, feedback), signal, onDelta, repoDir: dir });
      return stripFence(result.text);
    },
  });
}
