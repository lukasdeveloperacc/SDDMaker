import { agentWorkdir, codexHome } from '../env';
import { AgentError, RUN_TIMEOUT_MS, RunTimeoutError, runLogin, runLogout, shellQuote, spawnCli } from './exec';
import type { AgentAdapter, RunInput, RunResult } from './types';

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: { type?: string; text?: unknown };
  error?: { message?: unknown } | null;
  message?: unknown;
}

const never = () => new AbortController().signal;

export const codexAdapter: AgentAdapter = {
  name: 'codex',

  async run(i: RunInput): Promise<RunResult> {
    const { prompt, sessionId, signal, repoDir } = i;
    const args = [
      'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '--ignore-user-config',
      // 저장소 모드: AGENTS.md를 읽히지 않는다 (저장소 안의 지시를 따르지 않게 한다).
      ...(repoDir ? ['-c', 'project_doc_max_bytes=0'] : []),
      '-C', repoDir ?? agentWorkdir(),
      ...(sessionId ? ['resume', sessionId] : []),
      '-',
    ];
    const st: { threadId: string | null; text: string | null; failed: string | null; completed: boolean } = {
      threadId: null, text: null, failed: null, completed: false,
    };
    const r = await spawnCli('codex', args, {
      stdin: prompt,
      cwd: repoDir,
      signal,
      timeoutMs: i.timeoutMs ?? RUN_TIMEOUT_MS,
      timeoutError: new RunTimeoutError(),
      onLine: (line) => {
        let ev: CodexEvent;
        try { ev = JSON.parse(line) as CodexEvent; } catch { return; }
        if (!ev || typeof ev !== 'object') return; // `null` 같은 줄이 stdout 처리기에서 던지면 서버가 죽는다
        switch (ev.type) {
          case 'thread.started':
            if (typeof ev.thread_id === 'string') st.threadId = ev.thread_id;
            break;
          case 'item.completed':
            if (ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') st.text = ev.item.text;
            break;
          case 'turn.failed':
            st.failed = String(ev.error?.message ?? '실행에 실패했습니다');
            break;
          case 'error':
            st.failed = String(ev.message ?? '실행에 실패했습니다');
            break;
          case 'turn.completed':
            st.completed = true;
            break;
        }
      },
    });

    if (st.failed) throw new AgentError('agent_failed', st.failed.slice(0, 300));
    if (r.code === 0 && st.completed && st.text !== null) {
      return { text: st.text, sessionId: st.threadId ?? sessionId ?? '' };
    }
    throw new AgentError('agent_failed', r.stderr.slice(-300) || '응답이 없습니다');
  },

  async status() {
    let out = '';
    let code: number | null;
    try {
      const r = await spawnCli('codex', ['login', 'status'], {
        stdin: '',
        signal: never(),
        onLine: (l) => { out += l + '\n'; },
        onStderrLine: (l) => { out += l + '\n'; },
        timeoutMs: 15000,
        timeoutError: new AgentError('agent_failed', '상태 확인 시간 초과'),
      });
      code = r.code;
    } catch (e) {
      if (e instanceof AgentError && e.code === 'cli_not_found') {
        return { installed: false, loggedIn: false, subscription: false };
      }
      throw e;
    }
    if (code !== 0 || out.includes('Not logged in')) return { installed: true, loggedIn: false, subscription: false };
    if (out.includes('Logged in using ChatGPT')) return { installed: true, loggedIn: true, subscription: true };
    if (out.includes('Logged in')) return { installed: true, loggedIn: true, subscription: false };
    return { installed: true, loggedIn: false, subscription: false };
  },

  login(i) {
    return runLogin('codex', ['login', '--device-auth'], i);
  },

  loginCommand() {
    return `CODEX_HOME=${shellQuote(codexHome())} codex login --device-auth`;
  },

  logout(signal) {
    return runLogout('codex', ['logout'], signal);
  },
};
