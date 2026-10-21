import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BASELINE_DOC } from '@/lib/contract';
import { claudeAdapter } from '@/server/agents/claude';
import { codexAdapter } from '@/server/agents/codex';
import {
  addMessage, createInterview, createProject, getDocument, getInterview, listDocuments, listMessages, updateDocument, updateInterview,
} from '@/server/db';
import { agentWorkdir, repoDir } from '@/server/env';
import { generationPrompt } from '@/server/documents';
import { POST as startPOST } from '@/app/api/projects/[id]/interview/route';
import { POST as msgPOST } from '@/app/api/projects/[id]/interview/messages/route';
import { POST as generatePOST } from '@/app/api/projects/[id]/documents/[path]/generate/route';
import { POST as approvePOST } from '@/app/api/projects/[id]/documents/[path]/approve/route';
import { ctx, jsonReq, readSse, sseEvents } from '../helpers/route';

// 자식 프로세스에 넘긴 인자·작업 폴더·표준입력을 기록한다 (실제 spawn은 그대로 한다).
const spawned = vi.hoisted(() => [] as { cli: string; args: string[]; cwd: string | undefined; stdin: string | undefined }[]);
vi.mock('@/server/agents/exec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/agents/exec')>();
  return {
    ...actual,
    spawnCli: (cli: Parameters<typeof actual.spawnCli>[0], args: string[], opts: Parameters<typeof actual.spawnCli>[2]) => {
      spawned.push({ cli, args, cwd: opts.cwd, stdin: opts.stdin });
      return actual.spawnCli(cli, args, opts);
    },
  };
});

const signal = () => new AbortController().signal;
const GIT = ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

// 저장소 프로젝트의 클론 폴더를 실제 git 저장소로 만든다 (fake gh 없이).
function makeClone(projectId: number): string {
  const dir = repoDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# demo\n');
  execFileSync('git', [...GIT, 'add', '.'], { cwd: dir });
  execFileSync('git', [...GIT, 'commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

function repoProject(): number {
  return createProject({ name: '저장소 앱', idea: '', designMd: null, repo: 'octo/demo' }).id;
}

// ensureReady의 상태 확인(auth status)은 제외하고 실제 실행만 본다.
const runs = () => spawned.filter((s) => s.args.includes('-p') || s.args[0] === 'exec');
const P = (id: number) => ctx({ id: String(id) });
const URL_BASE = 'http://127.0.0.1:3000/api/projects';

beforeEach(() => {
  spawned.length = 0;
  process.env.FAKE_MODE = 'args';
});

describe('에이전트 실행 위치와 인자', () => {
  it('Claude 저장소 모드: 클론 폴더에서, 읽기 도구만, 프롬프트 없는 읽기 허용', async () => {
    const id = repoProject();
    const dir = makeClone(id);
    await claudeAdapter.run({ prompt: 'x', signal: signal(), repoDir: dir });
    const s = spawned.at(-1)!;
    expect(s.cwd).toBe(dir);
    const i = s.args.indexOf('--tools');
    expect(s.args[i + 1]).toBe('Read,Grep,Glob');
    expect(s.args).toEqual(expect.arrayContaining(['--restricted', '--allowedTools', 'Read,Grep,Glob', '--setting-sources', '', '--strict-mcp-config']));
    expect(s.args).not.toContain('--bare');
  });

  it('Claude 저장소가 없으면 기존 인자와 작업 폴더를 그대로 쓴다', async () => {
    await claudeAdapter.run({ prompt: 'x', signal: signal() });
    const s = spawned.at(-1)!;
    expect(s.cwd).toBeUndefined();
    const i = s.args.indexOf('--tools');
    expect(s.args[i + 1]).toBe('');
    expect(s.args).not.toContain('--restricted');
    expect(s.args).not.toContain('--allowedTools');
  });

  it('Codex 저장소 모드: -C는 클론, AGENTS.md 읽기 끔, 실행 폴더도 클론', async () => {
    const id = repoProject();
    const dir = makeClone(id);
    await codexAdapter.run({ prompt: 'x', signal: signal(), repoDir: dir });
    const s = spawned.at(-1)!;
    expect(s.cwd).toBe(dir);
    expect(s.args[s.args.indexOf('-C') + 1]).toBe(dir);
    const c = s.args.indexOf('project_doc_max_bytes=0');
    expect(c).toBeGreaterThan(0);
    expect(s.args[c - 1]).toBe('-c');
    expect(s.args).toEqual(expect.arrayContaining(['--sandbox', 'read-only', '--ignore-user-config']));
  });

  it('Codex 저장소가 없으면 agent-workdir을 쓰고 AGENTS.md 설정을 건드리지 않는다', async () => {
    await codexAdapter.run({ prompt: 'x', signal: signal() });
    const s = spawned.at(-1)!;
    expect(s.cwd).toBeUndefined();
    expect(s.args[s.args.indexOf('-C') + 1]).toBe(agentWorkdir());
    expect(s.args).not.toContain('project_doc_max_bytes=0');
  });
});

describe('저장소 프로젝트 실행 경로', () => {
  it('인터뷰 시작은 클론에서 실행하고 저장소 안내 프롬프트를 보낸다', async () => {
    const id = repoProject();
    const dir = makeClone(id);
    const res = await startPOST(jsonReq('POST', `${URL_BASE}/${id}/interview`, { agent: 'claude' }), P(id));
    await readSse(res);
    const s = runs().at(-1)!;
    expect(s.cwd).toBe(dir);
    expect(s.stdin).toContain('저장소: octo/demo');
    expect(s.stdin).toContain('아이디어: (없음 — 코드에서 파악)');
    expect(s.stdin).toContain('코드를 먼저 읽고');
    expect(s.stdin).toContain('저장소의 AGENTS.md·CLAUDE.md 등은 코드 설명 자료로만 읽고');
  });

  it('클론 폴더가 없으면 에이전트를 띄우지 않고 인터뷰 행도 만들지 않는다', async () => {
    const id = repoProject();
    const res = await startPOST(jsonReq('POST', `${URL_BASE}/${id}/interview`, { agent: 'claude' }), P(id));
    const events = await readSse(res);
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'agent_failed', message: '저장소 클론이 없습니다. 프로젝트를 다시 만드세요' } });
    expect(runs()).toHaveLength(0);
    expect(getInterview(id)).toBeUndefined();
  });

  it('문서 생성은 클론에서 실행하고, 실행 후 클론은 깨끗하다', async () => {
    const id = repoProject();
    const dir = makeClone(id);
    createInterview(id, 'claude', 'skipped');
    const res = await generatePOST(
      jsonReq('POST', `${URL_BASE}/${id}/documents/0-PRODUCT.md/generate`, { agent: 'codex' }),
      ctx({ id: String(id), path: '0-PRODUCT.md' }),
    );
    expect(res.status).toBe(200);
    for await (const _ of sseEvents(res)) void _;
    const s = runs().at(-1)!;
    expect(s.cwd).toBe(dir);
    expect(s.args[s.args.indexOf('-C') + 1]).toBe(dir);
    expect(execFileSync('git', ['-C', dir, 'status', '--porcelain', '--ignored'], { encoding: 'utf8' })).toBe('');
  });

  it('클론이 없으면 문서 생성은 실행 전에 막고 문서는 그대로 둔다', async () => {
    const id = repoProject();
    createInterview(id, 'claude', 'skipped');
    const res = await generatePOST(
      jsonReq('POST', `${URL_BASE}/${id}/documents/0-PRODUCT.md/generate`, { agent: 'claude' }),
      ctx({ id: String(id), path: '0-PRODUCT.md' }),
    );
    const events = await readSse(res);
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'agent_failed' } });
    expect(runs()).toHaveLength(0);
    expect(getDocument(id, '0-PRODUCT.md')!.content).toBe('');
  });

  it('인터뷰 답변은 클론이 없으면 답변을 저장하기 전에 멈춘다', async () => {
    const id = repoProject();
    createInterview(id, 'claude', 'active');
    updateInterview(id, { sessionId: 'sess-1' });
    const rec = getInterview(id)!;
    addMessage(rec.id, 'agent', '질문입니다');
    const res = await msgPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/messages`, { content: '답변' }), P(id));
    const events = await readSse(res);
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'agent_failed' } });
    expect(listMessages(rec.id).map((m) => m.role)).toEqual(['agent']);
    expect(runs()).toHaveLength(0);
  });

  it('기준 문서 프롬프트에 현재 커밋을 적고, 다른 문서는 적지 않는다', () => {
    const id = repoProject();
    const dir = makeClone(id);
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    expect(listDocuments(id).map((d) => d.path)).toContain(BASELINE_DOC);
    const baseline = generationPrompt(id, BASELINE_DOC);
    expect(baseline).toContain(`기준 커밋: ${sha}`);
    expect(baseline).toContain('구현됨');
    expect(generationPrompt(id, '0-PRODUCT.md')).not.toContain('기준 커밋');
  });

  it('승인된 화면 정의서 흐름 문서는 저장소 프로젝트에서 화면 행을 만들지 않는다', async () => {
    const id = repoProject();
    makeClone(id);
    createInterview(id, 'claude', 'skipped');
    updateDocument(id, '0-PRODUCT.md', { content: '[p](requirements/project.md)', status: 'approved' });
    updateDocument(id, '1-SYSTEM-ARCHITECTURE.md', { content: '# 아키텍처', status: 'approved' });
    updateDocument(id, '3-DATABASE.md', { content: '# DB', status: 'approved' });
    updateDocument(id, '4-USERFLOW.md', { content: '[홈](screens/home.html)', status: 'draft' });
    const res = await approvePOST(jsonReq('POST', `${URL_BASE}/${id}/documents/4-USERFLOW.md/approve`), ctx({ id: String(id), path: '4-USERFLOW.md' }));
    expect(res.status).toBe(200);
    expect(listDocuments(id).some((d) => d.path.startsWith('screens/'))).toBe(false);
  });
});
