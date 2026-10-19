#!/usr/bin/env node
// 가짜 Claude Code CLI. 출력 모양은 docs/1-SYSTEM-ARCHITECTURE.md "외부 연동"의 확인된 형식을 따른다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { answerFor, envReport, logout, mode, newId, readStdin, recordPid, stderrFlood } from './fake-lib.mjs';

const argv = process.argv.slice(2);
// FAKE_IGNORE_TERM=1이면 SIGTERM을 무시한다 (정리 로직이 SIGKILL까지 가는지 확인용).
if (process.env.FAKE_IGNORE_TERM === '1') process.on('SIGTERM', () => {});
const delay = Number(process.env.FAKE_DELAY_MS || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 이벤트 루프가 비지 않게 타이머를 붙여 둔다 (그러지 않으면 Node가 자식을 그냥 끝낸다).
const hang = () => new Promise(() => { setInterval(() => {}, 1000); });

function authStatus() {
  const m = process.env.FAKE_LOGOUT_FILE && fs.existsSync(process.env.FAKE_LOGOUT_FILE) ? 'logged_out' : process.env.FAKE_AUTH || 'logged_in';
  if (m === 'logged_out') process.stdout.write('{"loggedIn":false,"authMethod":"none"}\n');
  else if (m === 'api_key') process.stdout.write('{"loggedIn":true,"authMethod":"api_key"}\n');
  else process.stdout.write('{"loggedIn":true,"authMethod":"claude.ai"}\n');
  process.exit(0);
}

async function login() {
  recordPid();
  process.stdout.write('Opening browser: https://claude.ai/oauth/fake?x=1\n');
  const m = process.env.FAKE_LOGIN || 'ok';
  if (m === 'terminal') {
    const input = createInterface({ input: process.stdin });
    process.stderr.write('Paste code here if prompted > ');
    input.on('line', (line) => {
      if (line === 'test-code#state-value') {
        process.stdout.write('Login successful\n');
        process.exit(0);
      }
      process.stdout.write('Invalid code; try again\n');
    });
    return;
  }
  if (m === 'code') {
    const input = createInterface({ input: process.stdin });
    process.stderr.write('Paste code here if prompted > ');
    input.once('line', (line) => {
      const ok = line.trim() === 'test-code#state-value';
      process.stdout.write(ok ? 'Login successful\n' : 'Invalid code\n');
      // 명령이 입력 EOF까지 기다리는 경우도 종료되어야 한다.
      input.once('close', () => process.exit(ok ? 0 : 1));
    });
    return;
  }
  if (m === 'hang') await hang();
  process.exit(m === 'fail' ? 1 : 0);
}

function valueAfter(flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? null : argv[i + 1];
}

async function run() {
  recordPid();
  const m = mode();
  if (m === 'exit1') process.exit(1);
  if (m === 'stderr') stderrFlood();

  const sid = valueAfter('--resume') ?? valueAfter('--session-id') ?? newId();
  const stdin = await readStdin();
  if (m === 'env') {
    envReport(stdin);
    return;
  }

  const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  emit({ type: 'system', subtype: 'init', session_id: sid });

  if (m === 'resume_fail' && argv.includes('--resume')) {
    emit({ type: 'result', subtype: 'error', is_error: true, result: 'no session', session_id: sid });
    process.exit(0);
  }
  if (m === 'args') {
    // 받은 인자를 답으로 돌려준다 (어댑터가 넘긴 인자 확인용).
    emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(argv), session_id: sid });
    process.exit(0);
  }
  if (m === 'grandchild') {
    // 손자 프로세스를 띄우고 자식은 멈춘다. 손자 pid는 FAKE_PID_FILE + '.gc'에 적는다.
    const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(`${process.env.FAKE_PID_FILE}.gc`, String(gc.pid));
    await hang();
  }
  if (m === 'fail') {
    emit({ type: 'result', subtype: 'error', is_error: true, result: 'fake failure', session_id: sid });
    process.exit(0);
  }

  const text = answerFor(stdin);
  const third = Math.ceil(text.length / 3);
  const chunks = [text.slice(0, third), text.slice(third, third * 2), text.slice(third * 2)];
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0 && delay) await sleep(delay);
    if (m === 'slow' && i === 1) await hang();
    emit({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunks[i] } },
    });
  }
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sid });
  process.exit(0);
}

if (argv[0] === 'auth' && argv[1] === 'status') authStatus();
else if (argv[0] === 'auth' && argv[1] === 'logout') logout();
else if (argv[0] === 'auth' && argv[1] === 'login') login();
else run();
