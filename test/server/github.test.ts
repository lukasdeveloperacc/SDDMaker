import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentError } from '@/server/agents/exec';
import { cloneRepo, ensureConnected, githubCli, GithubError, parseRepo, viewRepo } from '@/server/github';
import { dataDir, ghHome } from '@/server/env';
import { acquireLogin, releaseLogin } from '@/server/runtime';
import { seedRemote, type SeededRemote } from '../helpers/github';

const signal = () => new AbortController().signal;
const cleanups: Array<() => void> = [];

// 가짜 gh가 매 호출마다 한 줄씩 남기는 기록.
type GhCall = { args: string[]; ghConfigDir: string | null; gitConfigGlobal: string | null; hasGhToken: boolean; promptDisabled: boolean };
const lastCall = (): GhCall => {
  const lines = fs.readFileSync(process.env.FAKE_GH_LOG!, 'utf8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
};

beforeEach(() => {
  process.env.FAKE_GH_LOG = path.join(dataDir(), `gh-${randomUUID()}.jsonl`);
  process.env.FAKE_AUTH = 'logged_in';
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanups.splice(0).forEach((f) => f());
});

function remoteFor(opts?: Parameters<typeof seedRemote>[0]): SeededRemote {
  const r = seedRemote(opts);
  cleanups.push(r.cleanup);
  process.env.FAKE_GH_REMOTE = r.remote;
  return r;
}

describe('parseRepo', () => {
  it('owner/repo와 github.com URL을 받아 owner/repo로 바꾼다', () => {
    expect(parseRepo('a/b')).toBe('a/b');
    expect(parseRepo('a.b/c_d')).toBe('a.b/c_d');
    expect(parseRepo('a/b.git')).toBe('a/b');
    expect(parseRepo('https://github.com/a/b.git')).toBe('a/b');
    expect(parseRepo('https://github.com/a/b/')).toBe('a/b');
  });

  it('그 밖의 모양은 null이다', () => {
    for (const bad of [
      'a', 'a/b/c', '-a/b', 'a/-b', '../x/y', 'a/b?x', 'http://evil.com/a/b',
      'git@github.com:a/b', 'https://github.com.evil.com/a/b',
    ]) {
      expect(parseRepo(bad), bad).toBeNull();
    }
  });
});

describe('GitHub 연결 상태', () => {
  it('로그인되어 있으면 계정 이름을 준다', async () => {
    expect(await githubCli.status()).toEqual({ installed: true, loggedIn: true, login: 'octo' });
  });

  it('로그아웃 상태면 loggedIn false다', async () => {
    process.env.FAKE_AUTH = 'logged_out';
    expect(await githubCli.status()).toEqual({ installed: true, loggedIn: false, login: null });
  });

  it('gh가 없으면 cli_not_found이고 ensureConnected는 gh_not_found(409)', async () => {
    process.env.GH_CLI = '/nonexistent/gh';
    await expect(githubCli.status()).rejects.toMatchObject({ code: 'cli_not_found' });
    const err = await ensureConnected().catch((e) => e);
    expect(err).toBeInstanceOf(GithubError);
    expect(err).toMatchObject({ code: 'gh_not_found', status: 409 });
  });

  it('로그인이 안 되어 있으면 ensureConnected는 github_not_connected(409)', async () => {
    process.env.FAKE_AUTH = 'logged_out';
    const err = await ensureConnected().catch((e) => e);
    expect(err).toMatchObject({ code: 'github_not_connected', status: 409 });
  });

  it('gh 호출은 전용 설정 폴더를 쓰고 부모의 GitHub 토큰을 넘기지 않는다', async () => {
    process.env.GH_TOKEN = 'secret-token';
    await githubCli.status();
    const call = lastCall();
    expect(call.ghConfigDir).toBe(ghHome());
    expect(call.gitConfigGlobal).toBe(path.join(ghHome(), 'gitconfig'));
    expect(call.hasGhToken).toBe(false);
    expect(call.promptDisabled).toBe(true);
    expect(ghHome().startsWith(dataDir())).toBe(true);
  });
});

describe('GitHub 로그인·로그아웃', () => {
  it('로그인 안내의 URL과 코드를 넘기고, 프롬프트 끄기 설정을 지운다', async () => {
    process.env.FAKE_LOGIN = 'ok';
    const prompts: Array<{ url: string; code?: string }> = [];
    await githubCli.login({ onPrompt: (p) => prompts.push(p), signal: signal() });
    expect(prompts[prompts.length - 1]).toEqual({ url: 'https://github.com/login/device', code: 'ABCD-1234' });
    expect(lastCall().promptDisabled).toBe(false);
    expect(lastCall().args.slice(0, 2)).toEqual(['auth', 'login']);
  });

  it('로그인 명령 안내는 전용 설정 폴더를 밝힌다', () => {
    expect(githubCli.loginCommand()).toMatch(/^GH_CONFIG_DIR='.*' gh auth login --hostname github\.com /);
  });

  it('로그아웃은 확인된 계정을 --user로 넘기고 전용 설정 폴더에서 실행한다', async () => {
    const record = path.join(dataDir(), 'gh-logout.json');
    process.env.FAKE_LOGOUT_FILE = record;
    await githubCli.logout(signal());
    const invocation = JSON.parse(fs.readFileSync(record, 'utf8'));
    expect(invocation.args).toEqual(['auth', 'logout', '--hostname', 'github.com', '--user', 'octo']);
    expect(invocation.ghConfigDir).toBe(ghHome());
    expect((await githubCli.status()).loggedIn).toBe(false);
  });

  it('같은 연결 대상의 로그인은 한 번에 하나만 받는다. 다른 대상은 따로 잠근다', () => {
    const gh = acquireLogin('github');
    try {
      expect(gh).not.toBeNull();
      expect(acquireLogin('github')).toBeNull();
      const claude = acquireLogin('claude');
      expect(claude).not.toBeNull();
      if (claude) releaseLogin('claude', claude);
    } finally {
      if (gh) releaseLogin('github', gh);
    }
  });
});

describe('저장소 조회·복제', () => {
  it('저장소 정보를 준다', async () => {
    remoteFor();
    expect(await viewRepo('octo/app', signal())).toEqual({ nameWithOwner: 'octo/app', defaultBranch: 'main', viewerPermission: 'WRITE' });
    process.env.FAKE_GH_PERMISSION = 'READ';
    expect((await viewRepo('octo/app', signal())).viewerPermission).toBe('READ');
  });

  it('저장소가 없으면 repo_not_found(404)', async () => {
    process.env.FAKE_GH_REPO = 'not_found';
    const err = await viewRepo('octo/none', signal()).catch((e) => e);
    expect(err).toMatchObject({ code: 'repo_not_found', status: 404 });
  });

  it('얕은 복제는 얕은 옵션과 심볼릭 링크 끄기로 실행되고 파일을 받는다', async () => {
    remoteFor();
    const dir = path.join(dataDir(), 'clone-ok');
    await cloneRepo('octo/app', dir, signal());
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe('# app\n');
    expect(lastCall().args).toEqual(['repo', 'clone', 'octo/app', dir, '--', '--depth', '1', '-c', 'core.symlinks=false']);
  });

  it('심볼릭 링크 docs는 폴더가 아닌 일반 파일로 내려온다 (바깥을 가리키지 않는다)', async () => {
    remoteFor({ symlinkDocs: true });
    const dir = path.join(dataDir(), 'clone-link');
    await cloneRepo('octo/app', dir, signal());
    const st = fs.lstatSync(path.join(dir, 'docs'));
    expect(st.isSymbolicLink()).toBe(false);
    expect(st.isDirectory()).toBe(false);
  });

  it('복제 실패는 clone_failed(502)이고 받다 만 폴더를 지운다', async () => {
    remoteFor();
    process.env.FAKE_GH_CLONE = 'fail';
    const dir = path.join(dataDir(), 'clone-fail');
    const err = await cloneRepo('octo/app', dir, signal()).catch((e) => e);
    expect(err).toMatchObject({ code: 'clone_failed', status: 502 });
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('gh 오류 메시지 원문은 AgentError가 아니므로 그대로 노출되지 않는다', async () => {
    process.env.FAKE_GH_REPO = 'not_found';
    const err = await viewRepo('octo/none', signal()).catch((e) => e);
    expect(err).not.toBeInstanceOf(AgentError);
    expect(String(err.message)).not.toContain('GraphQL');
  });
});
