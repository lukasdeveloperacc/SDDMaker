'use client';

import { useEffect, useState } from 'react';
import type { AgentName } from '@/lib/contract';
import { readAgent, writeAgent } from '@/lib/agent-options';
import { RunSettings } from '@/components/RunSettings';

// 연결 화면의 기본 실행 설정. 프로젝트 작업 화면에서 이번 작업만 바꿔 실행할 수도 있다.
export function DefaultRunSettings() {
  const [agent, setAgent] = useState<AgentName>('claude');
  // 서버 렌더와 맞추려고 마운트 뒤에 읽는다.
  useEffect(() => setAgent(readAgent()), []);
  return (
    <section className="connection-section" aria-label="기본 실행 설정">
      <h2 className="h3">기본 실행 설정</h2>
      <p className="caption">문서 생성에 쓸 에이전트·모델·추론 강도의 기본값입니다.</p>
      <RunSettings agent={agent} onAgentChange={(next) => { setAgent(next); writeAgent(next); }} />
    </section>
  );
}
