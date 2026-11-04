import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexAdapter } from '@/server/agents/codex';
import { createInterview, createProject, getDocument, insertEmptyDocuments, updateDocument } from '@/server/db';
import { getRun } from '@/server/runtime';
import { POST } from '@/app/api/projects/[id]/documents/[path]/generate/route';
import { ctx, jsonReq, readSse } from '../helpers/route';

afterEach(() => vi.restoreAllMocks());

function ready(names = ['a', 'b']) {
  const p = createProject({ name: 'p', idea: 'i', designMd: '# 디자인', repo: null });
  createInterview(p.id, null, 'skipped');
  updateDocument(p.id, '0-PRODUCT.md', { content: '[r](requirements/r.md)', status: 'approved' });
  updateDocument(p.id, '1-SYSTEM-ARCHITECTURE.md', { content: '# a', status: 'approved' });
  updateDocument(p.id, '3-DATABASE.md', { content: '# d', status: 'approved' });
  updateDocument(p.id, '4-USERFLOW.md', { content: names.map((n) => `[${n}](screens/${n}.html)`).join('\n'), status: 'approved' });
  insertEmptyDocuments(p.id, ['requirements/r.md', ...names.map((n) => `screens/${n}.html`)]);
  updateDocument(p.id, 'requirements/r.md', { content: '# r', status: 'approved' });
  return p;
}
const gen = (id: number, name: string) =>
  POST(jsonReq('POST', `http://127.0.0.1:3000/api/projects/${id}/documents/screens%2F${name}.html/generate`, { agent: 'codex' }), ctx({ id: String(id), path: `screens/${name}.html` }));

function fakeRuns(html = '<!DOCTYPE html><html><body>화면</body></html>') {
  const state = { active: 0, max: 0 };
  vi.spyOn(codexAdapter, 'run').mockImplementation(async () => {
    state.active++;
    state.max = Math.max(state.max, state.active);
    try {
      await new Promise((r) => setTimeout(r, 60));
      return { text: html, sessionId: 's' };
    } finally {
      state.active--;
    }
  });
  return state;
}

describe('화면 동시 생성', () => {
  it('다른 화면을 함께 생성하고, 각각 서버가 초안으로 저장한다', async () => {
    const p = ready();
    const state = fakeRuns();
    const [ra, rb] = await Promise.all([gen(p.id, 'a'), gen(p.id, 'b')]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    await Promise.all([readSse(ra), readSse(rb)]);
    expect(state.max).toBe(2);
    for (const n of ['a', 'b']) expect(getDocument(p.id, `screens/${n}.html`)).toMatchObject({ status: 'draft', agent: 'codex' });
    expect(getRun(p.id)).toBeNull();
  });

  it('같은 화면을 한 번 더 누르면 409다', async () => {
    const p = ready();
    fakeRuns();
    const first = gen(p.id, 'a');
    const res = await first;
    expect((await gen(p.id, 'a')).status).toBe(409);
    await readSse(res);
  });

  it('스크립트가 든 결과는 저장하지 않고 error로 알린다', async () => {
    const p = ready(['a']);
    fakeRuns('<html><body><script>1</script></body></html>');
    const events = await readSse(await gen(p.id, 'a'));
    expect(events.at(-1)?.event).toBe('error');
    expect(getDocument(p.id, 'screens/a.html')).toMatchObject({ status: 'empty', content: '' });
  });
});
