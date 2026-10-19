import { DOC_PATH_RE, isAgentName } from '@/lib/contract';
import { getAdapter } from '@/server/agents';
import { annotationPromptFor, parseAnnotations } from '@/server/annotations';
import { getDocument, getProject } from '@/server/db';
import { kindOf } from '@/server/doc-rules';
import { apiError, parseId, readJson } from '@/server/http';
import { runAgentSse } from '@/server/run-agent-sse';
import { acquireRun } from '@/server/runtime';

export const runtime = 'nodejs';

// 저장하지 않는다. 응답 원문을 done으로 보내고, 화면 HTML은 그대로 둔다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; path: string }> }) {
  const { id: rawId, path } = await ctx.params;
  const projectId = parseId(rawId);
  if (projectId === null || !getProject(projectId)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (!DOC_PATH_RE.test(path) || kindOf(path) !== 'screen') {
    return apiError(400, 'invalid_input', '화면 정의서만 주석을 달 수 있습니다');
  }
  const body = await readJson(req);
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 올바르지 않습니다');
  if (!isAgentName(body.agent)) return apiError(400, 'invalid_input', '잘못된 에이전트입니다');
  const annotations = parseAnnotations(body.annotations);
  if (!annotations) return apiError(400, 'invalid_input', '주석이 올바르지 않습니다 (1개 이상 필요)');
  const doc = getDocument(projectId, path);
  if (!doc) return apiError(404, 'not_found', '문서를 찾을 수 없습니다');
  if (doc.status === 'approved') return apiError(409, 'approved_locked', '승인된 화면은 주석을 보낼 수 없습니다. 승인을 취소하세요');
  if (doc.status === 'empty') return apiError(409, 'invalid_state', '본문이 없는 화면에는 주석을 보낼 수 없습니다');

  const handle = acquireRun(projectId, 'annotations', path);
  if (!handle) return apiError(409, 'busy', '다른 작업이 실행 중입니다');

  const agent = body.agent;
  return runAgentSse({
    req,
    handle,
    agent,
    execute: async ({ onDelta, signal }) => {
      // 미리보기와 같은 함수로 조립한다. 조립은 실행 직전 상태 기준.
      const prompt = annotationPromptFor(projectId, path, annotations);
      if (prompt === null) throw new Error('document disappeared before send');
      const res = await getAdapter(agent).run({ prompt, onDelta, signal });
      return res.text;
    },
  });
}
