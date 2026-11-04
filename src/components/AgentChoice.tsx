'use client';

import { createContext, useContext } from 'react';
import type { AgentName } from '@/lib/contract';

// 프로젝트 화면 맨 위 실행 설정에서 고른 에이전트. 인터뷰·문서·화면·일괄 실행이 모두 이것으로 실행한다.
export const AgentChoice = createContext<AgentName>('claude');

export function useAgentChoice(): AgentName {
  return useContext(AgentChoice);
}
