import { describe, expect, it } from 'vitest';
import type { AgentErrorCode, AgentStatus } from '@/lib/contract';
import { agentErrorHelp, isAgentErrorCode } from '@/lib/agent-errors';

const STATUS: AgentStatus = {
  installed: true,
  loggedIn: false,
  subscription: false,
  loginCommand: 'claude /login',
};

const CODES: AgentErrorCode[] = ['cli_not_found', 'not_logged_in', 'not_subscription', 'login_failed', 'agent_failed'];

describe('agentErrorHelp', () => {
  it.each(CODES)('%s는 제목·본문·action이 있다', (code) => {
    const help = agentErrorHelp(code, STATUS);
    expect(help.title.length).toBeGreaterThan(0);
    expect(help.body.length).toBeGreaterThan(0);
    expect(['login', 'retry', 'none']).toContain(help.action);
  });

  it('not_logged_in이면 본문에 loginCommand가 들어간다', () => {
    const help = agentErrorHelp('not_logged_in', STATUS);
    expect(help.body).toContain(STATUS.loginCommand);
    expect(help.action).toBe('login');
  });

  it('cli_not_found는 환경 변수 이름을 안내한다', () => {
    const help = agentErrorHelp('cli_not_found');
    expect(help.body).toContain('CLAUDE_CLI');
    expect(help.body).toContain('CODEX_CLI');
    expect(help.action).toBe('none');
  });
});

describe('isAgentErrorCode', () => {
  it('알려진 다섯 코드만 통과시킨다', () => {
    for (const c of CODES) expect(isAgentErrorCode(c)).toBe(true);
    expect(isAgentErrorCode('busy')).toBe(false);
  });
});
