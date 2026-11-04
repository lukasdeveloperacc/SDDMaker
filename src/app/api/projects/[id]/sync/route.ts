import { BASE_DOCS, isAgentName, MAX_PARALLEL } from '@/lib/contract';
import { extractHtml } from '@/lib/screens/html';
import { AgentError, getAdapter } from '@/server/agents';
import { computeMissing, kindOf, laterWithContent, stripFence, UNSAFE_HTML } from '@/server/doc-rules';
import { flagUpstream, getDocument, getProject, listDocuments, tx, updateDocument } from '@/server/db';
import { generationPrompt, runDirOf } from '@/server/documents';
import { apiError, parseId, readJson } from '@/server/http';
import { runAgentSse } from '@/server/run-agent-sse';
import { errorFields, log } from '@/lib/log';
import { acquireRun, batchBusy } from '@/server/runtime';

export const runtime = 'nodejs';

// 고칠 곳이 없다는 답. 이 경우 문서는 그대로 두고 표시만 지운다 (검사와 갱신을 호출 한 번으로 한다).
const NO_CHANGE = '변경 없음';
const FEEDBACK =
  `앞 문서가 바뀌었다. 현재 본문이 위 앞 문서와 어긋나는지 확인한다. 어긋나는 부분이 있으면 그 부분만 고쳐 문서 전체를 다시 쓴다. 어긋나지 않는 내용·표현·구조는 그대로 유지한다. 고칠 곳이 없으면 본문 대신 정확히 \`${NO_CHANGE}\` 한 줄만 출력한다.`;

// "앞 문서 변경됨"이 붙은 요구사항을 먼저, 그 결과로 새로 붙은 화면 정의서를 이어서 검사하고 필요하면 현재 본문 기준으로 갱신한다.
// 고칠 곳이 없는 문서는 승인 상태 그대로 표시만 지우고, 다시 쓴 문서는 승인이 풀려 초안이 되고, 직전 본문은 되돌리기로 남는다. 문서마다 끝나는 대로 저장한다.
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

  const pending = (kind: 'requirement' | 'screen') => {
    const docs = listDocuments(id);
    const missing = computeMissing(docs);
    return docs
      .filter((d) => kindOf(d.path) === kind && d.upstreamChanged && d.content.trim() !== '' && !missing.has(d.path))
      .map((d) => d.path);
  };
  const first = pending('requirement');
  if (first.length + pending('screen').length === 0) return apiError(409, 'precondition', '반영할 문서가 없습니다');
  if (first.length > 0 && !BASE_DOCS.every((p) => getDocument(id, p)?.status === 'approved')) {
    return apiError(409, 'precondition', '기본 문서를 모두 승인해야 합니다');
  }

  const handle = acquireRun(id, 'requirements', null);
  if (!handle) return apiError(409, 'busy', '이 프로젝트에서 다른 작업이 실행 중입니다');

  return runAgentSse({
    req,
    handle,
    agent,
    detached: true, // 서버가 문서마다 저장하므로 화면을 떠나도 이어 간다
    execute: async ({ signal }) => {
      const dir = runDirOf(id);
      const done: string[] = [];
      const unchanged: string[] = [];
      const failed: { path: string; message: string }[] = [];
      const active: string[] = [];
      let total = 0;
      let firstError: unknown = null;
      const report = () => handle.setProgress({ total, done: [...done, ...unchanged], active: [...active], failed: failed.map((f) => f.path) });

      const syncOne = async (path: string) => {
        signal.throwIfAborted();
        active.push(path);
        report();
        try {
          const before = getDocument(id, path)?.content ?? '';
          // 화면은 앞서 갱신한 요구사항 초안도 입력으로 쓴다.
          const prompt = generationPrompt(id, path, FEEDBACK, kindOf(path) === 'screen');
          const result = await getAdapter(agent).run({ prompt, signal, repoDir: dir });
          if (stripFence(result.text).trim() === NO_CHANGE) {
            signal.throwIfAborted();
            const kept = tx(() => {
              const cur = getDocument(id, path);
              if (!cur || cur.content !== before) return false;
              updateDocument(id, path, { upstreamChanged: false });
              return true;
            });
            if (kept) { unchanged.push(path); log('info', 'doc_synced', { projectId: id, path, result: 'unchanged', agent }); }
            else failed.push({ path, message: '그 사이 문서가 바뀌어 확인하지 않았습니다' });
            return;
          }
          const text = kindOf(path) === 'screen' ? extractHtml(result.text) : stripFence(result.text);
          if (text.trim() === '') throw new AgentError('agent_failed', '빈 결과를 받았습니다');
          if (kindOf(path) === 'screen' && UNSAFE_HTML.test(text)) throw new AgentError('agent_failed', '스크립트나 이벤트 속성이 들어 있어 저장하지 않았습니다');
          signal.throwIfAborted();
          const saved = tx(() => {
            const cur = getDocument(id, path);
            if (!cur || cur.content !== before) return false; // 그 사이 직접 고친 문서는 지킨다
            updateDocument(id, path, { content: text, status: 'draft', agent, upstreamChanged: false, previousContent: cur.content });
            if (cur.content !== text) flagUpstream(id, laterWithContent(path, listDocuments(id)));
            return true;
          });
          if (saved) { done.push(path); log('info', 'doc_synced', { projectId: id, path, result: 'updated', agent }); }
          else failed.push({ path, message: '그 사이 문서가 바뀌어 저장하지 않았습니다' });
        } catch (e) {
          if (signal.aborted) throw e;
          firstError ??= e;
          failed.push({ path, message: e instanceof AgentError ? e.message : '실행 중 문제가 생겼습니다' });
          log('warn', 'doc_failed', { projectId: id, path, via: 'sync', agent, ...errorFields(e) });
        } finally {
          active.splice(active.indexOf(path), 1);
          report();
        }
      };

      const pool = async (paths: string[]) => {
        const queue = [...paths];
        const worker = async () => {
          for (let p = queue.shift(); p !== undefined; p = queue.shift()) await syncOne(p);
        };
        await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, paths.length) }, worker));
      };

      total = first.length;
      report();
      await pool(first);
      // 요구사항 갱신이 화면에 새로 표시를 붙였을 수 있어 다시 읽는다.
      const screens = pending('screen').filter((p) => !failed.some((f) => f.path === p));
      total += screens.length;
      report();
      await pool(screens);

      if (done.length === 0 && firstError) throw firstError;
      return JSON.stringify({ done, unchanged, failed });
    },
  });
}
