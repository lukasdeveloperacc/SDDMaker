import { isAgentName } from '@/lib/contract';
import { AgentError } from '@/server/agents/exec';
import { getAdapter } from '@/server/agents';
import type { AgentAdapter } from '@/server/agents/types';
import { acquireLogin, cancelLogin, releaseLogin, setLoginCodeInput, submitLoginCode } from '@/server/runtime';
import { apiError, readJson } from '@/server/http';
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
          onOutput: (text) => sse.send('output', { text }),
          onCodeInput: (submit) => {
            const loginId = setLoginCodeInput(agent, controller, submit);
            if (loginId) sse.send('input_ready', { loginId });
          },
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

export async function PUT(req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;
  if (agent !== 'claude') return apiError(400, 'invalid_input', '인증 코드 입력은 Claude 로그인에서만 사용합니다');
  const body = await readJson(req);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^[^\s#]+#[^\s#]+$/.test(code) || code.length > 4096 || /\p{Cc}/u.test(code) || typeof body?.loginId !== 'string') {
    return apiError(400, 'invalid_input', '브라우저에서 받은 인증 코드 전체를 한 줄로 붙여넣으세요');
  }
  if (!submitLoginCode(agent, body.loginId, code)) {
    return apiError(409, 'invalid_state', '코드를 받을 수 없는 로그인입니다. 취소 후 다시 로그인하세요');
  }
  return new Response(null, { status: 204 });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;
  if (!isAgentName(agent)) return apiError(400, 'invalid_input', '잘못된 에이전트입니다');
  cancelLogin(agent);
  return new Response(null, { status: 204 });
}
