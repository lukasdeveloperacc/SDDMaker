import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET as listGET, POST as createPOST } from '@/app/api/projects/route';
import { GET as detailGET, DELETE as deleteProjectRoute } from '@/app/api/projects/[id]/route';
import { PUT as designPUT } from '@/app/api/projects/[id]/design/route';
import { POST as generatePOST } from '@/app/api/projects/[id]/documents/[path]/generate/route';
import {
  createInterview,
  createProject,
  getInterview,
  getProject,
  insertEmptyDocuments,
  listDocuments,
  listMessages,
} from '@/server/db';
import { acquireRun, getRun } from '@/server/runtime';
import { dataDir } from '@/server/env';
import { ctx, jsonReq } from '../helpers/route';

const URL_BASE = 'http://127.0.0.1:3000';

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

describe('POST·GET /api/projects', () => {
  it('만들면 201, 목록에 보이고 문서 5개가 empty이며 이름·아이디어는 앞뒤 공백을 뗀다', async () => {
    const res = await createPOST(jsonReq('POST', `${URL_BASE}/api/projects`, { name: ' 행사 ', idea: ' 아이디어 ' }));
    expect(res.status).toBe(201);
    const { project } = await res.json();
    expect(project).toMatchObject({ name: '행사', idea: '아이디어', designMd: null });
    const list = await (await listGET()).json();
    expect(list.projects.find((p: { id: number }) => p.id === project.id)).toMatchObject({
      totalCount: 5,
      approvedCount: 0,
    });
  });

  it('빈 이름이나 공백만 있는 아이디어는 400', async () => {
    for (const body of [{ name: '  ', idea: 'x' }, { name: 'a', idea: '   ' }]) {
      const res = await createPOST(jsonReq('POST', `${URL_BASE}/api/projects`, body));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('invalid_input');
    }
  });

  it('디자인 문서는 글자 그대로 저장되고, 공백만 있으면 null', async () => {
    const raw = '  # D\n\n';
    const a = await (await createPOST(jsonReq('POST', `${URL_BASE}/api/projects`, { name: 'a', idea: 'b', designMd: raw }))).json();
    expect(a.project.designMd).toBe(raw);
    const b = await (await createPOST(jsonReq('POST', `${URL_BASE}/api/projects`, { name: 'a', idea: 'b', designMd: '   ' }))).json();
    expect(b.project.designMd).toBeNull();
  });
});

describe('GET·DELETE /api/projects/:id', () => {
  it('없는 id는 404 (0, 문자, 없는 번호)', async () => {
    for (const id of ['0', 'abc', '999999']) {
      const res = await detailGET(jsonReq('GET', `${URL_BASE}/api/projects/${id}`), ctx({ id }));
      expect(res.status).toBe(404);
    }
  });

  it('상세는 인터뷰·문서·실행 상태를 준다', async () => {
    const p = createProject({ name: 'a', idea: 'b', designMd: null });
    const body = await (await detailGET(jsonReq('GET', `${URL_BASE}/api/projects/${p.id}`), ctx({ id: String(p.id) }))).json();
    expect(body.project.id).toBe(p.id);
    expect(body.documents).toHaveLength(5);
    expect(body.interview).toBeNull();
    expect(body.running).toBeNull();
  });

  it('지우면 204이고 인터뷰·문서 행이 없어진다', async () => {
    const p = createProject({ name: 'a', idea: 'b', designMd: null });
    createInterview(p.id, 'claude', 'active');
    const res = await deleteProjectRoute(jsonReq('DELETE', `${URL_BASE}/api/projects/${p.id}`), ctx({ id: String(p.id) }));
    expect(res.status).toBe(204);
    expect(getProject(p.id)).toBeUndefined();
    expect(getInterview(p.id)).toBeUndefined();
    expect(listDocuments(p.id)).toEqual([]);
  });

  it('실행 중이면 먼저 끝내고 지운다 (자식 프로세스 pid 없음, 행 0)', async () => {
    process.env.FAKE_MODE = 'slow';
    const pidFile = path.join(dataDir(), 'slow.pid');
    process.env.FAKE_PID_FILE = pidFile;
    const p = createProject({ name: 'a', idea: 'b', designMd: null });
    const iv = createInterview(p.id, null, 'skipped');
    void generatePOST(
      jsonReq('POST', `${URL_BASE}/api/projects/${p.id}/documents/0-PRODUCT.md/generate`, { agent: 'codex' }),
      ctx({ id: String(p.id), path: '0-PRODUCT.md' }),
    );
    await waitUntil(() => fs.existsSync(pidFile) && getRun(p.id) !== null);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));

    const res = await deleteProjectRoute(jsonReq('DELETE', `${URL_BASE}/api/projects/${p.id}`), ctx({ id: String(p.id) }));
    expect(res.status).toBe(204);
    expect(alive(pid)).toBe(false);
    expect(getProject(p.id)).toBeUndefined();
    expect(listMessages(iv.id)).toEqual([]);
    expect(getRun(p.id)).toBeNull();
  });

  it('실행 잠금이 풀리지 않으면 409 busy이고 행이 남는다', async () => {
    const p = createProject({ name: 'a', idea: 'b', designMd: null });
    const stuck = acquireRun(p.id, 'interview', null);
    try {
      const res = await deleteProjectRoute(jsonReq('DELETE', `${URL_BASE}/api/projects/${p.id}`), ctx({ id: String(p.id) }));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('busy');
      expect(getProject(p.id)).toBeDefined();
    } finally {
      stuck?.release();
    }
  });
});

describe('PUT /api/projects/:id/design', () => {
  it('글자 그대로 저장하고, 공백만이면 비운다', async () => {
    const p = createProject({ name: 'a', idea: 'b', designMd: null });
    const put = (designMd: string) =>
      designPUT(jsonReq('PUT', `${URL_BASE}/api/projects/${p.id}/design`, { designMd }), ctx({ id: String(p.id) }));
    expect((await (await put('  # D\n\n')).json()).project.designMd).toBe('  # D\n\n');
    expect((await (await put('   ')).json()).project.designMd).toBeNull();
  });

  it('화면 정의서가 있으면 비울 수 없고 409, 바꾸는 것은 200', async () => {
    const p = createProject({ name: 'a', idea: 'b', designMd: '# D' });
    insertEmptyDocuments(p.id, ['screens/home.html']);
    const put = (designMd: string) =>
      designPUT(jsonReq('PUT', `${URL_BASE}/api/projects/${p.id}/design`, { designMd }), ctx({ id: String(p.id) }));
    const blocked = await put('');
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe('design_required');
    expect((await put('# 새 디자인')).status).toBe(200);
  });

  it('없는 프로젝트는 404', async () => {
    const res = await designPUT(jsonReq('PUT', `${URL_BASE}/api/projects/999999/design`, { designMd: 'x' }), ctx({ id: '999999' }));
    expect(res.status).toBe(404);
  });
});
