'use client';

import { useId } from 'react';
import { AGENT_NAMES, type AgentName } from '@/lib/contract';

export function AgentPicker({ value, onChange, disabled, lockedTo }: {
  value: AgentName;
  onChange: (agent: AgentName) => void;
  disabled?: boolean;
  lockedTo?: AgentName | null;
}) {
  const id = useId();
  return (
    <div className="agent-picker field">
      <label htmlFor={id}>에이전트</label>
      <select id={id} value={value} disabled={disabled}
        onChange={(event) => onChange(event.target.value as AgentName)}>
        {AGENT_NAMES.map((agent) => (
          <option key={agent} value={agent} disabled={lockedTo != null && lockedTo !== agent}>
            {agent === 'claude' ? 'Claude Code' : 'Codex'}
          </option>
        ))}
      </select>
    </div>
  );
}
