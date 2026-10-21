import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET as listGET, POST as createPOST } from '@/app/api/projects/route';
import { DELETE as deleteRoute } from '@/app/api/projects/[id]/route';
import { BASELINE_DOC } from '@/lib/contract';
import { getProject, listDocuments, listProjects } from '@/server/db';
import { dataDir, repoDir, reposDir } from '@/server/env';
import { seedRemote, type SeededRemote } from '../helpers/github';
import { ctx, jsonReq } from '../helpers/route';

const URL_BASE = 'http://127.0.0.1:3000';
const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
});

function remote(opts?: Parameters<typeof seedRemote>[0]): SeededRemote {
  const r = seedRemote(opts);
  cleanups.push(r.cleanup);
  process.env.FAKE_GH_REMOTE = r.remote;
  return r;
}

const create = (body: unknown, signal?: AbortSignal) =>
  createPOST(jsonReq('POST', `${URL_BASE}/api/projects`, body, signal));

const tmpEntries = () => fs.readdirSync(reposDir()).filter((e) => e.startsWith('.tmp-'));
const projectCount = () => listProjects().length;

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(cond: () => boolean, ms = 10000) {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('저장소로 프로젝트 만들기', () => {
  it('owner/repo 형식이면 저장소를 받아 repos/<id>에 두고 기준 변경 문서를 만든다', async () => {
    remote();
    const res = await create({ repo: 'octo/app', name: '', idea: '' });
    expect(res.status).toBe(201);
    const { project } = await res.json();
    expect(project.name).toBe('app');
    expect(project.repo).toBe('octo/app');
    expect(fs.readFileSync(path.join(repoDir(project.id), 'README.md'), 'utf8')).toBe('# app\n');
    expect(listDocuments(project.id).map((d) => d.path)).toContain(BASELINE_DOC);
  });

  it('GitHub URL과 .git 접미사도 받아들이고, 입력한 이름을 우선한다', async () => {
    remote();
    const res = await create({ repo: 'https://github.com/octo/app.git', name: '내 앱', idea: '아이디어' });
    expect(res.status).toBe(201);
    const { project } = await res.json();
    expect(project.name).toBe('내 앱');
    expect(project.repo).toBe('octo/app');
  });

  it('repo가 빈 문자열이면 저장소 없이 예전 규칙(이름·아이디어 필수)으로 만든다', async () => {
    const ok = await create({ repo: '  ', name: 'n', idea: 'i' });
    expect(ok.status).toBe(201);
    expect((await ok.json()).project.repo).toBeNull();
    const missing = await create({ repo: '', name: '', idea: 'i' });
    expect(missing.status).toBe(400);
  });

  it('repo가 글이 아니면 400이다', async () => {
    const res = await create({ repo: 123, name: 'n', idea: 'i' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_input');
  });

  it('주소 형식이 잘못되면 400이고 행과 폴더를 만들지 않는다', async () => {
    remote();
    const before = projectCount();
    const res = await create({ repo: 'a', name: '', idea: '' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_input');
    expect(projectCount()).toBe(before);
    expect(tmpEntries()).toEqual([]);
  });

  it('저장소가 없으면 404 repo_not_found이고 행을 남기지 않는다', async () => {
    remote();
    process.env.FAKE_GH_REPO = 'not_found';
    const before = projectCount();
    const res = await create({ repo: 'octo/none', name: '', idea: '' });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('repo_not_found');
    expect(projectCount()).toBe(before);
  });

  it('gh가 없으면 409 gh_not_found', async () => {
    process.env.GH_CLI = '/nonexistent/gh';
    const res = await create({ repo: 'octo/app', name: '', idea: '' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('gh_not_found');
  });

  it('GitHub에 연결되어 있지 않으면 409 github_not_connected', async () => {
    process.env.FAKE_AUTH = 'logged_out';
    const res = await create({ repo: 'octo/app', name: '', idea: '' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('github_not_connected');
  });

  it('복제가 실패하면 502 clone_failed이고 행과 임시 폴더를 남기지 않는다', async () => {
    remote();
    process.env.FAKE_GH_CLONE = 'fail';
    const before = projectCount();
    const res = await create({ repo: 'octo/app', name: '', idea: '' });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('clone_failed');
    expect(projectCount()).toBe(before);
    expect(tmpEntries()).toEqual([]);
  });

  it('복제 중 요청을 끊으면 자식 프로세스가 죽고 행과 임시 폴더가 없다', async () => {
    remote();
    const pidFile = path.join(dataDir(), 'pid-clone-hang');
    process.env.FAKE_GH_CLONE = 'hang';
    process.env.FAKE_PID_FILE = pidFile;
    const before = projectCount();
    const ac = new AbortController();
    const pending = create({ repo: 'octo/app', name: '', idea: '' }, ac.signal);
    await waitUntil(() => fs.existsSync(pidFile));
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    ac.abort();
    const res = await pending;
    expect(res.status).toBe(502);
    expect(alive(pid)).toBe(false);
    expect(projectCount()).toBe(before);
    expect(tmpEntries()).toEqual([]);
  });

  it('15분 넘게 남은 임시 폴더는 치우고, 최근 것은 그대로 둔다', async () => {
    remote();
    const stale = path.join(reposDir(), '.tmp-stale');
    const fresh = path.join(reposDir(), '.tmp-fresh');
    fs.mkdirSync(stale, { recursive: true });
    fs.mkdirSync(fresh, { recursive: true });
    const old = new Date(Date.now() - 20 * 60_000);
    fs.utimesSync(stale, old, old);
    try {
      const res = await create({ repo: 'octo/app', name: '', idea: '' });
      expect(res.status).toBe(201);
      expect(fs.existsSync(stale)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('임시 폴더 정리 중 한 항목이 오류를 내도 요청은 성공한다', async () => {
    remote();
    // 대상이 없는 심볼릭 링크: stat이 ENOENT로 실패하는 항목
    const dangling = path.join(reposDir(), '.tmp-dangling');
    fs.symlinkSync(path.join(reposDir(), 'no-such-target'), dangling);
    try {
      const res = await create({ repo: 'octo/app', name: '', idea: '' });
      expect(res.status).toBe(201);
    } finally {
      fs.rmSync(dangling, { force: true });
    }
  });

  it('저장소 없이 만드는 기존 경로는 그대로 동작한다', async () => {
    const res = await create({ name: 'plain', idea: 'idea', designMd: null });
    expect(res.status).toBe(201);
    const { project } = await res.json();
    expect(project.repo).toBeNull();
    expect(fs.existsSync(repoDir(project.id))).toBe(false);
    const list = await listGET();
    expect((await list.json()).projects.some((p: { id: number }) => p.id === project.id)).toBe(true);
  });
});

describe('저장소 프로젝트 삭제', () => {
  it('삭제하면 행과 저장소 복제 폴더가 함께 사라진다', async () => {
    remote();
    const { project } = await (await create({ repo: 'octo/app', name: '', idea: '' })).json();
    expect(fs.existsSync(repoDir(project.id))).toBe(true);
    const res = await deleteRoute(new Request(`${URL_BASE}/api/projects/${project.id}`, { method: 'DELETE' }), ctx({ id: String(project.id) }));
    expect(res.status).toBe(204);
    expect(getProject(project.id)).toBeUndefined();
    expect(fs.existsSync(repoDir(project.id))).toBe(false);
  });
});
