#!/usr/bin/env node
// 가짜 Codex CLI. 이벤트 모양은 docs/1-SYSTEM-ARCHITECTURE.md "외부 연동"의 확인된 형식을 따른다.
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import { answerFor, envReport, logout, mode, newId, readStdin, recordPid, stderrFlood } from './fake-lib.mjs';

const argv = process.argv.slice(2);
// 이벤트 루프가 비지 않게 타이머를 붙여 둔다 (그러지 않으면 Node가 자식을 그냥 끝낸다).
const hang = () => new Promise(() => { setInterval(() => {}, 1000); });

function loginStatus() {
  const m = process.env.FAKE_LOGOUT_FILE && fs.existsSync(process.env.FAKE_LOGOUT_FILE) ? 'logged_out' : process.env.FAKE_AUTH || 'logged_in';
  if (m === 'logged_out') {
    process.stdout.write('Not logged in\n');
    process.exit(1);
  }
  process.stdout.write(m === 'api_key' ? 'Logged in using an API key\n' : 'Logged in using ChatGPT\n');
  process.exit(0);
}

async function deviceLogin() {
  recordPid();
  process.stdout.write('Open https://auth.openai.com/codex/device\nEnter this code: ABCD-12345\n');
  const m = process.env.FAKE_LOGIN || 'ok';
  if (m === 'terminal') {
    const input = createInterface({ input: process.stdin });
    input.on('line', (line) => {
      if (line === 'confirm-device') {
        process.stdout.write('Device confirmation received\n');
        process.exit(0);
      }
      process.stdout.write('Waiting for device confirmation\n');
    });
    return;
  }
  if (m === 'hang' || m === 'code') await hang();
  process.exit(m === 'fail' ? 1 : 0);
}

async function exec() {
  recordPid();
  const m = mode();
  if (m === 'exit1') process.exit(1);
  if (m === 'stderr') stderrFlood();

  const stdin = await readStdin();
  if (m === 'env') {
    envReport(stdin);
    return;
  }

  const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  const resumeAt = argv.indexOf('resume');
  if (resumeAt !== -1 && m === 'resume_fail') {
    emit({ type: 'error', message: 'no session' });
    process.exit(1);
  }

  const threadId = resumeAt !== -1 ? argv[resumeAt + 1] : `thread-${newId()}`;
  emit({ type: 'thread.started', thread_id: threadId });
  emit({ type: 'turn.started' });
  if (m === 'fail') {
    emit({ type: 'turn.failed', error: { message: 'fake failure' } });
    process.exit(1);
  }
  if (m === 'args') {
    emit({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: JSON.stringify(argv) } });
    emit({ type: 'turn.completed', usage: {} });
    process.exit(0);
  }
  if (m === 'slow') await hang();

  emit({
    type: 'item.completed',
    item: { id: 'item_0', type: 'agent_message', text: answerFor(stdin) },
  });
  emit({ type: 'turn.completed', usage: {} });
  process.exit(0);
}

if (argv[0] === 'login' && argv[1] === 'status') loginStatus();
else if (argv[0] === 'logout') logout();
else if (argv[0] === 'login') deviceLogin();
else if (argv[0] === 'exec') exec();
else process.exit(2);
