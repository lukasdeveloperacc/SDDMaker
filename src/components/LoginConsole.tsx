'use client';

import type { LoginTarget } from '@/lib/contract';
import { Button } from './ui';
import { AgentTerminal } from './AgentTerminal';

export const LOGIN_LABEL: Record<LoginTarget, string> = { claude: 'Claude Code', codex: 'Codex', github: 'GitHub' };
const LOGIN_COMMAND: Record<LoginTarget, string> = {
  claude: 'claude auth login --claudeai',
  codex: 'codex login --device-auth',
  github: 'gh auth login --hostname github.com --web',
};

export function LoginConsole({ agent, output, outputLength, loginId, running, onCancel }: {
  agent: LoginTarget;
  output: string;
  outputLength: number;
  loginId: string | null;
  running: boolean;
  onCancel: () => void;
}) {
  return (
    <section className="login-console" aria-label={`${LOGIN_LABEL[agent]} 계정 연결`}>
      <div className="login-terminal-header">
        <code>{LOGIN_COMMAND[agent]}</code>
        {running && <Button type="button" variant="utility" onClick={onCancel}>종료</Button>}
      </div>
      <AgentTerminal agent={agent} output={output} outputLength={outputLength} loginId={loginId} running={running} />
    </section>
  );
}
