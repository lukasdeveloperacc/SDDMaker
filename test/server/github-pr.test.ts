import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/projects/[id]/pr/route';
import { POST as createProjectPOST } from '@/app/api/projects/route';
import { exportFiles } from '@/server/export';
import { listDocuments, updateDocument } from '@/server/db';
import { dataDir, prWorktreesDir, repoDir } from '@/server/env';
import { readDocRules } from '@/server/prompts';
import { acquireRun, getRun } from '@/server/runtime';
import { seedRemote, type SeededRemote } from '../helpers/github';
import { ctx, jsonReq } from '../helpers/route';

const URL_BASE = 'http://127.0.0.1:3000';
const cleanups: Array<() => void> = [];
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (args: string[]) => execFileSync('git', args, { env: GIT_ENV, encoding: 'utf8' });

beforeEach(() => {
  // 가짜 gh가 매 호출을 남기는 파일 (테스트마다 새 파일)
  process.env.FAKE_GH_LOG = path.join(dataDir(), `gh-${Math.random().toString(36).slice(2)}.jsonl`);
});

afterEach(() => {
  vi.useRealTimers();
  cleanups.splice(0).forEach((f) => f());
});

// 저장소 프로젝트 하나를 만들고 모든 문서를 승인해 둔다. 가짜 gh가 복제할 원격은 seedRemote로 만든다.
async function repoProject(opts?: Parameters<typeof seedRemote>[0]): Promise<{ id: number; remote: SeededRemote }> {
  const remote = seedRemote(opts);
  cleanups.push(remote.cleanup);
  process.env.FAKE_GH_REMOTE = remote.remote;
  const res = await createProjectPOST(jsonReq('POST', `${URL_BASE}/api/projects`, { repo: 'octo/app', name: '', idea: '' }));
  expect(res.status).toBe(201);
  const { project } = (await res.json()) as { project: { id: number } };
  for (const d of listDocuments(project.id)) {
    updateDocument(project.id, d.path, { content: `# ${d.path}\n`, status: 'approved' });
  }
  return { id: project.id, remote };
}

const call = (method: 'GET' | 'POST', id: number, signal?: AbortSignal) =>
  (method === 'GET' ? GET : POST)(jsonReq(method, `${URL_BASE}/api/projects/${id}/pr`, undefined, signal), ctx({ id: String(id) }));

const branches = (remote: string) =>
  git(['-C', remote, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']).trim().split('\n');
const prBranches = (remote: string) => branches(remote).filter((b) => b.startsWith('sddmaker/docs-'));
const treeOf = (remote: string, branch: string) => git(['-C', remote, 'ls-tree', '-r', '--name-only', branch]).trim().split('\n');

// 실패·취소 뒤에도 클론은 깨끗하고, 임시 작업 트리와 잠금은 남지 않아야 한다.
function expectClean(id: number) {
  expect(git(['-C', repoDir(id), 'status', '--porcelain', '--ignored']).trim()).toBe('');
  expect(git(['-C', repoDir(id), 'worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).length).toBe(1);
  expect(fs.readdirSync(prWorktreesDir())).toEqual([]);
  expect(getRun(id)).toBeNull();
}

// 가짜 gh의 pr create 호출이 시작될 때까지 기다린다 (FAKE_GH_LOG 기록으로 확인).
async function waitForPrCreate() {
  const log = process.env.FAKE_GH_LOG!;
  for (let i = 0; i < 500; i++) {
    if (fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('"pr","create"')) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('pr create did not start');
}

describe('GET /api/projects/:id/pr', () => {
  it('저장소·기본 브랜치·push 가능 여부와 덮어쓸 파일을 알려준다 (기본 시드는 0-PRODUCT.md만 겹친다)', async () => {
    const { id } = await repoProject();
    const res = await call('GET', id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repo: string; defaultBranch: string; canPush: boolean; files: string[]; overwrites: string[] };
    expect(body).toMatchObject({ repo: 'octo/app', defaultBranch: 'main', canPush: true });
    expect(body.files).toContain('docs/AGENTS.md');
    expect(body.files).toContain('docs/0-PRODUCT.md');
    expect(body.overwrites).toEqual(['docs/0-PRODUCT.md']);
  });

  it('권한이 읽기뿐이면 canPush:false로 200을 준다', async () => {
    const { id } = await repoProject();
    process.env.FAKE_GH_PERMISSION = 'READ';
    const res = await call('GET', id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { canPush: boolean }).canPush).toBe(false);
  });

  it('저장소가 연결되지 않은 프로젝트는 404 not_found', async () => {
    const created = await createProjectPOST(jsonReq('POST', `${URL_BASE}/api/projects`, { name: 'x', idea: 'y' }));
    const { project } = (await created.json()) as { project: { id: number } };
    const res = await call('GET', project.id);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('not_found');
  });

  it('승인되지 않은 문서가 있으면 409 export_blocked', async () => {
    const { id } = await repoProject();
    updateDocument(id, '0-PRODUCT.md', { content: '# 초안', status: 'draft' });
    const res = await call('GET', id);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; items: string[] };
    expect(body.code).toBe('export_blocked');
    expect(body.items).toContain('0-PRODUCT.md');
  });

  it('빈 저장소(기본 브랜치 없음)는 409 pr_failed', async () => {
    const { id } = await repoProject();
    // 가짜 gh의 repo view 응답만 바꾼 래퍼: defaultBranchRef가 null
    const wrapper = path.join(dataDir(), 'empty-repo-gh.mjs');
    fs.writeFileSync(wrapper, [
      '#!/usr/bin/env node',
      "import { spawnSync } from 'node:child_process';",
      "if (process.argv[2] === 'repo' && process.argv[3] === 'view') {",
      "  process.stdout.write(JSON.stringify({ nameWithOwner: process.argv[4], defaultBranchRef: null, viewerPermission: 'WRITE' }) + '\\n');",
      '  process.exit(0);',
      '}',
      `const r = spawnSync(${JSON.stringify(process.env.GH_CLI)}, process.argv.slice(2), { stdio: 'inherit' });`,
      'process.exit(r.status ?? 1);',
      '',
    ].join('\n'));
    fs.chmodSync(wrapper, 0o755);
    process.env.GH_CLI = wrapper;
    const res = await call('GET', id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'pr_failed', message: '빈 저장소에는 PR을 올릴 수 없습니다' });
  });
});

describe('POST /api/projects/:id/pr', () => {
  it('브랜치를 올리고 PR 주소를 준다. 기존 파일은 남고, 내보낸 파일 내용은 exportFiles 결과와 같다', async () => {
    vi.setSystemTime(new Date('2026-10-21T03:00:00Z'));
    const { id, remote } = await repoProject();
    const res = await call('POST', id);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ url: 'https://github.com/octo/app/pull/1' });

    expect(prBranches(remote.remote)).toEqual(['sddmaker/docs-20261021-0300']);
    const branch = 'sddmaker/docs-20261021-0300';
    const tree = treeOf(remote.remote, branch);
    expect(tree).toContain('README.md');
    expect(tree).toContain('docs/keep.md');

    const expected = exportFiles({
      designMd: null,
      docs: listDocuments(id).map((d) => ({ path: d.path, content: d.content })),
      rules: readDocRules(),
    });
    for (const f of expected) {
      expect(tree).toContain(f.path);
      expect(git(['-C', remote.remote, 'show', `${branch}:${f.path}`])).toBe(f.content);
    }

    expect(git(['-C', remote.remote, 'log', '-1', '--format=%an <%ae>%n%s', branch]).trim()).toBe(
      'octo <1+octo@users.noreply.github.com>\ndocs: SDD 문서 추가 (SDDMaker)',
    );
    expectClean(id);
  });

  it('1분 뒤 다시 올리면 다른 브랜치가 된다', async () => {
    vi.setSystemTime(new Date('2026-10-21T03:00:00Z'));
    const { id, remote } = await repoProject();
    expect((await call('POST', id)).status).toBe(201);
    vi.setSystemTime(new Date('2026-10-21T03:01:00Z'));
    expect((await call('POST', id)).status).toBe(201);
    expect(prBranches(remote.remote)).toEqual(['sddmaker/docs-20261021-0300', 'sddmaker/docs-20261021-0301']);
  });

  it('밀어 넣기 전에 남은 임시 작업 트리를 치운다', async () => {
    const { id } = await repoProject();
    const stale = path.join(prWorktreesDir(), `${id}-20000101-0000`);
    fs.mkdirSync(stale);
    expect((await call('POST', id)).status).toBe(201);
    expect(fs.existsSync(stale)).toBe(false);
    expectClean(id);
  });

  it('읽기 권한뿐이면 409 no_push_permission이고 아무것도 올리지 않는다', async () => {
    const { id, remote } = await repoProject();
    process.env.FAKE_GH_PERMISSION = 'READ';
    const res = await call('POST', id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('no_push_permission');
    expect(prBranches(remote.remote)).toEqual([]);
    expectClean(id);
  });

  it('PR 생성이 실패하면 502 pr_failed이고, 올라간 브랜치는 원격에 남는다', async () => {
    const { id, remote } = await repoProject();
    process.env.FAKE_GH_PR = 'fail';
    const res = await call('POST', id);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe('pr_failed');
    expect(prBranches(remote.remote).length).toBe(1);
    expectClean(id);
  });

  it('PR 생성 중 취소하면 작업 트리와 잠금이 정리된다', async () => {
    const { id, remote } = await repoProject();
    process.env.FAKE_GH_PR = 'hang';
    const ac = new AbortController();
    const pending = call('POST', id, ac.signal);
    try {
      await waitForPrCreate();
    } finally {
      ac.abort();
    }
    const res = await pending;
    expect(res.status).toBe(502);
    expect(prBranches(remote.remote).length).toBe(1);
    expectClean(id);
  });

  it('문서에 토큰 모양의 값이 있으면 502 pr_failed이고 아무것도 올리지 않는다', async () => {
    const { id, remote } = await repoProject();
    updateDocument(id, '0-PRODUCT.md', { content: `# 제품\n\nghp_${'a'.repeat(36)}\n`, status: 'approved' });
    const res = await call('POST', id);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('pr_failed');
    expect(body.message).toContain('토큰으로 보이는 값');
    expect(prBranches(remote.remote)).toEqual([]);
    expectClean(id);
  });

  it('docs가 심볼릭 링크인 저장소는 바깥에 아무것도 쓰지 않고 pr_failed', async () => {
    const { id, remote } = await repoProject({ symlinkDocs: true });
    const before = fs.readdirSync(remote.outside);
    const get = await call('GET', id);
    expect(((await get.json()) as { overwrites: string[] }).overwrites).toEqual([]);
    const res = await call('POST', id);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'pr_failed', message: '저장소의 docs 경로가 폴더가 아니어서 PR을 올릴 수 없습니다' });
    expect(fs.readdirSync(remote.outside)).toEqual(before);
    expect(prBranches(remote.remote)).toEqual([]);
    expectClean(id);
  });

  it('같은 분에 한 번 더 올리면 502 pr_failed (같은 이름의 브랜치 안내)이고 브랜치를 더 만들지 않는다', async () => {
    vi.setSystemTime(new Date('2026-10-21T03:00:00Z'));
    const { id, remote } = await repoProject();
    expect((await call('POST', id)).status).toBe(201);
    const res = await call('POST', id);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'pr_failed', message: '같은 이름의 브랜치가 있습니다. 1분 뒤 다시 시도하세요' });
    expect(prBranches(remote.remote)).toEqual(['sddmaker/docs-20261021-0300']);
    expectClean(id);
  });

  it('원격이 push를 거절하면(권한·보호 브랜치 등) 같은 이름 안내 없이 일반 pr_failed', async () => {
    const { id, remote } = await repoProject();
    const hook = path.join(remote.remote, 'hooks', 'pre-receive');
    fs.writeFileSync(hook, '#!/bin/sh\necho denied >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const res = await call('POST', id);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('pr_failed');
    expect(body.message).toBe('GitHub에 브랜치를 올리지 못했습니다');
    expect(prBranches(remote.remote)).toEqual([]);
    expectClean(id);
  });

  it('같은 프로젝트에 작업이 진행 중이면 409 busy', async () => {
    const { id } = await repoProject();
    const handle = acquireRun(id, 'interview', null)!;
    try {
      const res = await call('POST', id);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe('busy');
    } finally {
      handle.release();
    }
  });
});
