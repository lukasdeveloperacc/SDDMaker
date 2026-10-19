import { isAgentName } from '@/lib/contract';
import { AgentError } from '@/server/agents/exec';
import { getAdapter } from '@/server/agents';
import type { AgentAdapter } from '@/server/agents/types';
import { acquireLogin, cancelLogin, releaseLogin } from '@/server/runtime';
import { apiError } from '@/server/http';
import { createSse } from '@/server/sse';

export const runtime = 'nodejs';

const LOGIN_TIMEOUT_MS = 600_000;

async function loggedInAfterLogin(adapter: AgentAdapter): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (await adapter.status()).loggedIn;
    } catch {
      // 한 번 더 확인한다
    }
  }
  return false;
}

export async function POST(req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;
  if (!isAgentName(agent)) return apiError(400, 'invalid_input', '잘못된 에이전트입니다');
  const controller = acquireLogin(agent);
  if (!controller) return apiError(409, 'login_running', '이미 로그인이 진행 중입니다');

  const adapter = getAdapter(agent);
  const sse = createSse(req.signal);
  // 브라우저 연결이 끊기거나 cancel되면 로그인 프로세스를 끝낸다.
  sse.signal.addEventListener('abort', () => controller.abort(), { once: true });

  void (async () => {
    try {
      try {
        await adapter.login({
          onPrompt: (p) => sse.send('prompt', p),
          signal: controller.signal,
          timeoutMs: LOGIN_TIMEOUT_MS,
        });
      } catch (e) {
        releaseLogin(agent, controller);
        const code = e instanceof AgentError && e.code === 'cli_not_found' ? 'cli_not_found' : 'login_failed';
        const message = e instanceof AgentError ? e.message : '로그인에 실패했습니다';
        sse.send('error', { code, message });
        return;
      }
      // 로그인 명령은 성공했으니 상태 확인 실패로 로그인 실패라고 하지 않는다. 한 번 더 보고 안 되면 미로그인으로 본다.
      const loggedIn = await loggedInAfterLogin(adapter);
      releaseLogin(agent, controller);
      sse.send('done', { loggedIn });
    } finally {
      releaseLogin(agent, controller);
      sse.close();
    }
  })();

  return sse.response;
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;
  if (!isAgentName(agent)) return apiError(400, 'invalid_input', '잘못된 에이전트입니다');
  cancelLogin(agent);
  return new Response(null, { status: 204 });
}
