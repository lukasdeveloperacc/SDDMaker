'use client';

import { useEffect, useId, useState } from 'react';
import { AGENT_NAMES, type AgentName } from '@/lib/contract';
import { cleanOptions, EFFORTS, MODEL_SUGGESTIONS, readAllOptions, writeOptions, type AgentOptions } from '@/lib/agent-options';
import { useRunActive } from '@/lib/run-activity';

// 목록에 없는 모델 이름을 직접 적을 때 고르는 항목. 모델 이름은 영숫자로 시작해야 하므로 겹치지 않는다.
const CUSTOM = '*custom';

// 에이전트·모델·추론 강도 선택. 프로젝트 화면에 하나만 두고, 실행이 도는 동안은 잠근다.
export function AgentPicker({ value, onChange, disabled: disabledProp, lockedTo }: {
  value: AgentName;
  onChange: (agent: AgentName) => void;
  disabled?: boolean;
  lockedTo?: AgentName | null;
}) {
  const id = useId();
  const running = useRunActive();
  const disabled = disabledProp || running;
  const [opts, setOpts] = useState<AgentOptions>({});
  const [typing, setTyping] = useState(false);
  // 모델·강도는 에이전트별로 브라우저에 저장하고, 실행할 때 요청 헤더로 보낸다.
  useEffect(() => {
    setOpts(cleanOptions(readAllOptions()[value]));
    setTyping(false);
  }, [value]);
  const set = (patch: AgentOptions) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    writeOptions(value, next);
  };
  const raw = opts.model ?? '';
  const modelBad = raw !== '' && cleanOptions({ model: raw }).model === undefined;
  // 목록에 없는 이름이 저장돼 있거나 직접 입력을 골랐으면 입력란을 보인다.
  const custom = typing || (raw !== '' && !MODEL_SUGGESTIONS[value].includes(raw));
  return (
    <div className="agent-picker field">
      <div className="agent-picker-item">
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
      <div className="agent-picker-item">
        <label htmlFor={`${id}-model`}>모델</label>
        <select id={`${id}-model`} className="agent-model" value={custom ? CUSTOM : raw} disabled={disabled}
          onChange={(e) => {
            setTyping(e.target.value === CUSTOM);
            if (e.target.value !== CUSTOM) set({ model: e.target.value || undefined });
          }}>
          <option value="">기본값</option>
          {MODEL_SUGGESTIONS[value].map((m) => <option key={m} value={m}>{m}</option>)}
          <option value={CUSTOM}>직접 입력…</option>
        </select>
        {custom && (
          <input aria-label="모델 이름" placeholder="모델 이름" value={raw} disabled={disabled}
            aria-invalid={modelBad} onChange={(e) => set({ model: e.target.value.trim() })} />
        )}
      </div>
      <div className="agent-picker-item">
        <label htmlFor={`${id}-effort`}>추론 강도</label>
        <select id={`${id}-effort`} className="agent-effort" value={opts.effort ?? ''} disabled={disabled}
          onChange={(e) => set({ effort: e.target.value || undefined })}>
          <option value="">기본값</option>
          {EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
    </div>
  );
}
