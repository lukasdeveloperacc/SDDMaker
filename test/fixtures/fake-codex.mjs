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
  if (process.env.FAKE_NULL_LINE === '1') process.stdout.write('null\n');
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

// FAKE_USAGE별 rateLimits 모양. 시각은 응답할 때 계산한다. 기본 both.
function usageFor(mode) {
  const now = Math.floor(Date.now() / 1000);
  const win = (usedPercent, windowDurationMins, resetsAt) => ({ usedPercent, windowDurationMins, resetsAt });
  const five = (usedPercent = 45, resetsAt = now + 2 * 3600) => win(usedPercent, 300, resetsAt);
  const week = (usedPercent = 7, resetsAt = now + 6 * 86400) => win(usedPercent, 10080, resetsAt);
  switch (mode) {
    case 'weekly_only': return { primary: week(), secondary: null };
    case 'primary_null': return { primary: null, secondary: week() };
    case 'reset_null': return { primary: five(45, null), secondary: week() };
    case 'float': return { primary: five(7.6), secondary: week(104) };
    case 'clash': return { primary: five(45), secondary: win(7, 300, now + 3600) };
    case 'clash_invalid': return { primary: five(45, null), secondary: win(7, 300, now + 3600) };
    case 'boundary': return { primary: win(45, 1440, now + 2 * 3600), secondary: win(7, 1441, now + 6 * 86400) };
    case 'no_minutes': return { primary: win(45, null, now + 2 * 3600), secondary: win(7, 'x', now + 6 * 86400) };
    default: return { primary: five(), secondary: week() };
  }
}

// app-server: 사용량 읽기(JSON-RPC)만 흉내 낸다. 응답한 뒤에도 살아 있어서 앱이 끝내야 한다.
function appServer() {
  recordPid();
  const usage = process.env.FAKE_USAGE || 'both';
  const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  createInterface({ input: process.stdin }).on('line', (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg?.id === 1) {
      emit({ id: 1, result: { userAgent: 'fake' } });
      emit({ method: 'configWarning', params: { message: 'fake' } });
    } else if (msg?.id === 2) {
      if (usage === 'error') emit({ id: 2, error: { code: -32603, message: 'fake' } });
      else if (usage !== 'hang') emit({ id: 2, result: { rateLimits: usageFor(usage) } });
    }
  });
  hang();
}

if (argv[0] === 'login' && argv[1] === 'status') loginStatus();
else if (argv[0] === 'logout') logout();
else if (argv[0] === 'login') deviceLogin();
else if (argv[0] === 'exec') exec();
else if (argv[0] === 'app-server') appServer();
else process.exit(2);
