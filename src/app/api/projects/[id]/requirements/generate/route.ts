import { isAgentName, MAX_PARALLEL } from '@/lib/contract';
import { AgentError, getAdapter } from '@/server/agents';
import { computeMissing, kindOf, laterWithContent, stripFence } from '@/server/doc-rules';
import { flagUpstream, getDocument, getProject, listDocuments, tx, updateDocument } from '@/server/db';
import { generationPrompt, runDirOf, viewOf } from '@/server/documents';
import { apiError, gateError, parseId, readJson } from '@/server/http';
import { runAgentSse } from '@/server/run-agent-sse';
import { errorFields, log } from '@/lib/log';
import { acquireRun, batchBusy } from '@/server/runtime';

export const runtime = 'nodejs';

// 요구사항 문서끼리는 입력이 겹치지 않으므로(기본 문서만 본다) 비어 있는 것을 동시에 만든다.
// shortcut: 동시 실행 수는 고정값이다. 구독 사용량 한도에 걸리면 줄이고, 필요하면 설정으로 뺀다.
const CONCURRENCY = MAX_PARALLEL;

// 프로젝트 실행 잠금은 하나만 잡고 CLI를 여러 개 띄운다. 문서마다 끝나는 대로 초안으로 저장하고,
// done.text는 { done, failed } JSON이다. 이미 본문이 생긴 문서는 덮어쓰지 않는다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  const project = id === null ? null : getProject(id);
  if (id === null || !project) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (batchBusy(id)) return apiError(409, 'busy', '전체 초안 작업이 실행 중입니다');

  const body = await readJson(req);
  if (batchBusy(id)) return apiError(409, 'busy', '전체 초안 작업이 실행 중입니다');
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 잘못되었습니다');
  if (!isAgentName(body.agent)) return apiError(400, 'invalid_input', '에이전트를 고르세요');
  const agent = body.agent;

  const docs = listDocuments(id);
  const missing = computeMissing(docs);
  const targets = docs
    .filter((d) => kindOf(d.path) === 'requirement' && d.status === 'empty' && d.content === '' && !missing.has(d.path))
    .map((d) => d.path);
  if (targets.length === 0) return apiError(409, 'precondition', '만들 요구사항 문서가 없습니다');
  const gate = viewOf({ projectId: id, path: targets[0] }).generate; // 요구사항 문서의 생성 조건은 모두 같다
  if (!gate.ok) return gateError(gate);

  const handle = acquireRun(id, 'requirements', null);
  if (!handle) return apiError(409, 'busy', '이 프로젝트에서 다른 작업이 실행 중입니다');

  return runAgentSse({
    req,
    handle,
    agent,
    detached: true, // 서버가 문서마다 저장하므로 화면을 떠나도 이어 간다
    execute: async ({ signal }) => {
      const dir = runDirOf(id); // 저장소 프로젝트는 클론에서 실행한다 (클론이 없으면 멈춘다)
      const queue = [...targets];
      const done: string[] = [];
      const failed: { path: string; message: string }[] = [];
      let firstError: unknown = null;
      const active: string[] = [];
      const report = () => handle.setProgress({ total: targets.length, done: [...done], active: [...active], failed: failed.map((f) => f.path) });
      report();

      const worker = async () => {
        for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
          signal.throwIfAborted();
          active.push(path);
          report();
          try {
            const result = await getAdapter(agent).run({ prompt: generationPrompt(id, path), signal, repoDir: dir });
            const text = stripFence(result.text);
            if (text.trim() === '') throw new AgentError('agent_failed', '빈 결과를 받았습니다');
            // 저장 직전: 연결이 끊겼으면 아무것도 바꾸지 않는다.
            signal.throwIfAborted();
            const saved = tx(() => {
              const cur = getDocument(id, path);
              if (!cur || cur.status !== 'empty' || cur.content !== '') return false; // 그 사이 직접 쓴 문서는 지킨다
              updateDocument(id, path, { content: text, status: 'draft', agent, upstreamChanged: false });
              flagUpstream(id, laterWithContent(path, listDocuments(id)));
              return true;
            });
            if (saved) { done.push(path); log('info', 'doc_saved', { projectId: id, path, via: 'requirements', agent }); }
          } catch (e) {
            if (signal.aborted) throw e;
            firstError ??= e;
            failed.push({ path, message: e instanceof AgentError ? e.message : '실행 중 문제가 생겼습니다' });
            log('warn', 'doc_failed', { projectId: id, path, via: 'requirements', agent, ...errorFields(e) });
          } finally {
            active.splice(active.indexOf(path), 1);
            report();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

      // 하나도 못 만들었으면 오류로 알리고, 일부라도 만들었으면 결과에 실패 목록을 싣는다.
      if (done.length === 0 && firstError) throw firstError;
      return JSON.stringify({ done, failed });
    },
  });
}
