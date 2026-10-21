import { isLoginTarget } from '@/lib/contract';
import { getAdapter } from '@/server/agents';
import { AgentError } from '@/server/agents/exec';
import { githubCli } from '@/server/github';
import { apiError, json } from '@/server/http';
import { acquireLogin, releaseLogin } from '@/server/runtime';

export const runtime = 'nodejs';

export async function POST(req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;
  if (!isLoginTarget(agent)) return apiError(400, 'invalid_input', '잘못된 에이전트입니다');
  const controller = acquireLogin(agent);
  if (!controller) return apiError(409, 'login_running', '진행 중인 로그인을 먼저 종료하세요');
  const onDisconnect = () => controller.abort();
  req.signal.addEventListener('abort', onDisconnect, { once: true });
  if (req.signal.aborted) onDisconnect();
  try {
    const adapter = agent === 'github' ? githubCli : getAdapter(agent);
    await adapter.logout(controller.signal);
    if ((await adapter.status()).loggedIn) throw new AgentError('agent_failed', '연결이 유지되고 있습니다');
    return new Response(null, { status: 204 });
  } catch (error) {
    const code = error instanceof AgentError && error.code === 'cli_not_found' ? 'cli_not_found' : 'agent_failed';
    return json({ code, message: '연결을 해제하지 못했습니다. 다시 시도하세요' }, 500);
  } finally {
    req.signal.removeEventListener('abort', onDisconnect);
    releaseLogin(agent, controller);
  }
}
