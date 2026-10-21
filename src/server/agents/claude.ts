import { randomUUID } from 'node:crypto';
import { AgentError, RUN_TIMEOUT_MS, RunTimeoutError, runLogin, runLogout, shellQuote, spawnCli } from './exec';
import { claudeHome } from '../env';
import { recordClaudeRateLimit } from './usage';
import type { AgentAdapter, RunInput, RunResult } from './types';

// 저장소 모드: 읽기 도구만, 코드 실행 도구 제거, 권한 프롬프트 없이 읽기 허용 (B0 확인 전 기본값).
function runArgs(repoDir: string | undefined): string[] {
  const tools = repoDir
    ? ['--tools', 'Read,Grep,Glob', '--restricted', '--allowedTools', 'Read,Grep,Glob']
    : ['--tools', ''];
  return [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    ...tools, '--setting-sources', '', '--strict-mcp-config',
  ];
}

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
    const args = [...runArgs(i.repoDir), ...(sessionId ? ['--resume', sessionId] : ['--session-id', newId as string])];
    const got: { result?: ClaudeEvent } = {};
    const r = await spawnCli('claude', args, {
      stdin: prompt,
      cwd: i.repoDir,
      signal,
      timeoutMs: i.timeoutMs ?? RUN_TIMEOUT_MS,
      timeoutError: new RunTimeoutError(),
      onLine: (line) => {
        let ev: ClaudeEvent;
        try { ev = JSON.parse(line) as ClaudeEvent; } catch { return; }
        if (!ev || typeof ev !== 'object') return; // `null` 같은 줄이 stdout 처리기에서 던지면 서버가 죽는다
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta') {
          const text = ev.event.delta?.text;
          if (typeof text === 'string') onDelta?.(text);
        } else if (ev.type === 'result') {
          got.result = ev;
        } else if (ev.type === 'rate_limit_event') {
          try { recordClaudeRateLimit(ev); } catch { /* 사용량은 실행을 막지 않는다 */ }
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

  logout(signal) {
    return runLogout('claude', ['auth', 'logout'], signal);
  },
};
