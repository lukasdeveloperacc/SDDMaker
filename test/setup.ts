import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 파일마다 새 데이터 폴더. 테스트가 실제 데이터를 건드리지 않게 한다.
process.env.SDDMAKER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sddmaker-test-'));

// 실제 CLI를 부르지 않도록 항상 가짜 실행 파일로 바꾼다.
process.env.CLAUDE_CLI = path.join(root, 'test/fixtures/fake-claude.mjs');
process.env.CODEX_CLI = path.join(root, 'test/fixtures/fake-codex.mjs');
for (const f of [process.env.CLAUDE_CLI, process.env.CODEX_CLI]) {
  if (fs.existsSync(f)) fs.chmodSync(f, 0o755);
}

// 테스트가 바꾼 환경변수가 다음 테스트로 새지 않게 키 단위로 되돌린다.
// process.env를 통째로 바꾸지 않는다 (Node 특수 env 객체가 깨져 자식 프로세스 상속이 틀어진다).
let snap: Record<string, string> = {};
beforeEach(() => {
  snap = { ...process.env } as Record<string, string>;
});
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('FAKE_') || k === 'CODEX_HOME') delete process.env[k];
  }
  for (const k of Object.keys(process.env)) {
    if (!(k in snap)) delete process.env[k];
  }
  for (const k of Object.keys(snap)) {
    process.env[k] = snap[k];
  }
});
