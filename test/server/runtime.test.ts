import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { AgentError, shellQuote, spawnCli, STRIPPED_ENV } from '@/server/agents/exec';
import { cancelRun, acquireLogin, acquireRun, cancelLogin, getRun, releaseLogin } from '@/server/runtime';
import { dataDir } from '@/server/env';

const ALL_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'OPENAI_BASE_URL',
];

const never = () => new AbortController().signal;

async function runEnv(agent: 'claude' | 'codex', stdin: string) {
  process.env.FAKE_MODE = 'env';
  const lines: string[] = [];
  const args = agent === 'claude' ? ['-p', 'arg1'] : ['exec', '-'];
  await spawnCli(agent, args, { stdin, signal: never(), onLine: (l) => lines.push(l) });
  return JSON.parse(lines.join('')) as Record<string, unknown>;
}

function waitFor(file: string) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (fs.existsSync(file)) return resolve();
      if (Date.now() - started > 10000) return reject(new Error('pid file not written'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function errorOf(p: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error('expected rejection');
}

const handles: Array<{ release(): void }> = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.release();
});

describe('spawnCli 환경', () => {
  it('로그인 안내의 경로는 공백·따옴표·셸 치환 문자가 있어도 그대로 전달된다', () => {
    const value = "/tmp/sdd maker's/$(exit 1)`exit 1`";
    expect(execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(value)}`], { encoding: 'utf8' })).toBe(value);
  });
  it.each(ALL_KEYS)('자식 프로세스에서 %s를 지운다', async (key) => {
    expect(STRIPPED_ENV).toContain(key);
    process.env[key] = 'secret';
    const env = await runEnv('claude', '');
    expect(env.present).not.toContain(key);
  });

  it('표준입력이 전달되고 작업 폴더는 데이터 폴더 아래 agent-workdir다', async () => {
    for (const k of ALL_KEYS) process.env[k] = 'secret';
    const env = await runEnv('claude', '안녕하세요');
    expect(env.stdin).toBe('안녕하세요');
    // macOS 임시 폴더는 /var가 /private/var로 풀리므로 실제 경로로 비교한다.
    expect(env.cwd).toBe(fs.realpathSync(path.join(dataDir(), 'agent-workdir')));
    expect(env.hasAnthropicKey).toBe(false);
    expect(env.hasAnthropicToken).toBe(false);
    expect(env.hasOpenaiKey).toBe(false);
    expect(env.hasCodexKey).toBe(false);
  });

  it('codex는 CODEX_HOME을 데이터 폴더 아래로 주고 claude는 주지 않는다', async () => {
    delete process.env.CODEX_HOME;
    expect((await runEnv('codex', '')).codexHome).toBe(path.join(dataDir(), 'codex-home'));
    expect((await runEnv('claude', '')).codexHome).toBeNull();
  });

  it('호스트의 CLI 홈 설정 대신 SDDMaker 전용 로그인 저장소를 쓴다', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/host/claude-config';
    process.env.CODEX_HOME = '/host/codex-home';
    expect((await runEnv('claude', '')).claudeConfigDir).toBe(path.join(dataDir(), 'claude-home'));
    expect((await runEnv('codex', '')).codexHome).toBe(path.join(dataDir(), 'codex-home'));
    expect(fs.statSync(path.join(dataDir(), 'claude-home')).isDirectory()).toBe(true);
  });

  it('CLI 경로가 없으면 cli_not_found', async () => {
    process.env.CLAUDE_CLI = '/nonexistent/sddmaker-cli';
    const err = await errorOf(spawnCli('claude', [], { stdin: '', signal: never() }));
    expect(err).toBeInstanceOf(AgentError);
    expect(err.code).toBe('cli_not_found');
  });

  it('자식이 입력을 읽기 전에 끝나도 테스트 프로세스가 죽지 않는다', async () => {
    process.env.FAKE_MODE = 'exit1';
    const result = await spawnCli('claude', ['-p'], { stdin: 'x'.repeat(5_000_000), signal: never() });
    expect(result.code).toBe(1);
  });

  it('표준 오류는 마지막 4KB만 남긴다', async () => {
    process.env.FAKE_MODE = 'stderr';
    const result = await spawnCli('claude', ['-p'], { stdin: '', signal: never() });
    expect(result.code).toBe(1);
    expect(result.stderr.length).toBeLessThanOrEqual(4096);
    expect(result.stderr.endsWith('END')).toBe(true);
  });

  it('줄 단위로 onLine에 넘긴다 (줄 끝에 걸린 조각 포함)', async () => {
    process.env.FAKE_MODE = 'ok';
    const lines: string[] = [];
    await spawnCli('claude', ['-p'], { stdin: '대상 문서: 0-PRODUCT.md', signal: never(), onLine: (l) => lines.push(l) });
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });
});

describe('spawnCli 취소와 시간 초과', () => {
  it('취소하면 자식 프로세스가 죽은 뒤 AbortError로 끝난다', async () => {
    const pidFile = path.join(dataDir(), 'pid-abort');
    process.env.FAKE_MODE = 'slow';
    process.env.FAKE_PID_FILE = pidFile;
    const ac = new AbortController();
    const p = spawnCli('claude', ['-p'], { stdin: '대상 문서: 0-PRODUCT.md', signal: ac.signal });
    await waitFor(pidFile);
    ac.abort();
    const err = await errorOf(p);
    expect(err.name).toBe('AbortError');
    expect(alive(Number(fs.readFileSync(pidFile, 'utf8')))).toBe(false);
  });

  it('시간 초과는 호출자가 준 오류로 끝나고 자식은 죽는다', async () => {
    const pidFile = path.join(dataDir(), 'pid-timeout');
    process.env.FAKE_MODE = 'slow';
    process.env.FAKE_PID_FILE = pidFile;
    const timeoutError = new AgentError('login_failed', '시간 초과');
    const err = await errorOf(spawnCli('claude', ['-p'], {
      stdin: '대상 문서: 0-PRODUCT.md',
      signal: never(),
      timeoutMs: 300,
      timeoutError,
    }));
    expect(err).toBe(timeoutError);
    expect(alive(Number(fs.readFileSync(pidFile, 'utf8')))).toBe(false);
  });
});

describe('실행 레지스트리', () => {
  it('같은 프로젝트는 하나만 잡히고, 풀린 뒤 다시 잡힌다', () => {
    const first = acquireRun(1, 'document', '0-PRODUCT.md');
    handles.push(first!);
    expect(first).not.toBeNull();
    expect(acquireRun(1, 'interview', null)).toBeNull();
    expect(getRun(1)).toEqual({ kind: 'document', path: '0-PRODUCT.md' });
    first!.release();
    first!.release(); // 두 번 불러도 안전
    expect(getRun(1)).toBeNull();
    const again = acquireRun(1, 'interview', null);
    handles.push(again!);
    expect(again).not.toBeNull();
  });

  it('다른 프로젝트는 동시에 잡을 수 있다', () => {
    const a = acquireRun(2, 'interview', null);
    const b = acquireRun(3, 'interview', null);
    handles.push(a!, b!);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('cancelRun은 취소 신호를 보내고 잠금이 풀릴 때까지 기다린다', async () => {
    const h = acquireRun(4, 'document', null)!;
    handles.push(h);
    h.controller.signal.addEventListener('abort', () => setTimeout(() => h.release(), 50));
    await cancelRun(4, 2000);
    expect(h.controller.signal.aborted).toBe(true);
    expect(getRun(4)).toBeNull();
  });

  it('cancelRun은 풀리지 않아도 waitMs 뒤에 돌아온다', async () => {
    const h = acquireRun(5, 'document', null)!;
    handles.push(h);
    const started = Date.now();
    await cancelRun(5, 100);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(h.controller.signal.aborted).toBe(true);
  });

  it('로그인 중복은 null이고, 풀린 뒤 다시 잡힌다', () => {
    const c = acquireLogin('claude');
    expect(c).not.toBeNull();
    expect(acquireLogin('claude')).toBeNull();
    cancelLogin('claude');
    expect(c!.signal.aborted).toBe(true);
    releaseLogin('claude', c!);
    expect(acquireLogin('claude')).not.toBeNull();
  });
});

describe('프로세스 그룹 정리', () => {
  it('취소하면 자식이 띄운 손자 프로세스도 함께 죽는다', async () => {
    const pidFile = path.join(dataDir(), 'pid-grandchild');
    process.env.FAKE_MODE = 'grandchild';
    process.env.FAKE_PID_FILE = pidFile;
    const ac = new AbortController();
    const p = spawnCli('claude', ['-p'], { stdin: '', signal: ac.signal });
    await waitFor(`${pidFile}.gc`);
    const child = Number(fs.readFileSync(pidFile, 'utf8'));
    const grandchild = Number(fs.readFileSync(`${pidFile}.gc`, 'utf8'));
    ac.abort();
    await errorOf(p);
    await waitGone(child);
    await waitGone(grandchild);
    expect(alive(child)).toBe(false);
    expect(alive(grandchild)).toBe(false);
  });
});

async function waitGone(pid: number) {
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise((r) => setTimeout(r, 20));
}

describe('앱 종료 시 자식 정리', () => {
  const VITE_NODE = path.resolve('node_modules/.bin/vite-node');
  const PARENT = path.resolve('test/fixtures/cleanup-parent.ts');

  // 부모 프로세스(별도 Node)가 가짜 CLI를 실행해 둔 상태를 만든다.
  function startParent(extraEnv: Record<string, string>) {
    const pidFile = path.join(dataDir(), `pid-parent-${Math.random().toString(36).slice(2)}`);
    const parent = spawn(process.execPath, [VITE_NODE, PARENT], {
      env: { ...process.env, FAKE_MODE: 'slow', FAKE_PID_FILE: pidFile, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { parent, pidFile };
  }

  it('부모가 SIGTERM을 받으면 자식 CLI가 끝나고 부모도 종료한다 (SIGTERM을 무시하는 CLI도 SIGKILL로)', async () => {
    const { parent, pidFile } = startParent({ FAKE_IGNORE_TERM: '1' });
    const exited = new Promise<NodeJS.Signals | number | null>((resolve) => {
      parent.on('exit', (code, sig) => resolve(sig ?? code));
    });
    await waitFor(pidFile);
    const cli = Number(fs.readFileSync(pidFile, 'utf8'));
    parent.kill('SIGTERM');
    await exited;
    await waitGone(cli);
    expect(alive(cli)).toBe(false);
  }, 30000);

  it('부모가 process.exit으로 끝나도 자식 CLI가 정리된다', async () => {
    const { parent, pidFile } = startParent({ CLEANUP_MODE: 'exit' });
    const exited = new Promise<void>((resolve) => parent.on('exit', () => resolve()));
    await waitFor(pidFile);
    const cli = Number(fs.readFileSync(pidFile, 'utf8'));
    await exited;
    await waitGone(cli);
    expect(alive(cli)).toBe(false);
  }, 30000);
});
