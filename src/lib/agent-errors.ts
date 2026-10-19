import type { AgentErrorCode, AgentStatus } from '@/lib/contract';

export interface AgentErrorHelp {
  title: string;
  body: string;
  action: 'login' | 'retry' | 'none';
}

const AGENT_ERROR_CODES: readonly string[] = [
  'cli_not_found',
  'not_logged_in',
  'not_subscription',
  'login_failed',
  'agent_failed',
];

export function isAgentErrorCode(code: string): code is AgentErrorCode {
  return AGENT_ERROR_CODES.includes(code);
}

// status가 있으면 터미널 로그인 명령을 본문에 넣는다.
export function agentErrorHelp(code: AgentErrorCode, status?: AgentStatus): AgentErrorHelp {
  const cmd = status ? ` 터미널에서 \`${status.loginCommand}\` 명령으로도 로그인할 수 있습니다.` : '';
  switch (code) {
    case 'cli_not_found':
      return {
        title: '에이전트 CLI를 찾지 못했습니다',
        body: '이 컴퓨터에 해당 CLI를 설치해 주세요. 설치했는데도 안 되면 .env.local에 CLAUDE_CLI 또는 CODEX_CLI를 실행 파일의 절대 경로로 적어 주세요. 다른 에이전트를 골라 계속할 수도 있습니다.',
        action: 'none',
      };
    case 'not_logged_in':
      return {
        title: '로그인이 필요합니다',
        body: `아래 로그인 버튼을 누르세요.${cmd}`,
        action: 'login',
      };
    case 'not_subscription':
      return {
        title: '구독 계정으로 로그인해 주세요',
        body: `구독이 아닌 방식으로 로그인되어 있어 실행하지 않았습니다. 구독 계정 로그인 버튼으로 다시 로그인하세요.${cmd}`,
        action: 'login',
      };
    case 'login_failed':
      return {
        title: '로그인하지 못했습니다',
        body: `로그인이 실패했거나 시간이 초과되었거나 취소되었습니다. 다시 시도해 주세요.${cmd}`,
        action: 'retry',
      };
    case 'agent_failed':
      return {
        title: '에이전트 실행이 실패했습니다',
        body: '에이전트가 오류와 함께 끝났습니다. 다시 실행해 주세요.',
        action: 'retry',
      };
  }
}
