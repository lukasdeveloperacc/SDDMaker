import { getAdapter } from '@/server/agents';
import { AGENT_NAMES, type AgentName, type AgentsResponse } from '@/lib/contract';
import { json } from '@/server/http';
import { isLoginRunning } from '@/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 한 CLI의 상태 확인이 실패(시간 초과 등)해도 목록 전체는 살린다.
// 그 CLI는 설치·로그인 모두 안 된 것으로 보고, 오류 종류만 남긴다 (출력 원문은 남기지 않음).
async function statusOf(agent: AgentName): Promise<AgentsResponse[AgentName]> {
  const adapter = getAdapter(agent);
  const loginCommand = adapter.loginCommand();
  try {
    const s = await adapter.status();
    return { ...s, loginCommand, loginRunning: isLoginRunning(agent) };
  } catch (e) {
    console.error(`agent status failed: ${agent} ${e instanceof Error ? e.name : 'unknown'}`);
    return { installed: false, loggedIn: false, subscription: false, loginCommand, loginRunning: isLoginRunning(agent) };
  }
}

export async function GET() {
  const entries = await Promise.all(AGENT_NAMES.map(async (a) => [a, await statusOf(a)] as const));
  return json(Object.fromEntries(entries));
}
