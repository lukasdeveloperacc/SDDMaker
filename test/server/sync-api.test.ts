import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexAdapter } from '@/server/agents/codex';
import { createInterview, createProject, getDocument, insertEmptyDocuments, updateDocument } from '@/server/db';
import { getRun } from '@/server/runtime';
import { POST } from '@/app/api/projects/[id]/sync/route';
import { ctx, jsonReq, readSse } from '../helpers/route';

afterEach(() => vi.restoreAllMocks());

const HTML = '<!DOCTYPE html><html><body>old</body></html>';

// 요구사항 a·b와 화면 s가 승인되어 있고, 셋 모두 "앞 문서 변경됨"이 붙은 프로젝트
function flagged(userflowApproved = true) {
  const p = createProject({ name: 'p', idea: 'i', designMd: '# 디자인', repo: null });
  createInterview(p.id, null, 'skipped');
  updateDocument(p.id, '0-PRODUCT.md', { content: '[a](requirements/a.md)\n[b](requirements/b.md)', status: 'approved' });
  updateDocument(p.id, '1-SYSTEM-ARCHITECTURE.md', { content: '# 아키텍처', status: 'approved' });
  updateDocument(p.id, '3-DATABASE.md', { content: '# DB', status: 'approved' });
  updateDocument(p.id, '4-USERFLOW.md', { content: '[s](screens/s.html)', status: userflowApproved ? 'approved' : 'draft' });
  insertEmptyDocuments(p.id, ['requirements/a.md', 'requirements/b.md', 'screens/s.html']);
  for (const path of ['requirements/a.md', 'requirements/b.md']) {
    updateDocument(p.id, path, { content: `# 옛 ${path}`, status: 'approved', upstreamChanged: true });
  }
  updateDocument(p.id, 'screens/s.html', { content: HTML, status: 'approved', upstreamChanged: true });
  return p;
}
const call = (id: number) =>
  POST(jsonReq('POST', `http://127.0.0.1:3000/api/projects/${id}/sync`, { agent: 'codex' }), ctx({ id: String(id) }));

function fakeRuns(screen = '<!DOCTYPE html><html><body>new</body></html>') {
  const prompts: string[] = [];
  vi.spyOn(codexAdapter, 'run').mockImplementation(async (i) => {
    prompts.push(i.prompt);
    return { text: i.prompt.startsWith('대상 문서: screens/') ? screen : '# 새 본문', sessionId: 's' };
  });
  return prompts;
}

describe('앞 문서 변경 반영', () => {
  it('요구사항을 먼저, 이어서 화면을 현재 본문 기준으로 갱신해 초안으로 돌린다', async () => {
    const p = flagged();
    const prompts = fakeRuns();
    const events = await readSse(await call(p.id));
    expect(JSON.parse(events.at(-1)!.data.text).done.sort()).toEqual(['requirements/a.md', 'requirements/b.md', 'screens/s.html']);
    for (const path of ['requirements/a.md', 'requirements/b.md']) {
      expect(getDocument(p.id, path)).toMatchObject({ content: '# 새 본문', status: 'draft', upstreamChanged: false, previousContent: `# 옛 ${path}` });
    }
    expect(getDocument(p.id, 'screens/s.html')).toMatchObject({ status: 'draft', upstreamChanged: false, previousContent: HTML });
    expect(prompts.every((q) => q.includes('## 현재 본문') && q.includes('## 피드백'))).toBe(true);
    // 화면은 방금 갱신한 요구사항 초안을 입력으로 받는다
    expect(prompts.at(-1)).toContain('(검토 전 초안)');
    expect(getRun(p.id)).toBeNull();
  });

  it('스크립트가 든 화면은 저장하지 않고 실패로 알린다', async () => {
    const p = flagged();
    fakeRuns('<html><body><script>1</script></body></html>');
    const out = JSON.parse((await readSse(await call(p.id))).at(-1)!.data.text);
    expect(out.failed.map((f: { path: string }) => f.path)).toEqual(['screens/s.html']);
    expect(getDocument(p.id, 'screens/s.html')).toMatchObject({ content: HTML, status: 'approved', upstreamChanged: true });
  });

  it('표시된 문서가 없으면 409다', async () => {
    const p = flagged();
    for (const path of ['requirements/a.md', 'requirements/b.md', 'screens/s.html']) updateDocument(p.id, path, { upstreamChanged: false });
    expect((await call(p.id)).status).toBe(409);
  });

  it('4-USERFLOW.md가 승인되지 않았으면 요구사항을 갱신하지 않는다', async () => {
    const p = flagged(false);
    const res = await call(p.id);
    expect(res.status).toBe(409);
    expect(getDocument(p.id, 'requirements/a.md')).toMatchObject({ content: '# 옛 requirements/a.md', status: 'approved' });
  });

  it('고칠 곳이 없다고 답한 문서는 내용과 승인 상태를 그대로 두고 표시만 지운다', async () => {
    const p = flagged();
    vi.spyOn(codexAdapter, 'run').mockImplementation(async (i) => ({
      text: i.prompt.includes('대상 문서: requirements/a.md') ? '변경 없음' : i.prompt.startsWith('대상 문서: screens/') ? '<html><body>새</body></html>' : '# 새 본문',
      sessionId: 's',
    }));
    const out = JSON.parse((await readSse(await call(p.id))).at(-1)!.data.text);
    expect(out.unchanged).toEqual(['requirements/a.md']);
    expect(getDocument(p.id, 'requirements/a.md')).toMatchObject({ content: '# 옛 requirements/a.md', status: 'approved', upstreamChanged: false, previousContent: null });
    expect(getDocument(p.id, 'requirements/b.md')).toMatchObject({ status: 'draft', content: '# 새 본문' });
  });

  it('기본 문서 하나라도 승인 전이면 요구사항을 갱신하지 않는다', async () => {
    const p = flagged();
    updateDocument(p.id, '3-DATABASE.md', { status: 'draft' });
    expect((await call(p.id)).status).toBe(409);
  });
});
