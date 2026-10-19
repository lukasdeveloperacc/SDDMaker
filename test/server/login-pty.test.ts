import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runLogin } from '@/server/agents/exec';
import type { LoginTerminalControls } from '@/server/agents/types';
import { dataDir } from '@/server/env';

const fixture = path.resolve('test/fixtures/fake-login-pty.mjs');

async function until(predicate: () => boolean) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 8000) throw new Error('PTY 이벤트 대기 시간 초과');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function start(agent: 'claude' | 'codex', timeoutMs = 10000) {
  process.env[agent === 'claude' ? 'CLAUDE_CLI' : 'CODEX_CLI'] = fixture;
  let controls!: LoginTerminalControls;
  let output = '';
  const controller = new AbortController();
  const result = runLogin(agent, ['login'], {
    terminal: true,
    signal: controller.signal,
    timeoutMs,
    onPrompt: () => {},
    onOutput: (data) => { output += data; },
    onTerminalInput: (value) => { controls = value; },
  });
  // 취소 테스트의 거부는 기다리는 동안에도 처리해 unhandled rejection을 방지한다.
  const outcome = result.then(() => null, (error: unknown) => error as Error);
  return { controller, outcome, output: () => output, controls: () => controls };
}

describe('실제 로그인 PTY', () => {
  it.each(['claude', 'codex'] as const)('%s는 TTY, raw 키 입력, ANSI, resize를 지원한다', async (agent) => {
    process.env.OPENAI_API_KEY = 'must-be-stripped';
    const login = start(agent);
    try {
      await until(() => login.output().includes('"type":"ready"'));
      expect(login.output()).toContain('\x1b[32mPTY login\x1b[0m');
      expect(login.output()).toContain('"stdinTTY":true,"stdoutTTY":true,"cols":80,"rows":24');
      expect(login.output()).toContain('"term":"xterm-256color"');
      expect(login.output()).toContain('"hasApiKey":false');
      if (agent === 'codex') expect(login.output()).toContain(path.join(dataDir(), 'codex-home'));
      const controls = login.controls();
      const raw = '\x1b[A\x03\t\r';
      expect(controls.write(raw)).toBe(true);
      await until(() => login.output().includes(Buffer.from(raw).toString('hex')));
      expect(controls.resize(111, 37)).toBe(true);
      await until(() => login.output().includes('"type":"resize","cols":111,"rows":37'));
      expect(controls.resize(0, 1)).toBe(false);
      expect(controls.resize(501, 20)).toBe(false);
      expect(controls.resize(80.5, 20)).toBe(false);
      expect(controls.write('Q')).toBe(true);
      expect(await login.outcome).toBeNull();
      expect(controls.write('late')).toBe(false);
      expect(controls.resize(80, 24)).toBe(false);
    } finally {
      login.controller.abort();
      await login.outcome;
    }
  });

  it('취소는 SIGTERM을 무시하는 PTY와 같은 그룹의 손자까지 끝낸다', async () => {
    const pidFile = path.join(dataDir(), 'pty-group.json');
    process.env.FAKE_PTY_GROUP = '1';
    process.env.FAKE_PID_FILE = pidFile;
    const login = start('claude');
    try {
      await until(() => fs.existsSync(pidFile));
      await until(() => login.output().includes('"type":"ready"'));
      const { pid, child } = JSON.parse(fs.readFileSync(pidFile, 'utf8')) as { pid: number; child: number };
      login.controller.abort();
      expect(login.controls().write('late')).toBe(false);
      expect((await login.outcome)?.message).toBe('로그인이 취소되었습니다');
      await until(() => {
        try { process.kill(pid, 0); return false; } catch { return true; }
      });
      await until(() => {
        try { process.kill(child, 0); return false; } catch { return true; }
      });
    } finally {
      login.controller.abort();
      await login.outcome;
    }
  });

  it('시간 초과는 PTY를 끝내고 입력을 닫는다', async () => {
    const login = start('codex', 200);
    expect((await login.outcome)?.message).toBe('시간 초과');
    expect(login.controls().write('late')).toBe(false);
  });

  it('이미 취소된 요청은 PTY를 생성하지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();
    let opened = false;
    await expect(runLogin('claude', ['login'], {
      terminal: true,
      signal: controller.signal,
      onPrompt: () => {},
      onTerminalInput: () => { opened = true; },
    })).rejects.toMatchObject({ code: 'login_failed', message: '로그인이 취소되었습니다' });
    expect(opened).toBe(false);
  });
});
