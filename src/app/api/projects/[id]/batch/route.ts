import { isAgentName } from '@/lib/contract';
import { getProject } from '@/server/db';
import { batchPreflight, runBatch } from '@/server/batch';
import { acquireRun, cancelRun, getRun } from '@/server/runtime';
import { apiError, parseId, readJson } from '@/server/http';
export const runtime = 'nodejs';
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null || !getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const body = await readJson(req);
  if (!body || !isAgentName(body.agent)) return apiError(400, 'invalid_input', '에이전트를 고르세요');
  const handle = acquireRun(id, 'batch', null);
  if (!handle) return apiError(409, 'busy', '다른 작업이 실행 중입니다');
  const failed = batchPreflight(id);
  if (failed) { handle.release(); return failed; }
  return runBatch(req, handle, body.agent);
}
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null || !getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const run = getRun(id);
  if (run && run.kind !== 'batch') return apiError(409, 'busy', '다른 작업이 실행 중입니다');
  await cancelRun(id);
  if (getRun(id)) return apiError(409, 'busy', '실행이 종료 중입니다');
  return new Response(null, { status: 204 });
}
