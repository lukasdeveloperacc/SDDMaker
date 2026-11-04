import { createHash } from 'node:crypto';
import { type AgentName, type BatchView } from '@/lib/contract';
import { getDocument, getInterview, getProject, insertEmptyDocuments, listDocuments, tx, updateDocument } from './db';
import { batchPaths, buildDocumentViews, extractLinks, stripFence } from './doc-rules';
import { batchRuntime, type RunHandle } from './runtime';
import { apiError, gateError } from './http';
import { ensureReady, getAdapter, AgentError } from './agents';
import { withAgentOptions } from './agents/options';
import { generationPrompt, runDirOf } from './documents';
import { createSse } from './sse';

const errors = new Map<number, BatchView['error']>();
export function batchView(projectId: number): BatchView | null {
  const project = getProject(projectId);
  if (!project?.repo) return null;
  const docs = listDocuments(projectId);
  const paths = batchPaths(docs);
  const completedPaths = paths.filter((p) => docs.some((d) => d.path === p && d.content.trim() !== ''));
  const remainingPaths = paths.filter((p) => !completedPaths.includes(p));
  const productLinks = extractLinks(docs.find((d) => d.path === '0-PRODUCT.md')?.content ?? '', 'requirements');
  const validLinks = productLinks.names.length > 0 && productLinks.invalid.length === 0 &&
    extractLinks(docs.find((d) => d.path === '4-USERFLOW.md')?.content ?? '', 'screens').invalid.length === 0;
  const runtime = batchRuntime(projectId);
  const interview = getInterview(projectId);
  const reviewToken = createHash('sha256').update(JSON.stringify({
    docs: paths.map((path) => { const d = docs.find((d) => d.path === path); return [path, d?.content, d?.status, d?.upstreamChanged]; }),
    interview: [interview?.status, interview?.summary], design: project.designMd,
  })).digest('hex');
  return { state: runtime ? 'running' : remainingPaths.length === 0 && validLinks ? 'completed' : completedPaths.length ? 'partial' : 'idle',
    currentPath: runtime?.currentPath ?? null, completedPaths, remainingPaths, error: runtime?.error ?? errors.get(projectId) ?? null, reviewToken };
}

export function batchPreflight(projectId: number): Response | null {
  if (!getProject(projectId)?.repo) return apiError(409, 'precondition', '저장소 프로젝트에서만 전체 초안을 만들 수 있습니다');
  const interview = getInterview(projectId);
  if (interview?.status !== 'approved' && interview?.status !== 'skipped') return apiError(409, 'precondition', '인터뷰를 승인하거나 건너뛰어야 합니다');
  const docs = listDocuments(projectId);
  const product = docs.find((d) => d.path === '0-PRODUCT.md');
  if (product?.content.trim()) {
    const links = extractLinks(product.content, 'requirements');
    if (links.invalid.length || !links.names.length) return apiError(409, 'invalid_links', '요구사항 링크를 확인하세요', links.invalid);
  }
  const flow = docs.find((d) => d.path === '4-USERFLOW.md');
  const invalidScreens = extractLinks(flow?.content ?? '', 'screens').invalid;
  if (invalidScreens.length) return apiError(409, 'invalid_links', '화면 링크를 확인하세요', invalidScreens);
  const active = new Set(batchPaths(docs));
  const flagged = docs.filter((d) => active.has(d.path) && d.content.trim() && d.upstreamChanged).map((d) => d.path);
  return flagged.length ? apiError(409, 'precondition', '앞 문서가 바뀐 초안을 검토하고 확인하세요', flagged) : null;
}

export function runBatch(req: Request, handle: RunHandle, agent: AgentName): Response {
  const id = handle.projectId;
  const sse = createSse(req.signal);
  const disconnect = () => handle.controller.abort();
  sse.signal.addEventListener('abort', disconnect, { once: true });
  if (sse.signal.aborted) disconnect();
  errors.delete(id);
  handle.setBatch(null);
  void withAgentOptions(req, agent, async () => {
    let currentPath: string | undefined;
    try {
      const signal = handle.controller.signal;
      signal.throwIfAborted();
      await ensureReady(agent);
      signal.throwIfAborted();
      const dir = runDirOf(id);
      while (true) {
        signal.throwIfAborted();
        const docs = listDocuments(id);
        const paths = batchPaths(docs);
        currentPath = paths.find((p) => !docs.find((d) => d.path === p)?.content.trim());
        if (!currentPath) break;
        handle.setBatch(currentPath);
        sse.send('progress', { batch: batchView(id) });
        const result = await getAdapter(agent).run({ prompt: generationPrompt(id, currentPath, undefined, true), repoDir: dir, signal,
          onDelta: (text) => sse.send('delta', { path: currentPath, text }) });
        const text = stripFence(result.text);
        signal.throwIfAborted();
        if (!text) throw new AgentError('agent_failed', '빈 초안은 저장하지 않았습니다');
        if (currentPath === '0-PRODUCT.md') {
          const links = extractLinks(text, 'requirements');
          if (links.invalid.length || !links.names.length) {
            errors.set(id, { code: 'invalid_links', message: '생성된 요구사항 링크가 올바르지 않습니다', path: currentPath });
            throw new Error('invalid_links');
          }
        }
        if (currentPath === '4-USERFLOW.md' && extractLinks(text, 'screens').invalid.length) {
          errors.set(id, { code: 'invalid_links', message: '생성된 화면 링크가 올바르지 않습니다', path: currentPath });
          throw new Error('invalid_links');
        }
        tx(() => {
          signal.throwIfAborted();
          insertEmptyDocuments(id, [currentPath!]);
          const cur = getDocument(id, currentPath!)!;
          updateDocument(id, currentPath!, { content: text, status: 'draft', agent, upstreamChanged: false,
            ...(cur.content !== '' ? { previousContent: cur.content } : {}) });
          if (currentPath === '0-PRODUCT.md') insertEmptyDocuments(id, extractLinks(text, 'requirements').names.map((n) => `requirements/${n}.md`));
          if (currentPath === '4-USERFLOW.md') insertEmptyDocuments(id, extractLinks(text, 'screens').names.map((n) => `screens/${n}.html`)); // 화면은 일괄 초안이 만들지 않고 행만 둔다
        });
        sse.send('progress', { batch: batchView(id) });
      }
      handle.release();
      sse.send('done', { batch: batchView(id) });
    } catch (e) {
      if (!handle.controller.signal.aborted) {
        const error = errors.get(id) ?? { code: e instanceof AgentError ? e.code : 'agent_failed' as const,
          message: e instanceof AgentError ? e.message : '전체 초안 생성 중 문제가 생겼습니다', path: currentPath };
        errors.set(id, error);
        handle.release();
        sse.send('error', error);
      }
    } finally {
      handle.release();
      sse.signal.removeEventListener('abort', disconnect);
      sse.close();
    }
  });
  return sse.response;
}

export function approveBatch(projectId: number, reviewToken: string): Response | string[] {
  const before = batchView(projectId);
  if (!before || before.reviewToken !== reviewToken) return apiError(409, 'review_changed', '검토 이후 내용이 바뀌었습니다. 다시 검토하세요');
  const failed = batchPreflight(projectId);
  if (failed) return failed;
  const project = getProject(projectId)!;
  const docs = listDocuments(projectId);
  const paths = batchPaths(docs);
  const staged = docs.map((d) => ({ ...d }));
  for (const path of paths) {
    const doc = staged.find((d) => d.path === path);
    if (!doc?.content.trim()) return apiError(409, 'precondition', '초안이 모두 필요합니다', [path]);
    if (doc.status === 'approved') continue;
    const view = buildDocumentViews({ docs: staged, interviewStatus: getInterview(projectId)?.status ?? null,
      hasDesign: !!project.designMd?.trim(), running: null }).find((d) => d.path === path)!;
    if (!view.approve.ok) return gateError(view.approve);
    doc.status = 'approved';
  }
  tx(() => {
    for (const path of paths) updateDocument(projectId, path, { status: 'approved' });
  });
  return paths;
}
