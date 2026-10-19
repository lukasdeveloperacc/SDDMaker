import fs from 'node:fs';
import path from 'node:path';

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

export function cliPath(agent: 'claude' | 'codex'): string {
  return agent === 'claude'
    ? process.env.CLAUDE_CLI || 'claude'
    : process.env.CODEX_CLI || 'codex';
}

export function docRulesFile(): string {
  return path.join(process.cwd(), 'docs', 'AGENTS.md');
}
