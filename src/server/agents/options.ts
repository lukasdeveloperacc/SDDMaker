import { AsyncLocalStorage } from 'node:async_hooks';
import { cleanOptions, OPTIONS_HEADER, type AgentOptions } from '@/lib/agent-options';
import type { AgentName } from '@/lib/contract';

const als = new AsyncLocalStorage<AgentOptions>();

// 요청 헤더의 모델·추론 강도를 실행 범위 안에서만 보이게 한다.
export function withAgentOptions<T>(req: Request, agent: AgentName, fn: () => T): T {
  let all: Record<string, unknown> = {};
  try { all = JSON.parse(req.headers.get(OPTIONS_HEADER) ?? '{}') as Record<string, unknown>; } catch { /* 무시 */ }
  return als.run(cleanOptions(all[agent]), fn);
}

export const currentAgentOptions = (): AgentOptions => als.getStore() ?? {};
