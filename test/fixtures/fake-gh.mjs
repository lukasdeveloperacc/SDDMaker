#!/usr/bin/env node
// 가짜 GitHub CLI(gh). Node 표준 모듈만 쓴다. 저장소 복제·푸시는 실제 git으로 로컬 bare 저장소를 쓴다.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { logout, readStdin, recordPid } from './fake-lib.mjs';

const argv = process.argv.slice(2);
const hang = () => new Promise(() => { setInterval(() => {}, 1000); });

if (process.env.FAKE_GH_LOG) {
  fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({
    args: argv,
    ghConfigDir: process.env.GH_CONFIG_DIR ?? null,
    gitConfigGlobal: process.env.GIT_CONFIG_GLOBAL ?? null,
    cwd: process.cwd(),
    hasGhToken: 'GH_TOKEN' in process.env,
    promptDisabled: process.env.GH_PROMPT_DISABLED === '1',
  }) + '\n');
}

const user = () => process.env.FAKE_GH_USER || 'octo';
const loggedOut = () => process.env.FAKE_AUTH === 'logged_out'
  || (process.env.FAKE_LOGOUT_FILE && fs.existsSync(process.env.FAKE_LOGOUT_FILE));

function authStatus() {
  if (loggedOut()) {
    process.stdout.write('{"hosts":{}}\n');
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    hosts: { 'github.com': [{ active: true, state: 'success', login: user(), gitProtocol: 'https' }] },
  }) + '\n');
  process.exit(0);
}

async function authLogin() {
  recordPid();
  // 실제 gh의 비대화형 출력과 같은 두 줄 (표준 오류)
  process.stderr.write('! First copy your one-time code: ABCD-1234\n');
  process.stderr.write('Open this URL to continue in your web browser: https://github.com/login/device\n');
  const m = process.env.FAKE_LOGIN || 'ok';
  if (m === 'terminal') {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      if (chunk.includes('confirm-device')) process.exit(0);
    });
    return;
  }
  if (m === 'hang') await hang();
  process.exit(m === 'fail' ? 1 : 0);
}

function repoView() {
  if (process.env.FAKE_GH_REPO === 'not_found') {
    process.stderr.write('GraphQL: Could not resolve to a Repository\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    nameWithOwner: argv[2],
    defaultBranchRef: { name: 'main' },
    viewerPermission: process.env.FAKE_GH_PERMISSION || 'WRITE',
  }) + '\n');
  process.exit(0);
}

function repoClone() {
  const dir = argv[3];
  const mode = process.env.FAKE_GH_CLONE;
  if (mode === 'fail') {
    fs.mkdirSync(`${dir}/partial`, { recursive: true });
    process.exit(1);
  }
  if (mode === 'hang') {
    recordPid();
    return hang();
  }
  const dash = argv.indexOf('--');
  const gitArgs = dash === -1 ? [] : argv.slice(dash + 1);
  const r = spawnSync('git', ['clone', ...gitArgs, `file://${process.env.FAKE_GH_REMOTE}`, dir], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

async function prCreate() {
  const body = await readStdin();
  const mode = process.env.FAKE_GH_PR;
  if (mode === 'fail') {
    process.stderr.write('pull request create failed\n');
    process.exit(1);
  }
  if (mode === 'hang') return hang();
  const at = argv.indexOf('--repo');
  const repo = at === -1 ? 'octo/app' : argv[at + 1];
  process.stdout.write(`https://github.com/${repo}/pull/1\n`);
  process.exit(0);
}

const [a, b] = argv;
if (a === 'auth' && b === 'status') authStatus();
else if (a === 'auth' && b === 'login') await authLogin();
else if (a === 'auth' && b === 'logout') await logout();
else if (a === 'auth' && b === 'git-credential') process.exit(0);
else if (a === 'api' && b === 'user') {
  process.stdout.write(JSON.stringify({ login: user(), id: 1 }) + '\n');
  process.exit(0);
} else if (a === 'repo' && b === 'view') repoView();
else if (a === 'repo' && b === 'clone') repoClone();
else if (a === 'pr' && b === 'create') await prCreate();
else {
  process.stderr.write(`fake gh: unsupported command ${argv.join(' ')}\n`);
  process.exit(2);
}
