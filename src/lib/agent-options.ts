import { AGENT_NAMES, type AgentName } from '@/lib/contract';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export interface AgentOptions { model?: string; effort?: string }
export type AllAgentOptions = Partial<Record<AgentName, AgentOptions>>;

export const MODEL_SUGGESTIONS: Record<AgentName, string[]> = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.6-sol'],
};

export const OPTIONS_HEADER = 'x-agent-options';
const KEY = 'sddmaker:agent-options';

// CLI 인자로 그대로 넘어가므로 형식을 제한한다 (신뢰 경계: 서버도 같은 검사를 한다).
export function cleanOptions(v: unknown): AgentOptions {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const model = typeof o.model === 'string' && /^[A-Za-z0-9][\w.\-[\]]{0,63}$/.test(o.model) ? o.model : undefined;
  const effort = typeof o.effort === 'string' && (EFFORTS as readonly string[]).includes(o.effort) ? o.effort : undefined;
  return { model, effort };
}

export function readAllOptions(): AllAgentOptions {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as AllAgentOptions;
  } catch {
    return {};
  }
}

export function writeOptions(agent: AgentName, o: AgentOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAllOptions(), [agent]: o }));
  } catch { /* 저장소를 못 써도 이번 화면 선택만 잃는다 */ }
}

const AGENT_KEY = 'sddmaker:agent';

export function readAgent(): AgentName {
  try {
    const v = localStorage.getItem(AGENT_KEY);
    return AGENT_NAMES.find((name) => name === v) ?? 'claude';
  } catch {
    return 'claude';
  }
}

export function writeAgent(agent: AgentName): void {
  try {
    localStorage.setItem(AGENT_KEY, agent);
  } catch { /* 저장소를 못 써도 이번 화면 선택만 잃는다 */ }
}

// 에이전트를 실행하는 요청마다 붙인다. 서버는 실행할 에이전트의 값만 읽는다.
export const agentHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  [OPTIONS_HEADER]: JSON.stringify(readAllOptions()),
});
