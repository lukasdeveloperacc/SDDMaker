import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { AgentName } from '@/lib/contract';
import { AgentError, spawnCli } from './agents/exec';
import { currentAgentOptions } from './agents/options';
import { flagUpstream, getDocument, getProject, listDocuments, tx, updateDocument } from './db';
import { kindOf, laterWithContent } from './doc-rules';
import { dataDir } from './env';
import { log } from '@/lib/log';

// impeccable live: 브라우저에서 화면 요소를 골라 변형을 만들고 고르는 모드.
// 앱이 화면을 작업 폴더로 내보내고, impeccable 보조 서버를 띄우고, 에이전트(Claude·Codex)가 그 폴더에서 이벤트를 받아 파일을 고친다.
// 결과는 사용자가 "가져오기"를 눌러야 프로젝트에 들어간다.
// shortcut: 보조 서버가 포트 하나를 쓰므로 앱 전체에서 세션은 하나뿐이다. 여럿이 필요하면 포트를 세션마다 나눈다.

export interface LiveStatus {
  active: boolean;         // 이 프로젝트의 세션이 열려 있다
  otherProject: number | null; // 다른 프로젝트가 세션을 쓰고 있다
  agent: AgentName | null;
  agentRunning: boolean;   // 에이전트가 이벤트를 기다리고 있다 (끝났으면 false)
  error: string | null;
  startedAt: string | null;
  changed: string[];       // 가져오지 않은 변경이 있는 화면
}

interface Session {
  projectId: number;
  agent: AgentName;
  dir: string;
  startedAt: string;
  abort: AbortController;
  agentRunning: boolean;
  error: string | null;
}

const g = globalThis as { __sddLive?: Session | null; __sddLiveForward?: net.Server };
const AGENT_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const INJECT = /\s*<!--\s*impeccable-live-start\s*-->[\s\S]*?<!--\s*impeccable-live-end\s*-->|\s*<script[^>]*\/live\.js[^>]*>\s*<\/script>/gi;
const LEFTOVER = /impeccable-(variants|carbonize)|data-impeccable-/i;
const BASELINE = '.sddmaker-baseline.json';

export function skillDir(): string {
  return process.env.IMPECCABLE_SKILL_DIR || '/opt/impeccable/skills/impeccable';
}

export function livePort(): number {
  return Number(process.env.LIVE_PORT || 8400);
}

export function liveDir(projectId: number): string {
  return path.join(dataDir(), 'live', String(projectId));
}

export function activeLive(): Session | null {
  return g.__sddLive ?? null;
}

// 테스트에서만 쓴다 (프로세스를 띄우지 않고 세션을 열린 상태로 둔다).
export function setLiveForTest(s: { projectId: number; agent: AgentName } | null): void {
  g.__sddLive = s && { ...s, dir: liveDir(s.projectId), startedAt: new Date().toISOString(), abort: new AbortController(), agentRunning: false, error: null };
}

const strip = (html: string) => html.replace(INJECT, '');
const same = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, ''); // 주입을 지우며 생긴 빈 줄 차이는 무시

function readBaseline(dir: string): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(path.join(dir, BASELINE), 'utf8')) as Record<string, string>; } catch { return {}; }
}
function writeBaseline(dir: string, b: Record<string, string>) {
  fs.writeFileSync(path.join(dir, BASELINE), JSON.stringify(b));
}
function readScreen(dir: string, p: string): string | null {
  try { return fs.readFileSync(path.join(dir, p), 'utf8'); } catch { return null; }
}

// 화면을 작업 폴더로 내보낸다. 가져오지 않은 변경이 있는 화면은 덮어쓰지 않는다 (다시 열면 이어서 한다).
export function prepareWorkspace(projectId: number): string {
  const project = getProject(projectId);
  if (!project) throw new AgentError('agent_failed', '프로젝트를 찾을 수 없습니다');
  const docs = listDocuments(projectId);
  const screens = docs.filter((d) => kindOf(d.path) === 'screen' && d.content.trim() !== '');
  if (screens.length === 0) throw new AgentError('agent_failed', '다듬을 화면이 없습니다. 화면을 먼저 생성하세요');
  const dir = liveDir(projectId);
  fs.mkdirSync(path.join(dir, 'screens'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.impeccable', 'live'), { recursive: true });
  const baseline = readBaseline(dir);
  for (const d of screens) {
    const file = readScreen(dir, d.path);
    const pending = file !== null && baseline[d.path] !== undefined && !same(strip(file), baseline[d.path]);
    if (pending) continue;
    fs.writeFileSync(path.join(dir, d.path), d.content);
    baseline[d.path] = d.content;
  }
  writeBaseline(dir, baseline);
  // impeccable은 PRODUCT.md·DESIGN.md를 디자인 기준으로 읽는다.
  fs.writeFileSync(path.join(dir, 'PRODUCT.md'), docs.find((d) => d.path === '0-PRODUCT.md')?.content || `# ${project.name}\n\n${project.idea}\n`);
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), project.designMd?.trim() ? project.designMd : '# 디자인 문서 없음\n');
  fs.writeFileSync(
    path.join(dir, '.impeccable', 'live', 'config.json'),
    JSON.stringify({ files: ['screens/*.html'], insertBefore: '</body>', commentSyntax: 'html', cspChecked: true }, null, 2),
  );
  return dir;
}

export function changedScreens(projectId: number): string[] {
  const dir = liveDir(projectId);
  const baseline = readBaseline(dir);
  return Object.keys(baseline).filter((p) => {
    const file = readScreen(dir, p);
    return file !== null && !same(strip(file), baseline[p]);
  }).sort();
}

export function liveStatus(projectId: number): LiveStatus {
  const s = activeLive();
  const mine = s?.projectId === projectId ? s : null;
  return {
    active: mine !== null,
    otherProject: s && !mine ? s.projectId : null,
    agent: mine?.agent ?? null,
    agentRunning: mine?.agentRunning ?? false,
    error: mine?.error ?? null,
    startedAt: mine?.startedAt ?? null,
    changed: fs.existsSync(liveDir(projectId)) ? changedScreens(projectId) : [],
  };
}

// 바뀐 화면을 프로젝트에 저장한다. 직전 본문은 되돌리기로 남긴다.
export function importLive(projectId: number): { saved: string[]; skipped: { path: string; reason: string }[] } {
  const dir = liveDir(projectId);
  const baseline = readBaseline(dir);
  const saved: string[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const p of changedScreens(projectId)) {
    const html = strip(readScreen(dir, p) ?? '').trim() + '\n';
    const cur = getDocument(projectId, p);
    if (!cur) skipped.push({ path: p, reason: '프로젝트에 없는 화면입니다' });
    else if (LEFTOVER.test(html)) skipped.push({ path: p, reason: '변형을 고르는 중입니다. 브라우저에서 Accept나 Discard를 마친 뒤 가져오세요' });
    else if (/<script/i.test(html)) skipped.push({ path: p, reason: '스크립트가 들어 있어 가져오지 않았습니다' });
    else if (!same(cur.content, baseline[p])) skipped.push({ path: p, reason: '내보낸 뒤 앱에서 화면이 바뀌었습니다 (덮어쓰지 않음)' });
    else if (cur.status === 'approved') skipped.push({ path: p, reason: '승인된 화면입니다. 승인을 취소한 뒤 가져오세요' });
    else {
      tx(() => {
        updateDocument(projectId, p, { content: html, previousContent: cur.content, upstreamChanged: false });
        flagUpstream(projectId, laterWithContent(p, listDocuments(projectId)));
      });
      baseline[p] = html;
      saved.push(p);
    }
  }
  writeBaseline(dir, baseline);
  log('info', 'live_import', { projectId, saved, skipped: skipped.map((x) => x.path) });
  return { saved, skipped };
}

function runImpeccable(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('sh', [path.join(skillDir(), 'scripts', 'impeccable'), ...args], { cwd: dir, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new AgentError('agent_failed', `impeccable 실행에 실패했습니다: ${(stderr || err.message).slice(-300)}`));
      else resolve(stdout);
    });
  });
}

// 컨테이너 안의 보조 서버는 127.0.0.1에만 열린다. 호스트 브라우저가 닿도록 바깥 포트에서 이어 준다.
function ensureForward(target: number) {
  const port = Number(process.env.LIVE_PUBLIC_PORT || 0);
  if (!port || g.__sddLiveForward) return;
  const server = net.createServer((client) => {
    const upstream = net.connect(target, '127.0.0.1');
    client.pipe(upstream).pipe(client);
    const close = () => { client.destroy(); upstream.destroy(); };
    client.on('error', close);
    upstream.on('error', close);
  });
  server.on('error', () => { g.__sddLiveForward = undefined; });
  server.listen(port, '0.0.0.0');
  g.__sddLiveForward = server;
}

export function livePrompt(): string {
  const skill = skillDir();
  return [
    `You are running impeccable live mode in the current folder (a static multi-page HTML project). The impeccable skill lives at ${skill}.`,
    `First read ${skill}/SKILL.md and ${skill}/reference/live.md, then follow live.md exactly, replacing <skill-base-dir> with ${skill}.`,
    `Live is already booted: \`impeccable live\` ran, the helper is up, and screens/*.html already load live.js. Start directly at the poll loop: run "${skill}/scripts/impeccable" live-poll in the foreground (no background task, no --timeout).`,
    'Handle every event per its _instructions, then poll again immediately. Never end your turn while live mode is open, and never announce that you are waiting.',
    'The screens are screens/<name>.html; links like login.html go to screens/login.html. Keep each screen one self-contained HTML file: no <script>, no external assets, no on* attributes. Edit nothing outside this folder.',
    'Stop only after an "exit" event, after running the cleanup in live.md.',
  ].join('\n');
}

function agentArgs(agent: AgentName): string[] {
  const { model, effort } = currentAgentOptions();
  if (agent === 'claude') {
    const tools = 'Bash,Read,Edit,Write,Glob,Grep';
    return [
      ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
      '-p', '--output-format', 'stream-json', '--verbose',
      '--tools', tools, '--allowedTools', tools, '--setting-sources', '', '--strict-mcp-config',
    ];
  }
  // live-poll이 127.0.0.1의 보조 서버와 통신하고 파일을 고쳐야 해서 샌드박스를 끈다 (컨테이너 안에서만 돈다).
  return [
    'exec', '--json', ...(model ? ['-m', model] : []), ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
    '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--ignore-user-config', '-',
  ];
}

export async function startLive(projectId: number, agent: AgentName): Promise<LiveStatus> {
  const cur = activeLive();
  if (cur && cur.projectId !== projectId) throw new AgentError('agent_failed', '다른 프로젝트에서 live 세션이 열려 있습니다');
  if (cur?.agentRunning) return liveStatus(projectId);
  if (!fs.existsSync(path.join(skillDir(), 'scripts', 'impeccable'))) throw new AgentError('agent_failed', 'impeccable이 설치되어 있지 않습니다');

  const dir = prepareWorkspace(projectId);
  // live.js는 http://localhost:<보조 서버 포트>를 직접 부른다. 브라우저가 닿는 호스트 포트와 같게 먼저 띄운다 (이미 떠 있으면 실패해도 된다, live가 재사용한다).
  await runImpeccable(dir, ['live-server', '--background', `--port=${livePort()}`]).catch(() => {});
  const boot = JSON.parse(await runImpeccable(dir, ['live'])) as { ok?: boolean; serverPort?: number; error?: string };
  if (!boot.ok || !boot.serverPort) throw new AgentError('agent_failed', `live를 시작하지 못했습니다: ${boot.error ?? '알 수 없는 오류'}`);
  ensureForward(boot.serverPort);

  const session: Session = { projectId, agent, dir, startedAt: new Date().toISOString(), abort: new AbortController(), agentRunning: true, error: null };
  g.__sddLive = session;
  log('info', 'live_start', { projectId, agent, port: boot.serverPort, ...currentAgentOptions() });
  const envOverride = agent === 'claude' ? { BASH_DEFAULT_TIMEOUT_MS: '660000', BASH_MAX_TIMEOUT_MS: '660000' } : undefined;
  spawnCli(agent, agentArgs(agent), { stdin: livePrompt(), cwd: dir, envOverride, signal: session.abort.signal, timeoutMs: AGENT_TIMEOUT_MS })
    .then((r) => { if (r.code !== 0 && session.error === null) session.error = r.stderr.slice(-300) || `에이전트가 코드 ${r.code}로 끝났습니다`; })
    .catch((e: unknown) => { if (!session.abort.signal.aborted) session.error = e instanceof Error ? e.message : String(e); })
    .finally(() => {
      session.agentRunning = false;
      log(session.error ? 'warn' : 'info', 'live_agent_exit', { projectId, agent, aborted: session.abort.signal.aborted, ...(session.error ? { error: session.error.slice(0, 200) } : {}) });
    });
  return liveStatus(projectId);
}

// 에이전트를 멈추고 보조 서버를 끈다 (주입한 스크립트도 지운다). 작업 폴더와 가져오지 않은 변경은 남긴다.
export async function stopLive(projectId: number): Promise<void> {
  const s = activeLive();
  if (!s || s.projectId !== projectId) return;
  s.abort.abort();
  g.__sddLive = null;
  log('info', 'live_stop', { projectId });
  await runImpeccable(s.dir, ['live-server', 'stop']).catch(() => {});
}
