import type { AgentName, AgentsResponse } from '@/lib/contract';
import { AgentError } from './exec';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import type { AgentAdapter } from './types';

const adapters: Record<AgentName, AgentAdapter> = { claude: claudeAdapter, codex: codexAdapter };

export function getAdapter(agent: AgentName): AgentAdapter {
  return adapters[agent];
}

// 실행 전 확인: 설치, 로그인, 구독 로그인 순서로 막는다.
export async function ensureReady(agent: AgentName): Promise<void> {
  const s = await getAdapter(agent).status();
  if (!s.installed) throw new AgentError('cli_not_found', '실행 파일을 찾을 수 없습니다');
  if (!s.loggedIn) throw new AgentError('not_logged_in', '로그인이 필요합니다');
  if (!s.subscription) throw new AgentError('not_subscription', '구독 로그인이 필요합니다 (API 키 방식은 쓰지 않습니다)');
}

export async function agentStatuses(): Promise<AgentsResponse> {
  const [claude, codex] = await Promise.all([claudeAdapter.status(), codexAdapter.status()]);
  return {
    claude: { ...claude, loginCommand: claudeAdapter.loginCommand() },
    codex: { ...codex, loginCommand: codexAdapter.loginCommand() },
  };
}

export { AgentError } from './exec';
