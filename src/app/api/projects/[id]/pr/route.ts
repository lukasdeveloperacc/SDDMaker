import { projectDetail } from '@/server/documents';
import { exportFiles } from '@/server/export';
import { createPr, prInfo, PrBlockedError, type PrFile } from '@/server/github-pr';
import { GithubError } from '@/server/github';
import { apiError, json, parseId } from '@/server/http';
import { readDocRules } from '@/server/prompts';
import { acquireRun } from '@/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 저장소 프로젝트인지, 승인이 끝났는지 본다. 내보낼 파일은 지금 문서로 잡는다 (확인 뒤 바뀌어도 PR은 이 목록을 쓴다).
function ready(rawId: string): { projectId: number; repo: string; files: PrFile[] } | Response {
  const projectId = parseId(rawId);
  const detail = projectId === null ? null : projectDetail(projectId);
  if (!detail || !detail.project.repo) return apiError(404, 'not_found', '저장소가 연결된 프로젝트를 찾을 수 없습니다');
  if (!detail.exportGate.ok) {
    return apiError(409, 'export_blocked', '승인되지 않았거나 목록에서 빠진 문서가 있습니다', detail.exportGate.blocking);
  }
  const files = exportFiles({
    designMd: detail.project.designMd,
    docs: detail.documents.map((d) => ({ path: d.path, content: d.content })),
    rules: readDocRules(),
  });
  return { projectId: detail.project.id, repo: detail.project.repo, files };
}

function failure(e: unknown): Response {
  if (e instanceof PrBlockedError || e instanceof GithubError) return json({ code: e.code, message: e.message }, e.status);
  return json({ code: 'pr_failed', message: 'PR을 올리지 못했습니다. 다시 시도하세요' }, 502);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = ready((await ctx.params).id);
  if (r instanceof Response) return r;
  try {
    return json(await prInfo({ projectId: r.projectId, repo: r.repo, files: r.files, signal: req.signal }));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = ready((await ctx.params).id);
  if (r instanceof Response) return r;
  const handle = acquireRun(r.projectId, 'pr', null);
  if (!handle) return apiError(409, 'busy', '다른 작업이 진행 중입니다');
  try {
    const url = await createPr({
      projectId: r.projectId,
      repo: r.repo,
      files: r.files,
      signal: AbortSignal.any([handle.controller.signal, req.signal]),
    });
    return json({ url }, 201);
  } catch (e) {
    return failure(e);
  } finally {
    handle.release();
  }
}
