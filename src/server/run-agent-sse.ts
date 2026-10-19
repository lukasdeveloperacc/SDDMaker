import { ensureReady } from './agents';
import { AgentError } from './agents/exec';
import { createSse } from './sse';
import type { RunHandle } from './runtime';
import type { AgentName } from '@/lib/contract';

// execute 규칙: DB에 쓰기 바로 직전에 반드시 ctx.signal.throwIfAborted()를 부른다
// (CLI 성공 직후 연결이 끊긴 경우 저장하지 않기 위해 — documents.md#예외).
export function runAgentSse(opts: {
  req: Request;
  handle: RunHandle;
  agent: AgentName;
  execute: (ctx: { onDelta: (text: string) => void; signal: AbortSignal }) => Promise<string>; // 저장까지 끝낸 뒤 done에 보낼 text를 돌려줌
}): Response {
  const { handle } = opts;
  const sse = createSse(opts.req.signal);
  // 연결이 끊기거나 cancel되면 자식 프로세스를 끝낸다.
  sse.signal.addEventListener('abort', () => handle.controller.abort(), { once: true });

  void (async () => {
    try {
      await ensureReady(opts.agent);
      const text = await opts.execute({
        onDelta: (t) => sse.send('delta', { text: t }),
        signal: handle.controller.signal,
      });
      // 잠금을 먼저 푼다: 화면은 done을 받자마자 저장 요청을 보낸다.
      handle.release();
      sse.send('done', { text });
    } catch (e) {
      handle.release();
      if (!handle.controller.signal.aborted) {
        if (e instanceof AgentError) sse.send('error', { code: e.code, message: e.message });
        else sse.send('error', { code: 'agent_failed', message: '실행 중 문제가 생겼습니다' });
      }
    } finally {
      handle.release();
      sse.close();
    }
  })();

  return sse.response;
}
