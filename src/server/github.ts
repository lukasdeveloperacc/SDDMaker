import { rmSync } from 'node:fs';
import type { HttpErrorCode } from '@/lib/contract';
import { AgentError, RUN_TIMEOUT_MS, runLogin, runLogout, shellQuote, spawnCli } from './agents/exec';
import type { LoginInput } from './agents/types';
import { ghHome } from './env';

export type GithubErrorCode = Extract<
  HttpErrorCode,
  'gh_not_found' | 'github_not_connected' | 'repo_not_found' | 'clone_failed' | 'no_push_permission' | 'pr_failed'
>;

const STATUS_OF: Record<GithubErrorCode, number> = {
  gh_not_found: 409,
  github_not_connected: 409,
  repo_not_found: 404,
  clone_failed: 502,
  no_push_permission: 409,
  pr_failed: 502,
};

export class GithubError extends Error {
  readonly status: number;
  constructor(readonly code: GithubErrorCode, message: string) {
    super(message);
    this.name = 'GithubError';
    this.status = STATUS_OF[code];
  }
}

const HOST = ['--hostname', 'github.com'];
const LOGIN_ARGS = ['auth', 'login', ...HOST, '--git-protocol', 'https', '--web', '--insecure-storage'];
const PROBE_TIMEOUT_MS = 15_000;
const SEGMENT = '[A-Za-z0-9][A-Za-z0-9_.-]*';
const REPO_RE = new RegExp(`^(${SEGMENT})/(${SEGMENT})$`);

// 'owner/repo' 또는 'https://github.com/owner/repo'(.git 접미사, URL 끝 / 는 선택). 그 밖의 모양은 null.
export function parseRepo(input: string): string | null {
  let s = input.trim();
  const url = /^https:\/\/github\.com\/(.+)$/.exec(s);
  if (url) s = url[1].replace(/\/$/, '');
  s = s.replace(/\.git$/, '');
  const m = REPO_RE.exec(s);
  return m ? `${m[1]}/${m[2]}` : null;
}

interface GhStatus { installed: true; loggedIn: boolean; login: string | null }

// 연결 상태. 로그인된 계정 이름을 함께 준다.
async function status(): Promise<GhStatus> {
  const lines: string[] = [];
  const r = await spawnCli('github', ['auth', 'status', ...HOST, '--json', 'hosts'], {
    signal: new AbortController().signal,
    onLine: (line) => lines.push(line),
    timeoutMs: PROBE_TIMEOUT_MS,
    timeoutError: new AgentError('agent_failed', 'GitHub 연결 상태 확인 시간이 초과되었습니다'),
  });
  if (r.code !== 0) throw new AgentError('agent_failed', 'GitHub 연결 상태를 확인하지 못했습니다');
  const hosts = parseJson<{ hosts?: Record<string, { active?: boolean; state?: string; login?: string }[]> }>(lines).hosts;
  const login = hosts?.['github.com']?.find((h) => h.active && h.state === 'success')?.login ?? null;
  return { installed: true, loggedIn: login !== null, login };
}

function parseJson<T>(lines: string[]): T {
  try {
    return JSON.parse(lines.join('\n')) as T;
  } catch {
    throw new AgentError('agent_failed', 'GitHub CLI 응답을 읽지 못했습니다');
  }
}

export const githubCli = {
  status,
  login(i: LoginInput) {
    // 대화형 프롬프트를 끄는 기본값을 지워야 gh가 로그인 안내를 낸다.
    return runLogin('github', LOGIN_ARGS, { ...i, envOverride: { GH_PROMPT_DISABLED: undefined } });
  },
  async logout(signal: AbortSignal) {
    const login = await status().then((s) => s.login, () => null);
    await runLogout('github', ['auth', 'logout', ...HOST, ...(login ? ['--user', login] : [])], signal);
  },
  loginCommand() {
    return `GH_CONFIG_DIR=${shellQuote(ghHome())} gh ${LOGIN_ARGS.join(' ')}`;
  },
};

// 저장소 작업 전 확인: 설치, 로그인 순서로 막는다.
export async function ensureConnected(): Promise<void> {
  let s: GhStatus;
  try {
    s = await status();
  } catch (e) {
    if (e instanceof AgentError && e.code === 'cli_not_found') throw new GithubError('gh_not_found', 'GitHub CLI(gh)가 설치되어 있지 않습니다');
    throw new GithubError('github_not_connected', 'GitHub 연결 상태를 확인하지 못했습니다');
  }
  if (!s.loggedIn) throw new GithubError('github_not_connected', 'GitHub에 연결되어 있지 않습니다');
}

export interface RepoInfo { nameWithOwner: string; defaultBranch: string | null; viewerPermission: string }

export async function viewRepo(repo: string, signal: AbortSignal): Promise<RepoInfo> {
  const lines: string[] = [];
  const r = await spawnCli('github', ['repo', 'view', repo, '--json', 'nameWithOwner,defaultBranchRef,viewerPermission'], {
    signal,
    onLine: (line) => lines.push(line),
    timeoutMs: PROBE_TIMEOUT_MS,
    timeoutError: new AgentError('agent_failed', '저장소 정보 확인 시간이 초과되었습니다'),
  });
  if (r.code !== 0) throw new GithubError('repo_not_found', '저장소를 찾을 수 없거나 볼 권한이 없습니다');
  const d = parseJson<{ nameWithOwner: string; defaultBranchRef?: { name?: string } | null; viewerPermission: string }>(lines);
  return { nameWithOwner: d.nameWithOwner, defaultBranch: d.defaultBranchRef?.name ?? null, viewerPermission: d.viewerPermission };
}

// 얕은 복제. 실패하면 받은 폴더를 지우고 clone_failed로 끝낸다.
// shortcut: 복제가 끝날 때까지 요청이 기다린다(최대 RUN_TIMEOUT_MS), 대용량 저장소에서 진행 표시가 필요하면 바꾼다.
export async function cloneRepo(repo: string, dir: string, signal: AbortSignal): Promise<void> {
  let failure: unknown = null;
  try {
    const r = await spawnCli('github', ['repo', 'clone', repo, dir, '--', '--depth', '1', '-c', 'core.symlinks=false'], {
      signal,
      timeoutMs: RUN_TIMEOUT_MS,
      timeoutError: new GithubError('clone_failed', '저장소 복제 시간이 초과되었습니다'),
    });
    if (r.code === 0) return;
  } catch (e) {
    failure = e;
  }
  rmSync(dir, { recursive: true, force: true });
  if (failure instanceof GithubError) throw failure;
  throw new GithubError('clone_failed', '저장소를 복제하지 못했습니다');
}
