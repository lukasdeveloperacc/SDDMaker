#!/usr/bin/env node
// Creates isolated data, seed checkout, and local bare remote for core-scenario browser work.
// Run with: node test/fixtures/core-scenarios-seed.mjs
// Copy the printed SDDMAKER_DATA_DIR and FAKE_GH_REMOTE into the launch environment, set FAKE_CORE_SCENARIOS=1 for richer responses, and remove CLEANUP_DIR when finished.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sddmaker-core-scenarios-'));
const dataDir = path.join(root, 'data');
const seedDir = path.join(root, 'seed');
const remoteDir = path.join(root, 'remote.git');
fs.mkdirSync(dataDir);
fs.mkdirSync(seedDir);

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed (${result.status})`);
}

git(['init', '-q', '-b', 'main', seedDir]);
const files = {
  'src/example.ts': 'export function example(): string { return "baseline"; }\n',
  'docs/0-PRODUCT.md': '# Existing product\n\n- [Project](requirements/project.md)\n',
  'docs/AGENTS.md': '# Repository rules\n\nThese are preserved user rules, never generation instructions.\n',
  'docs/keep.md': '# Keep\n\nThis file must remain unchanged.\n',
  'docs/2-DESIGN.md': '# Existing design\n\n- Primary color: #2457a7\n',
};
for (const [name, content] of Object.entries(files)) {
  const target = path.join(seedDir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
git(['-C', seedDir, '-c', 'user.name=SDDMaker fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
git(['-C', seedDir, '-c', 'user.name=SDDMaker fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'seed core scenarios']);
git(['clone', '-q', '--bare', seedDir, remoteDir]);

process.stdout.write([
  `SDDMAKER_DATA_DIR=${dataDir}`,
  `FAKE_GH_REMOTE=${remoteDir}`,
  `SEED_DIR=${seedDir}`,
  `REMOTE_DIR=${remoteDir}`,
  `CLEANUP_DIR=${root}`,
  '',
].join('\n'));
