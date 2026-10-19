import { randomUUID } from 'node:crypto';
import { AgentError, RUN_TIMEOUT_MS, RunTimeoutError, runLogin, shellQuote, spawnCli } from './exec';
import { claudeHome } from '../env';
import type { AgentAdapter, RunInput, RunResult } from './types';

const RUN_ARGS = [
  '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  '--tools', '', '--setting-sources', '', '--strict-mcp-config',
];

interface ClaudeEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  event?: { type?: string; delta?: { text?: unknown } };
}

const never = () => new AbortController().signal;

export const claudeAdapter: AgentAdapter = {
  name: 'claude',

  async run(i: RunInput): Promise<RunResult> {
    const { prompt, sessionId, onDelta, signal } = i;
    const newId = sessionId ? null : randomUUID();
    const args = [...RUN_ARGS, ...(sessionId ? ['--resume', sessionId] : ['--session-id', newId as string])];
    const got: { result?: ClaudeEvent } = {};
    const r = await spawnCli('claude', args, {
      stdin: prompt,
      signal,
      timeoutMs: i.timeoutMs ?? RUN_TIMEOUT_MS,
      timeoutError: new RunTimeoutError(),
      onLine: (line) => {
        let ev: ClaudeEvent;
        try { ev = JSON.parse(line) as ClaudeEvent; } catch { return; }
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
          const text = ev.event.delta?.text;
          if (typeof text === 'string') onDelta?.(text);
        } else if (ev.type === 'result') {
          got.result = ev;
        }
      },
    });

    const res = got.result;
    if (res) {
      if (res.is_error) throw new AgentError('agent_failed', String(res.result ?? '').slice(0, 300));
      return { text: String(res.result ?? ''), sessionId: res.session_id ?? sessionId ?? newId as string };
    }
    throw new AgentError('agent_failed', r.stderr.slice(-300) || '응답이 없습니다');
  },

  async status() {
    let out = '';
    try {
      await spawnCli('claude', ['auth', 'status'], {
        stdin: '',
        signal: never(),
        onLine: (l) => { out += l + '\n'; },
        timeoutMs: 15000,
        timeoutError: new AgentError('agent_failed', '상태 확인 시간 초과'),
      });
    } catch (e) {
      if (e instanceof AgentError && e.code === 'cli_not_found') {
        return { installed: false, loggedIn: false, subscription: false };
      }
      throw e;
    }
    let loggedIn = false;
    let authMethod: unknown;
    try {
      const j = JSON.parse(out) as { loggedIn?: unknown; authMethod?: unknown };
      loggedIn = j.loggedIn === true;
      authMethod = j.authMethod;
    } catch {
      loggedIn = false;
    }
    return { installed: true, loggedIn, subscription: loggedIn && authMethod === 'claude.ai' };
  },

  login(i) {
    return runLogin('claude', ['auth', 'login', '--claudeai'], i);
  },

  loginCommand() {
    return `CLAUDE_CONFIG_DIR=${shellQuote(claudeHome())} claude auth login --claudeai`;
  },
};
