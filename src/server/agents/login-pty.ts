import { spawn } from 'node-pty';
import { agentWorkdir, cliPath } from '../env';
import { trackChild, untrackChild } from '../runtime';
import { AgentError, childEnv, type CliName, type LoginRunInput } from './exec';

// 로그인 명령 자체에 PTY를 연결한다. 셸이나 임의 명령은 실행하지 않는다.
export function runPtyLogin(cli: CliName, args: string[], input: LoginRunInput): Promise<void> {
  return new Promise((resolve, reject) => {
    if (input.signal.aborted) {
      reject(new AgentError('login_failed', '로그인이 취소되었습니다'));
      return;
    }
    let terminal: ReturnType<typeof spawn>;
    try {
      terminal = spawn(cliPath(cli), args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: agentWorkdir(),
        env: childEnv(cli, input.envOverride),
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      reject(new AgentError(code === 'ENOENT' || code === 'EACCES' ? 'cli_not_found' : 'login_failed', '로그인 터미널을 실행하지 못했습니다'));
      return;
    }
    trackChild(terminal.pid);
    let settled = false;
    let failure: AgentError | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-terminal.pid, signal);
      } catch {
        try { terminal.kill(signal); } catch { /* 이미 종료됨 */ }
      }
    };
    const stop = (reason: AgentError) => {
      if (settled || failure) return;
      failure = reason;
      signalGroup('SIGTERM');
      killTimer = setTimeout(() => signalGroup('SIGKILL'), 2000);
    };
    const onAbort = () => stop(new AgentError('login_failed', '로그인이 취소되었습니다'));
    const timer = setTimeout(() => stop(new AgentError('login_failed', '시간 초과')), input.timeoutMs ?? 600_000);
    const output = terminal.onData((data) => input.onOutput?.(data));
    const exit = terminal.onExit(({ exitCode }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      input.signal.removeEventListener('abort', onAbort);
      signalGroup('SIGKILL');
      untrackChild(terminal.pid);
      output.dispose();
      exit.dispose();
      if (failure) reject(failure);
      else if (exitCode !== 0) reject(new AgentError('login_failed', '로그인에 실패했습니다'));
      else resolve();
    });
    input.signal.addEventListener('abort', onAbort, { once: true });
    if (input.signal.aborted) onAbort();
    input.onTerminalInput?.({
      write(data) {
        if (settled || failure || input.signal.aborted) return false;
        try { terminal.write(data); return true; } catch { return false; }
      },
      resize(cols, rows) {
        if (settled || failure || input.signal.aborted) return false;
        if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 500 || rows > 200) return false;
        try { terminal.resize(cols, rows); return true; } catch { return false; }
      },
    });
  });
}
