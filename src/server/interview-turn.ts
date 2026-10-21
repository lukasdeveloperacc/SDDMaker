import type { AgentName, Interview } from '@/lib/contract';
import { AgentError, RunTimeoutError } from './agents/exec';
import { getAdapter } from './agents';
import type { RunResult } from './agents/types';
import { projectDetail } from './documents';

// 인터뷰 한 턴 실행. 세션이 있으면 이어하기로 실행하고, 그 실행이 agent_failed로 끝나면
// DB 기록으로 새 세션을 만들어 한 번만 다시 실행한다 (§11-5). 취소는 재시도하지 않는다.
export async function runTurn(i: {
  agent: AgentName;
  prompt: string;
  sessionId: string | null;
  rebuildPrompt?: () => string;
  onDelta?: (text: string) => void;
  signal: AbortSignal;
  repoDir?: string; // 저장소 프로젝트의 클론
}): Promise<RunResult> {
  const adapter = getAdapter(i.agent);
  const repoDir = i.repoDir;
  if (!i.sessionId) {
    return adapter.run({ prompt: i.prompt, sessionId: null, onDelta: i.onDelta, signal: i.signal, repoDir });
  }
  try {
    return await adapter.run({ prompt: i.prompt, sessionId: i.sessionId, onDelta: i.onDelta, signal: i.signal, repoDir });
  } catch (e) {
    // 시간 초과는 다시 돌리지 않는다 (상한을 두 번 기다리게 된다).
    if (!(e instanceof AgentError) || e instanceof RunTimeoutError || e.code !== 'agent_failed' || i.signal.aborted || !i.rebuildPrompt) throw e;
    return adapter.run({ prompt: i.rebuildPrompt(), sessionId: null, onDelta: i.onDelta, signal: i.signal, repoDir });
  }
}

// 응답에 실을 인터뷰 상태 (DB를 다시 읽는다).
export function interviewOf(projectId: number): Interview | null {
  return projectDetail(projectId)?.interview ?? null;
}
