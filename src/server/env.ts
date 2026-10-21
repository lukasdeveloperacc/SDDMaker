import fs from 'node:fs';
import path from 'node:path';
import type { CliName } from './agents/exec';

// 호출할 때마다 process.env를 읽는다 (테스트가 파일마다 값을 바꾼다).
export function dataDir(): string {
  return path.resolve(process.env.SDDMAKER_DATA_DIR || './data');
}

export function dbFile(): string {
  return path.join(dataDir(), 'sddmaker.db');
}

export function agentWorkdir(): string {
  const dir = path.join(dataDir(), 'agent-workdir');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function codexHome(): string {
  const dir = path.join(dataDir(), 'codex-home');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function claudeHome(): string {
  const dir = path.join(dataDir(), 'claude-home');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// GitHub 연결 전용 설정 디렉터리. 에이전트 CLI와 공유하지 않는다.
export function ghHome(): string {
  const dir = path.join(dataDir(), 'gh-home');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function reposDir(): string {
  const dir = path.join(dataDir(), 'repos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function repoDir(projectId: number): string {
  return path.join(reposDir(), String(projectId));
}

export function prWorktreesDir(): string {
  const dir = path.join(dataDir(), 'pr-worktrees');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cliPath(cli: CliName): string {
  if (cli === 'claude') return process.env.CLAUDE_CLI || 'claude';
  if (cli === 'codex') return process.env.CODEX_CLI || 'codex';
  if (cli === 'github') return process.env.GH_CLI || 'gh';
  return 'git';
}

export function docRulesFile(): string {
  return path.join(process.cwd(), 'docs', 'AGENTS.md');
}
