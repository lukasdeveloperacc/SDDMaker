import type { AgentName } from '@/lib/contract';
import Link from 'next/link';
import { agentErrorHelp, isAgentErrorCode } from '@/lib/agent-errors';
import type { AgentRun } from '@/lib/use-agent-run';
import { Button, Notice } from '@/components/ui';

export function RunStatus({ run, agent }: { run: AgentRun; agent: AgentName }) {
  if (run.running) {
    return (
      <div className="stack" aria-live="polite">
        {agent === 'claude' ? (
          <pre className="run-stream">{run.text || '생성 중…'}</pre>
        ) : (
          <p className="caption">생성 중 · {run.elapsedSec}초</p>
        )}
        {agent === 'claude' && <p className="caption">{run.elapsedSec}초 경과</p>}
        <div>
          <Button variant="utility" onClick={run.cancel}>
            취소
          </Button>
        </div>
      </div>
    );
  }

  if (run.error) {
    const { error } = run;
    const help = isAgentErrorCode(error.code) ? agentErrorHelp(error.code) : null;
    return (
      <Notice tone="error" title={help?.title ?? '실행하지 못했습니다'}>
        <p className="notice-body">{help?.action === 'login' ? error.message : help?.body ?? error.message}</p>
        {help && help.action !== 'login' && <p className="caption">{error.message}</p>}
        {help?.action === 'login' && <Link href="/settings/agents">에이전트 연결</Link>}
        {error.items && error.items.length > 0 && (
          <ul className="caption">
            {error.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </Notice>
    );
  }

  return null;
}
