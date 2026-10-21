import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdapter, ensureReady, AgentError } from '@/server/agents';
import { claudeAdapter } from '@/server/agents/claude';
import { codexAdapter } from '@/server/agents/codex';
import { RUN_TIMEOUT_MS, RunTimeoutError, childEnv } from '@/server/agents/exec';
import { agentWorkdir, claudeHome, dataDir, ghHome } from '@/server/env';

const signal = () => new AbortController().signal;

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('claude 실행', () => {
  it('델타를 조각마다 넘기고 전체 텍스트와 세션 ID를 돌려준다', async () => {
    process.env.FAKE_MODE = 'ok';
    const deltas: string[] = [];
    const res = await claudeAdapter.run({
      prompt: '대상 문서: 0-PRODUCT.md',
      onDelta: (t) => deltas.push(t),
      signal: signal(),
    });
    expect(deltas).toHaveLength(3);
    expect(deltas.join('')).toBe(res.text);
    expect(res.text).toContain('# 제품');
    expect(res.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('새 세션은 --session-id로 새 UUID를 넘기고 그 값을 돌려준다', async () => {
    process.env.FAKE_MODE = 'args';
    const res = await claudeAdapter.run({ prompt: 'x', signal: signal() });
    const args = JSON.parse(res.text) as string[];
    const i = args.indexOf('--session-id');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe(res.sessionId);
    expect(args).toEqual(expect.arrayContaining([
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--tools', '', '--setting-sources', '', '--strict-mcp-config',
    ]));
    expect(args).not.toContain('--bare');
  });

  it('이어하기는 --resume <id>를 넘긴다', async () => {
    process.env.FAKE_MODE = 'args';
    const res = await claudeAdapter.run({ prompt: 'x', sessionId: 'abc-123', signal: signal() });
    const args = JSON.parse(res.text) as string[];
    const i = args.indexOf('--resume');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('abc-123');
    expect(args).not.toContain('--session-id');
    expect(res.sessionId).toBe('abc-123');
  });

  it('실패 응답은 agent_failed', async () => {
    process.env.FAKE_MODE = 'fail';
    const err = await errorOf(claudeAdapter.run({ prompt: 'x', signal: signal() }));
    expect(err).toBeInstanceOf(AgentError);
    expect(err.code).toBe('agent_failed');
  });

  it('종료 코드 1이면 agent_failed', async () => {
    process.env.FAKE_MODE = 'exit1';
    const err = await errorOf(claudeAdapter.run({ prompt: 'x', signal: signal() }));
    expect(err.code).toBe('agent_failed');
  });
});

describe('실행 시간 상한', () => {
  it('상한은 10분이다', () => {
    expect(RUN_TIMEOUT_MS).toBe(600_000);
  });

  it('claude가 상한을 넘기면 RunTimeoutError이고 프로세스는 죽는다', async () => {
    const pidFile = path.join(dataDir(), 'pid-run-timeout-claude');
    process.env.FAKE_MODE = 'slow';
    process.env.FAKE_PID_FILE = pidFile;
    const err = await errorOf(claudeAdapter.run({ prompt: 'x', signal: signal(), timeoutMs: 300 }));
    expect(err).toBeInstanceOf(RunTimeoutError);
    expect(err.code).toBe('agent_failed');
    expect(err.message).toBe('응답 시간이 초과되었습니다');
    expect(alive(Number(fs.readFileSync(pidFile, 'utf8')))).toBe(false);
  });

  it('codex가 상한을 넘기면 RunTimeoutError이고 프로세스는 죽는다', async () => {
    const pidFile = path.join(dataDir(), 'pid-run-timeout-codex');
    process.env.FAKE_MODE = 'slow';
    process.env.FAKE_PID_FILE = pidFile;
    const err = await errorOf(codexAdapter.run({ prompt: 'x', signal: signal(), timeoutMs: 300 }));
    expect(err).toBeInstanceOf(RunTimeoutError);
    expect(alive(Number(fs.readFileSync(pidFile, 'utf8')))).toBe(false);
  });
});

describe('codex 실행', () => {
  it('델타는 부르지 않고 마지막 agent_message와 thread_id를 돌려준다', async () => {
    process.env.FAKE_MODE = 'ok';
    const onDelta = vi.fn();
    const res = await codexAdapter.run({ prompt: '대상 문서: 0-PRODUCT.md', onDelta, signal: signal() });
    expect(onDelta).not.toHaveBeenCalled();
    expect(res.text).toContain('# 제품');
    expect(res.sessionId).toMatch(/^thread-/);
  });

  it('새 실행은 resume이 없고 인자 끝이 -다', async () => {
    process.env.FAKE_MODE = 'args';
    const res = await codexAdapter.run({ prompt: 'x', signal: signal() });
    const args = JSON.parse(res.text) as string[];
    expect(args).not.toContain('resume');
    expect(args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(args).toEqual(expect.arrayContaining(['--sandbox', 'read-only', '--skip-git-repo-check', '--ignore-user-config']));
    expect(args[args.indexOf('-C') + 1]).toBe(agentWorkdir());
    expect(args[args.length - 1]).toBe('-');
  });

  it('이어하기 인자 끝이 resume <id> -다', async () => {
    process.env.FAKE_MODE = 'args';
    const res = await codexAdapter.run({ prompt: 'x', sessionId: 'thread-9', signal: signal() });
    const args = JSON.parse(res.text) as string[];
    expect(args.slice(-3)).toEqual(['resume', 'thread-9', '-']);
    expect(res.sessionId).toBe('thread-9');
  });

  it('turn.failed는 agent_failed', async () => {
    process.env.FAKE_MODE = 'fail';
    const err = await errorOf(codexAdapter.run({ prompt: 'x', signal: signal() }));
    expect(err.code).toBe('agent_failed');
    expect(err.message).toContain('fake failure');
  });

  it('종료 코드 1이면 agent_failed', async () => {
    process.env.FAKE_MODE = 'exit1';
    const err = await errorOf(codexAdapter.run({ prompt: 'x', signal: signal() }));
    expect(err.code).toBe('agent_failed');
  });

  it('실행 뒤 작업 폴더는 비어 있다', async () => {
    process.env.FAKE_MODE = 'ok';
    await codexAdapter.run({ prompt: '대상 문서: 0-PRODUCT.md', signal: signal() });
    await claudeAdapter.run({ prompt: '대상 문서: 0-PRODUCT.md', signal: signal() });
    expect(fs.readdirSync(agentWorkdir())).toEqual([]);
  });
});

describe('상태 확인', () => {
  it('claude 로그인 상태와 구독 여부를 읽는다', async () => {
    process.env.FAKE_AUTH = 'logged_in';
    expect(await claudeAdapter.status()).toEqual({ installed: true, loggedIn: true, subscription: true });
    process.env.FAKE_AUTH = 'logged_out';
    expect(await claudeAdapter.status()).toEqual({ installed: true, loggedIn: false, subscription: false });
    process.env.FAKE_AUTH = 'api_key';
    expect(await claudeAdapter.status()).toEqual({ installed: true, loggedIn: true, subscription: false });
  });

  it('codex 로그인 상태와 구독 여부를 읽는다', async () => {
    process.env.FAKE_AUTH = 'logged_in';
    expect(await codexAdapter.status()).toEqual({ installed: true, loggedIn: true, subscription: true });
    process.env.FAKE_AUTH = 'logged_out';
    expect(await codexAdapter.status()).toEqual({ installed: true, loggedIn: false, subscription: false });
    process.env.FAKE_AUTH = 'api_key';
    expect(await codexAdapter.status()).toEqual({ installed: true, loggedIn: true, subscription: false });
  });

  it('실행 파일이 없으면 installed false', async () => {
    process.env.CLAUDE_CLI = '/nonexistent/claude';
    process.env.CODEX_CLI = '/nonexistent/codex';
    expect(await claudeAdapter.status()).toEqual({ installed: false, loggedIn: false, subscription: false });
    expect(await codexAdapter.status()).toEqual({ installed: false, loggedIn: false, subscription: false });
  });

  it('ensureReady가 상황별 오류를 던진다', async () => {
    process.env.FAKE_AUTH = 'logged_out';
    expect((await errorOf(ensureReady('claude'))).code).toBe('not_logged_in');
    expect((await errorOf(ensureReady('codex'))).code).toBe('not_logged_in');

    process.env.FAKE_AUTH = 'api_key';
    expect((await errorOf(ensureReady('claude'))).code).toBe('not_subscription');
    expect((await errorOf(ensureReady('codex'))).code).toBe('not_subscription');

    process.env.FAKE_AUTH = 'logged_in';
    await expect(ensureReady('claude')).resolves.toBeUndefined();

    process.env.CLAUDE_CLI = '/nonexistent/claude';
    expect((await errorOf(ensureReady('claude'))).code).toBe('cli_not_found');
  });

  it('childEnv는 에이전트 환경과 GitHub 환경을 서로 나눈다', () => {
    vi.stubEnv('GH_TOKEN', 'secret');
    vi.stubEnv('GH_CONFIG_DIR', '/leak');
    vi.stubEnv('CODEX_HOME', '/leak-codex');
    try {
      const claude = childEnv('claude');
      expect(claude.CLAUDE_CONFIG_DIR).toBe(claudeHome());
      expect(claude).not.toHaveProperty('GH_CONFIG_DIR');
      expect(claude).not.toHaveProperty('GIT_CONFIG_GLOBAL');

      const gh = childEnv('github');
      expect(gh.GH_CONFIG_DIR).toBe(ghHome());
      expect(gh.GIT_CONFIG_GLOBAL).toBe(path.join(ghHome(), 'gitconfig'));
      expect(gh.GH_PROMPT_DISABLED).toBe('1');
      expect(gh).not.toHaveProperty('CLAUDE_CONFIG_DIR');
      expect(gh).not.toHaveProperty('CODEX_HOME');
      expect(gh).not.toHaveProperty('GH_TOKEN');

      expect(childEnv('github', { GH_PROMPT_DISABLED: undefined })).not.toHaveProperty('GH_PROMPT_DISABLED');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('getAdapter가 이름에 맞는 어댑터를 준다', () => {
    expect(getAdapter('claude').name).toBe('claude');
    expect(getAdapter('codex').name).toBe('codex');
  });
});

describe('로그인', () => {
  it('claude는 URL을 알려 주고 종료 코드 0이면 끝난다', async () => {
    process.env.FAKE_LOGIN = 'ok';
    const prompts: Array<{ url: string; code?: string }> = [];
    await claudeAdapter.login({ onPrompt: (p) => prompts.push(p), signal: signal() });
    expect(prompts).toEqual([{ url: 'https://claude.ai/oauth/fake?x=1' }]);
  });

  it('codex는 URL과 코드를 알려 준다', async () => {
    process.env.FAKE_LOGIN = 'ok';
    const prompts: Array<{ url: string; code?: string }> = [];
    await codexAdapter.login({ onPrompt: (p) => prompts.push(p), signal: signal() });
    expect(prompts[prompts.length - 1]).toEqual({ url: 'https://auth.openai.com/codex/device', code: 'ABCD-12345' });
  });

  it('FAKE_LOGIN=fail이면 login_failed', async () => {
    process.env.FAKE_LOGIN = 'fail';
    const err = await errorOf(claudeAdapter.login({ onPrompt: () => {}, signal: signal() }));
    expect(err.code).toBe('login_failed');
  });

  it('시간 초과는 login_failed이고 자식 프로세스는 죽는다', async () => {
    const pidFile = path.join(dataDir(), 'pid-login');
    process.env.FAKE_LOGIN = 'hang';
    process.env.FAKE_PID_FILE = pidFile;
    const err = await errorOf(codexAdapter.login({ onPrompt: () => {}, signal: signal(), timeoutMs: 300 }));
    expect(err.code).toBe('login_failed');
    expect(alive(Number(fs.readFileSync(pidFile, 'utf8')))).toBe(false);
  });

  it('취소도 login_failed다', async () => {
    process.env.FAKE_LOGIN = 'hang';
    const ac = new AbortController();
    const p = claudeAdapter.login({ onPrompt: () => {}, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    const err = await errorOf(p);
    expect(err.code).toBe('login_failed');
  });

  it('실행 파일이 없으면 cli_not_found', async () => {
    process.env.CODEX_CLI = '/nonexistent/codex';
    const err = await errorOf(codexAdapter.login({ onPrompt: () => {}, signal: signal() }));
    expect(err.code).toBe('cli_not_found');
  });

  it('URL과 코드를 콘솔에 찍지 않는다', async () => {
    process.env.FAKE_LOGIN = 'ok';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await codexAdapter.login({ onPrompt: () => {}, signal: signal() });
    await claudeAdapter.login({ onPrompt: () => {}, signal: signal() });
    const printed = [...log.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(printed).not.toContain('https://');
    expect(printed).not.toContain('ABCD-12345');
  });
});
