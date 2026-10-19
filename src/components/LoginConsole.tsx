'use client';

import type { AgentName } from '@/lib/contract';
import { Button } from './ui';
import { AgentTerminal } from './AgentTerminal';

export function LoginConsole({ agent, output, outputLength, loginId, running, onCancel }: {
  agent: AgentName;
  output: string;
  outputLength: number;
  loginId: string | null;
  running: boolean;
  onCancel: () => void;
}) {
  return (
    <section className="login-console" aria-label={`${agent === 'claude' ? 'Claude Code' : 'Codex'} 계정 연결`}>
      <div className="login-terminal-header">
        <code>{agent === 'claude' ? 'claude auth login --claudeai' : 'codex login --device-auth'}</code>
        {running && <Button type="button" variant="utility" onClick={onCancel}>종료</Button>}
      </div>
      <AgentTerminal agent={agent} output={output} outputLength={outputLength} loginId={loginId} running={running} />
    </section>
  );
}
