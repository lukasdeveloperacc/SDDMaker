import type { AgentName, AgentStatus } from '@/lib/contract';

export { AgentError, RunTimeoutError } from './exec';

export interface RunInput {
  prompt: string;
  sessionId?: string | null;
  onDelta?: (text: string) => void;
  signal: AbortSignal;
  timeoutMs?: number; // 기본 RUN_TIMEOUT_MS (테스트에서 줄인다)
}
export interface RunResult { text: string; sessionId: string }
export interface LoginInput {
  onPrompt: (p: { url: string; code?: string }) => void;
  onOutput?: (text: string) => void;
  onCodeInput?: (submit: (text: string, close?: boolean) => boolean) => void;
  signal: AbortSignal;
  timeoutMs?: number; // 기본 600_000
}
export interface AgentAdapter {
  name: AgentName;
  run(i: RunInput): Promise<RunResult>;
  status(): Promise<Omit<AgentStatus, 'loginCommand'>>;
  login(i: LoginInput): Promise<void>; // 종료 코드 0이면 resolve. 실패·시간 초과·취소는 AgentError('login_failed'), 실행 파일 없음은 'cli_not_found'
  loginCommand(): string; // 터미널 로그인 안내 문구
}
