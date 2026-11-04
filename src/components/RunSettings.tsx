'use client';

import type { AgentName } from '@/lib/contract';
import { AgentPicker } from '@/components/AgentPicker';

// 에이전트·모델·추론 강도. 연결 화면(기본값)과 프로젝트 작업 화면(이번 작업)이 같이 쓴다.
// 선택은 브라우저에 저장되어 다음 실행의 기본값이 된다.
export function RunSettings({ agent, onAgentChange, lockedTo, disabled }: {
  agent: AgentName;
  onAgentChange: (agent: AgentName) => void;
  lockedTo?: AgentName | null;
  disabled?: boolean;
}) {
  return (
    <div className="run-settings">
      <AgentPicker value={agent} onChange={onAgentChange} disabled={disabled} lockedTo={lockedTo} />
      {lockedTo && <p className="caption">인터뷰는 시작한 에이전트로 이어서 진행합니다.</p>}
    </div>
  );
}
