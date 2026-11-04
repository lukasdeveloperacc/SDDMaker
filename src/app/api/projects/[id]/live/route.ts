import { isAgentName } from '@/lib/contract';
import { AgentError, ensureReady } from '@/server/agents';
import { withAgentOptions } from '@/server/agents/options';
import { getProject } from '@/server/db';
import { apiError, json, parseId, readJson } from '@/server/http';
import { liveStatus, startLive, stopLive } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function projectOf(raw: string): number | Response {
  const id = parseId(raw);
  return id === null || !getProject(id) ? apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다') : id;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = projectOf((await ctx.params).id);
  return id instanceof Response ? id : json(liveStatus(id));
}

// impeccable live 세션을 연다 (이미 열려 있고 에이전트가 멈췄으면 다시 띄운다).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = projectOf((await ctx.params).id);
  if (id instanceof Response) return id;
  const body = await readJson(req);
  if (!body || !isAgentName(body.agent)) return apiError(400, 'invalid_input', '에이전트를 고르세요');
  const agent = body.agent;
  try {
    await ensureReady(agent);
    return json(await withAgentOptions(req, agent, () => startLive(id, agent)));
  } catch (e) {
    if (e instanceof AgentError) return apiError(409, 'precondition', e.message);
    throw e;
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = projectOf((await ctx.params).id);
  if (id instanceof Response) return id;
  await stopLive(id);
  return new Response(null, { status: 204 });
}
