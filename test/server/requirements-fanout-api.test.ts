import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexAdapter } from '@/server/agents/codex';
import { AgentError } from '@/server/agents';
import { createInterview, createProject, getDocument, insertEmptyDocuments, updateDocument } from '@/server/db';
import { acquireRun, getRun } from '@/server/runtime';
import { POST } from '@/app/api/projects/[id]/requirements/generate/route';
import { POST as generatePOST } from '@/app/api/projects/[id]/documents/[path]/generate/route';
import { DELETE as cancelDELETE } from '@/app/api/projects/[id]/run/route';
import { ctx, jsonReq, readSse } from '../helpers/route';

afterEach(() => vi.restoreAllMocks());

const names = ['a', 'b', 'c', 'd', 'e'];

// USERFLOW까지 승인되어 요구사항 문서 5개가 비어 있는 프로젝트
function ready(repo: string | null = null) {
  const p = createProject({ name: 'p', idea: 'i', designMd: null, repo });
  createInterview(p.id, null, 'skipped');
  const links = names.map((n) => `[${n}](requirements/${n}.md)`).join('\n');
  for (const path of ['0-PRODUCT.md', '1-SYSTEM-ARCHITECTURE.md', '3-DATABASE.md', '4-USERFLOW.md']) {
    updateDocument(p.id, path, { content: path === '0-PRODUCT.md' ? links : '# 앞 문서', status: 'approved' });
  }
  insertEmptyDocuments(p.id, names.map((n) => `requirements/${n}.md`));
  return p;
}
const call = (id: number, body: Record<string, unknown> = { agent: 'codex' }, signal?: AbortSignal) =>
  POST(jsonReq('POST', `http://127.0.0.1:3000/api/projects/${id}/requirements/generate`, body, signal), ctx({ id: String(id) }));

async function waitUntil(cond: () => boolean, ms = 5000) {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// 어댑터를 가짜 구현으로 바꾸고 동시에 돈 최대 개수를 센다.
function fakeRuns(over: (prompt: string) => Promise<string> | string = (prompt) => `# ${prompt.split('\n')[0]}\n본문`) {
  const state = { active: 0, max: 0, prompts: [] as string[] };
  vi.spyOn(codexAdapter, 'run').mockImplementation(async (i) => {
    state.active++;
    state.max = Math.max(state.max, state.active);
    state.prompts.push(i.prompt);
    try {
      await new Promise((r) => setTimeout(r, 40));
      return { text: await over(i.prompt), sessionId: 's' };
    } finally {
      state.active--;
    }
  });
  return state;
}

describe('요구사항 한 번에 만들기', () => {
  it('비어 있는 요구사항을 모두 초안으로 저장하고, 동시에는 3개까지만 돈다', async () => {
    const p = ready();
    const state = fakeRuns();
    const events = await readSse(await call(p.id));
    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    expect(JSON.parse(done.data.text).done.sort()).toEqual(names.map((n) => `requirements/${n}.md`));
    expect(state.max).toBe(3);
    for (const n of names) expect(getDocument(p.id, `requirements/${n}.md`)).toMatchObject({ status: 'draft', agent: 'codex' });
    expect(state.prompts.every((q) => q.includes('대상 기능:'))).toBe(true);
    expect(getRun(p.id)).toBeNull();
  });

  it('일부가 실패해도 나머지는 저장하고 실패 목록을 준다', async () => {
    const p = ready();
    fakeRuns((prompt) => {
      if (prompt.includes('대상 기능: c')) throw new AgentError('agent_failed', '실패');
      return '# 본문';
    });
    const events = await readSse(await call(p.id));
    const out = JSON.parse(events.at(-1)!.data.text);
    expect(out.done).toHaveLength(4);
    expect(out.failed).toEqual([{ path: 'requirements/c.md', message: '실패' }]);
    expect(getDocument(p.id, 'requirements/c.md')).toMatchObject({ status: 'empty', content: '' });
  });

  it('하나도 못 만들면 error 이벤트다', async () => {
    const p = ready();
    fakeRuns(() => { throw new AgentError('not_logged_in', '로그인이 필요합니다'); });
    const events = await readSse(await call(p.id));
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'not_logged_in' } });
    expect(getRun(p.id)).toBeNull();
  });

  it('실행 중 직접 쓴 문서는 덮어쓰지 않는다', async () => {
    const p = ready();
    fakeRuns(() => {
      updateDocument(p.id, 'requirements/a.md', { content: '직접 씀', status: 'draft' });
      return '# 생성';
    });
    await readSse(await call(p.id));
    expect(getDocument(p.id, 'requirements/a.md')?.content).toBe('직접 씀');
  });

  it('실행 중에는 requirements 종류로 잠그고 진행(전체·완료·진행 중)을 알려 준다', async () => {
    const p = ready();
    fakeRuns();
    const res = await call(p.id);
    await waitUntil(() => (getRun(p.id)?.progress?.active.length ?? 0) > 0);
    const run = getRun(p.id)!;
    expect(run.kind).toBe('requirements');
    expect(run.progress).toMatchObject({ total: 5 });
    expect(run.progress!.active.length).toBeLessThanOrEqual(3);
    await readSse(res);
  });

  it('연결이 끊겨도 끝까지 만들어 저장한다', async () => {
    const p = ready();
    fakeRuns();
    const ac = new AbortController();
    const res = await call(p.id, { agent: 'codex' }, ac.signal);
    await waitUntil(() => getRun(p.id) !== null);
    ac.abort();
    await readSse(res);
    await waitUntil(() => getRun(p.id) === null);
    for (const n of names) expect(getDocument(p.id, `requirements/${n}.md`)?.status).toBe('draft');
  });

  it('취소 경로(DELETE /run)로 멈추면 남은 문서는 만들지 않고 잠금을 푼다', async () => {
    const p = ready();
    fakeRuns();
    const res = await call(p.id);
    await waitUntil(() => getRun(p.id) !== null);
    const cancel = await cancelDELETE(jsonReq('DELETE', `http://127.0.0.1:3000/api/projects/${p.id}/run`), ctx({ id: String(p.id) }));
    expect(cancel.status).toBe(204);
    await readSse(res);
    expect(getRun(p.id)).toBeNull();
    const drafted = names.filter((n) => getDocument(p.id, `requirements/${n}.md`)?.status === 'draft');
    expect(drafted.length).toBeLessThan(5);
  });

  it('취소 경로: 실행이 없으면 204, 없는 프로젝트 404, 다른 종류의 실행은 409', async () => {
    const p = ready();
    const del = (id: number) => cancelDELETE(jsonReq('DELETE', `http://127.0.0.1:3000/api/projects/${id}/run`), ctx({ id: String(id) }));
    expect((await del(p.id)).status).toBe(204);
    expect((await del(9999)).status).toBe(404);
    const other = acquireRun(p.id, 'interview', null)!;
    expect((await del(p.id)).status).toBe(409);
    other.release();
  });

  it('조건: USERFLOW 미승인·만들 문서 없음·저장소·다른 작업 중', async () => {
    const a = ready();
    updateDocument(a.id, '4-USERFLOW.md', { status: 'draft' });
    expect((await call(a.id)).status).toBe(409);

    const b = ready();
    for (const n of names) updateDocument(b.id, `requirements/${n}.md`, { content: 'x', status: 'draft' });
    const none = await call(b.id);
    expect(none.status).toBe(409);
    expect((await none.json()).message).toContain('만들 요구사항 문서가 없습니다');

    const repo = createProject({ name: 'r', idea: '', designMd: null, repo: 'o/r' });
    expect((await call(repo.id)).status).toBe(409);

    const c = ready();
    const other = acquireRun(c.id, 'document', '0-PRODUCT.md')!;
    expect((await (await call(c.id)).json()).code).toBe('busy');
    other.release();
    expect((await call(9999)).status).toBe(404);
    expect((await call(c.id, { agent: 'x' })).status).toBe(400);
  });
});

describe('요구사항 문서 개별 생성은 함께 돈다', () => {
  const one = (id: number, path: string) =>
    generatePOST(jsonReq('POST', `http://127.0.0.1:3000/api/projects/${id}/documents/${encodeURIComponent(path)}/generate`, { agent: 'codex' }), ctx({ id: String(id), path }));

  it('한 문서가 도는 중에도 다른 요구사항 문서를 만들 수 있고, 동시 3개를 넘으면 busy', async () => {
    const p = ready();
    const state = fakeRuns(async () => { await new Promise((r) => setTimeout(r, 150)); return '# 본문'; });
    const r1 = await one(p.id, 'requirements/a.md');
    const r2 = await one(p.id, 'requirements/b.md');
    const r3 = await one(p.id, 'requirements/c.md');
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
    expect(getRun(p.id)?.progress?.active.sort()).toEqual(['requirements/a.md', 'requirements/b.md', 'requirements/c.md']);
    const r4 = await one(p.id, 'requirements/d.md');
    expect(r4.status).toBe(409);
    expect((await r4.json()).code).toBe('busy');
    // 같은 문서를 다시 누르는 것도 막는다
    expect((await one(p.id, 'requirements/a.md')).status).toBe(409);
    await Promise.all([r1, r2, r3].map(readSse));
    await waitUntil(() => getRun(p.id) === null);
    expect(state.max).toBe(3);
    for (const n of ['a', 'b', 'c']) expect(getDocument(p.id, `requirements/${n}.md`)?.status).toBe('draft');
    expect(getDocument(p.id, 'requirements/d.md')?.status).toBe('empty');
  });

  it('요구사항이 아닌 문서·인터뷰·한 번에 만들기는 공유 실행 중에 막힌다', async () => {
    const p = ready();
    fakeRuns(async () => { await new Promise((r) => setTimeout(r, 120)); return '# 본문'; });
    const r1 = await one(p.id, 'requirements/a.md');
    expect((await call(p.id)).status).toBe(409);
    expect(acquireRun(p.id, 'interview', null)).toBeNull();
    // 생성 중인 문서의 저장은 막힌다 (실행 중 표시가 문서에 붙는다)
    await readSse(r1);
    await waitUntil(() => getRun(p.id) === null);
  });

  it('취소하면 함께 도는 문서가 모두 멈추고 잠금이 풀린다', async () => {
    const p = ready();
    fakeRuns(async () => { await new Promise((r) => setTimeout(r, 300)); return '# 본문'; });
    const rs = [await one(p.id, 'requirements/a.md'), await one(p.id, 'requirements/b.md')];
    const cancel = await cancelDELETE(jsonReq('DELETE', `http://127.0.0.1:3000/api/projects/${p.id}/run`), ctx({ id: String(p.id) }));
    expect(cancel.status).toBe(204);
    await Promise.all(rs.map(readSse));
    expect(getRun(p.id)).toBeNull();
    expect(getDocument(p.id, 'requirements/a.md')?.status).toBe('empty');
  });
});
