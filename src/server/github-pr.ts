import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync, type Stats } from 'node:fs';
import path from 'node:path';
import type { PrInfoResponse } from '@/lib/contract';
import { AgentError, RUN_TIMEOUT_MS, shellQuote, spawnCli } from './agents/exec';
import { cliPath, prWorktreesDir, repoDir } from './env';
import { ensureConnected, GithubError, viewRepo, type RepoInfo } from './github';

export const PR_TITLE = 'docs: SDD 문서 추가 (SDDMaker)';
const PR_BODY = 'SDDMaker에서 승인된 SDD 문서를 올렸습니다.\n';
const COMMIT_USER = (login: string, id: number) => ({ name: login, email: `${id}+${login}@users.noreply.github.com` });
const WRITE_PERMISSIONS = ['ADMIN', 'MAINTAIN', 'WRITE'];
const SECRET_RE = /\b(gh[opsur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|sk-ant-[A-Za-z0-9_-]{20,})/;
const CLEANUP_TIMEOUT_MS = 15_000;
const NOT_A_FOLDER = '저장소의 docs 경로가 폴더가 아니어서 PR을 올릴 수 없습니다';
const BRANCH_EXISTS = '같은 이름의 브랜치가 있습니다. 1분 뒤 다시 시도하세요';
const EMPTY_REPO = '빈 저장소에는 PR을 올릴 수 없습니다';

// 빈 저장소처럼 요청 자체가 맞지 않는 경우. 상태 코드를 409로 정해 둔다.
export class PrBlockedError extends Error {
  readonly code = 'pr_failed';
  readonly status = 409;
}

export interface PrFile { path: string; content: string }

// 저장소 확인 + 기본 브랜치가 있는지. 빈 저장소면 PR을 만들 수 없다.
async function repoForPr(repo: string, signal: AbortSignal): Promise<RepoInfo & { defaultBranch: string }> {
  let info: RepoInfo;
  try {
    info = await viewRepo(repo, signal);
  } catch (e) {
    if (e instanceof AgentError) throw new GithubError('pr_failed', '저장소 정보 확인 시간이 초과되었습니다');
    throw e;
  }
  if (info.defaultBranch === null) throw new PrBlockedError(EMPTY_REPO);
  return { ...info, defaultBranch: info.defaultBranch };
}

function lstatOrNull(p: string): Stats | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}

// 'docs/…' 경로의 중간 폴더가 실제 폴더이고 마지막이 일반 파일(없음 포함)일 때만 target을 돌려준다.
// 심볼릭 링크나 파일이 중간에 끼어 있으면 null.
function safeTarget(root: string, rel: string): string | null {
  const parts = rel.split('/');
  let cur = root;
  for (const part of parts.slice(0, -1)) {
    cur = path.join(cur, part);
    const st = lstatOrNull(cur);
    if (st && !st.isDirectory()) return null;
  }
  const target = path.join(cur, parts[parts.length - 1]);
  const st = lstatOrNull(target);
  if (st && !st.isFile()) return null;
  return target;
}

// 승인 시점의 문서 목록 기준 'docs/…' 경로들. 클론에 이미 있는 일반 파일만 덮어쓸 목록에 든다.
export async function prInfo(i: { projectId: number; repo: string; files: PrFile[]; signal: AbortSignal }): Promise<PrInfoResponse> {
  await ensureConnected();
  const info = await repoForPr(i.repo, i.signal);
  const clone = repoDir(i.projectId);
  const paths = i.files.map((f) => f.path);
  const overwrites = paths.filter((p) => {
    const target = safeTarget(clone, p);
    return target !== null && lstatOrNull(target) !== null;
  });
  return {
    repo: info.nameWithOwner,
    defaultBranch: info.defaultBranch,
    canPush: WRITE_PERMISSIONS.includes(info.viewerPermission),
    files: paths,
    overwrites,
  };
}

function stampUtc(d: Date): string {
  // 2026-10-21T02:56:… -> 20261021-0256
  return d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
}

// 임시 작업 트리에 파일을 쓴다. 중간 폴더가 심볼릭 링크·파일이면 아무것도 쓰지 않고 실패한다.
function writeFiles(wt: string, files: PrFile[]): void {
  const targets = files.map((f) => {
    const target = safeTarget(wt, f.path);
    if (target === null) throw new GithubError('pr_failed', NOT_A_FOLDER);
    return { target, content: f.content };
  });
  for (const { target, content } of targets) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

// gh를 git 인증 도우미로 쓰는 설정 (push·ls-remote 공통).
function credentialArgs(): string[] {
  const helper = `!${shellQuote(cliPath('github'))} auth git-credential`;
  return ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`];
}

// 원격에 같은 이름의 브랜치가 있는지. push 거절 문구에 기대지 않고 먼저 물어본다
// (같은 분·같은 초면 커밋이 같아 push가 조용히 성공할 수 있다).
async function remoteHasBranch(wt: string, branch: string, signal: AbortSignal): Promise<boolean> {
  const lines: string[] = [];
  const r = await spawnCli('git', ['-C', wt, ...credentialArgs(), 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`], {
    signal,
    onLine: (l) => lines.push(l),
    timeoutMs: RUN_TIMEOUT_MS,
    timeoutError: prTimeout(),
  });
  if (r.code !== 0) throw new GithubError('pr_failed', 'GitHub에 브랜치를 올리지 못했습니다');
  return lines.some((l) => l.trim() !== '');
}

export async function createPr(i: { projectId: number; repo: string; files: PrFile[]; signal: AbortSignal }): Promise<string> {
  const { signal } = i;
  if (i.files.some((f) => SECRET_RE.test(f.content))) {
    throw new GithubError('pr_failed', '문서에 토큰으로 보이는 값이 있어 PR을 올리지 않았습니다');
  }
  await ensureConnected();
  const info = await repoForPr(i.repo, signal);
  if (!WRITE_PERMISSIONS.includes(info.viewerPermission)) {
    throw new GithubError('no_push_permission', '이 저장소에 push 권한이 없어 PR을 올릴 수 없습니다');
  }
  const user = await ghApiUser(signal);
  const clone = repoDir(i.projectId);
  if (!existsSync(clone)) throw new GithubError('pr_failed', '저장소 클론이 없습니다. 프로젝트를 다시 만드세요');

  const worktrees = prWorktreesDir();
  for (const entry of readdirSync(worktrees)) {
    if (entry.startsWith(`${i.projectId}-`)) rmSync(path.join(worktrees, entry), { recursive: true, force: true });
  }
  await runGit(clone, ['worktree', 'prune'], signal);

  const stamp = stampUtc(new Date());
  const branch = `sddmaker/docs-${stamp}`;
  const wt = path.join(worktrees, `${i.projectId}-${stamp}`);
  try {
    await runGit(clone, ['-c', 'core.symlinks=false', 'worktree', 'add', '--detach', wt, 'HEAD'], signal);
    writeFiles(wt, i.files);
    await runGit(wt, ['add', 'docs'], signal);
    const diff = await spawnCli('git', ['-C', wt, 'diff', '--cached', '--quiet'], { signal, timeoutMs: RUN_TIMEOUT_MS, timeoutError: prTimeout() });
    if (diff.code === 0) throw new GithubError('pr_failed', '올릴 변경이 없습니다');
    const author = COMMIT_USER(user.login, user.id);
    await runGit(wt, ['-c', `user.name=${author.name}`, '-c', `user.email=${author.email}`, 'commit', '-m', PR_TITLE], signal);
    if (await remoteHasBranch(wt, branch, signal)) throw new GithubError('pr_failed', BRANCH_EXISTS);
    const push = await spawnCli('git', ['-C', wt, ...credentialArgs(), 'push', 'origin', `HEAD:refs/heads/${branch}`], {
      signal,
      timeoutMs: RUN_TIMEOUT_MS,
      timeoutError: prTimeout(),
    });
    if (push.code !== 0) throw new GithubError('pr_failed', 'GitHub에 브랜치를 올리지 못했습니다');
    return await ghPrCreate(i.repo, info.defaultBranch, branch, signal);
  } finally {
    // 취소·실패 뒤에도 정리한다. 요청 신호가 이미 끊겼을 수 있어 정리마다 새 시간 제한을 준다.
    await runGit(clone, ['worktree', 'remove', '--force', wt], AbortSignal.timeout(CLEANUP_TIMEOUT_MS)).catch(() => {});
    await runGit(clone, ['worktree', 'prune'], AbortSignal.timeout(CLEANUP_TIMEOUT_MS)).catch(() => {});
    rmSync(wt, { recursive: true, force: true });
  }
}

function prTimeout(): GithubError {
  return new GithubError('pr_failed', 'GitHub 작업 시간이 초과되었습니다');
}

async function runGit(cwd: string, args: string[], signal: AbortSignal): Promise<void> {
  const r = await spawnCli('git', ['-C', cwd, ...args], { signal, timeoutMs: RUN_TIMEOUT_MS, timeoutError: prTimeout() });
  if (r.code !== 0) throw new GithubError('pr_failed', 'git 작업에 실패했습니다');
}

async function ghApiUser(signal: AbortSignal): Promise<{ login: string; id: number }> {
  const lines: string[] = [];
  const r = await spawnCli('github', ['api', 'user'], {
    signal,
    onLine: (l) => lines.push(l),
    timeoutMs: RUN_TIMEOUT_MS,
    timeoutError: prTimeout(),
  });
  if (r.code !== 0) throw new GithubError('pr_failed', 'GitHub 계정을 확인하지 못했습니다');
  let d: { login?: unknown; id?: unknown };
  try {
    d = JSON.parse(lines.join('\n'));
  } catch {
    throw new GithubError('pr_failed', 'GitHub 계정을 확인하지 못했습니다');
  }
  if (typeof d.login !== 'string' || typeof d.id !== 'number') throw new GithubError('pr_failed', 'GitHub 계정을 확인하지 못했습니다');
  return { login: d.login, id: d.id };
}

async function ghPrCreate(repo: string, base: string, branch: string, signal: AbortSignal): Promise<string> {
  const lines: string[] = [];
  const r = await spawnCli('github', ['pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--title', PR_TITLE, '--body-file', '-'], {
    stdin: PR_BODY,
    signal,
    onLine: (l) => lines.push(l),
    timeoutMs: RUN_TIMEOUT_MS,
    timeoutError: prTimeout(),
  });
  const url = [...lines.join('\n').matchAll(/https:\/\/github\.com\/\S+\/pull\/\d+/g)].at(-1)?.[0];
  if (r.code !== 0 || !url) throw new GithubError('pr_failed', 'PR을 만들지 못했습니다');
  return url;
}
