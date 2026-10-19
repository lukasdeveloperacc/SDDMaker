#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';

if (process.argv.includes('status')) {
  const loggedIn = process.env.FAKE_AUTH !== 'logged_out';
  if (process.argv.includes('auth')) process.stdout.write(JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none' }));
  else process.stdout.write(loggedIn ? 'Logged in using ChatGPT\n' : 'Not logged in\n');
  process.exit(loggedIn || process.argv.includes('auth') ? 0 : 1);
}
process.stdin.setRawMode(true);
process.stdin.resume();
const report = (type, data) => process.stdout.write(JSON.stringify({ type, ...data }) + '\r\n');
if (process.env.FAKE_PTY_GROUP === '1') {
  process.on('SIGTERM', () => {});
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'ignore' });
  fs.writeFileSync(process.env.FAKE_PID_FILE, JSON.stringify({ pid: process.pid, child: child.pid }));
}
process.stdout.write('\x1b[32mPTY login\x1b[0m\r\n');
report('ready', { stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY, cols: process.stdout.columns, rows: process.stdout.rows, term: process.env.TERM, hasApiKey: Boolean(process.env.OPENAI_API_KEY), home: process.env.CODEX_HOME, cwd: process.cwd() });
process.on('SIGWINCH', () => report('resize', { cols: process.stdout.columns, rows: process.stdout.rows }));
process.stdin.on('data', (data) => {
  report('input', { hex: data.toString('hex') });
  if (data.toString() === 'Q') process.exit(0);
});
