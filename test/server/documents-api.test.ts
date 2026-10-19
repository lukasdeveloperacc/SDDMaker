import { afterEach, describe, expect, it, vi } from 'vitest';
import { docApiPath, type ApproveResponse, type DocumentView } from '@/lib/contract';
import { codexAdapter } from '@/server/agents/codex';
import * as db from '@/server/db';
import { createInterview, createProject, flagUpstream, getDocument, insertEmptyDocuments, listDocuments, updateDocument } from '@/server/db';
import { getRun, acquireRun } from '@/server/runtime';
import { PUT as docPUT, DELETE as docDELETE } from '@/app/api/projects/[id]/documents/[path]/route';
import { POST as generatePOST } from '@/app/api/projects/[id]/documents/[path]/generate/route';
import { POST as undoPOST } from '@/app/api/projects/[id]/documents/[path]/undo/route';
import { POST as approvePOST } from '@/app/api/projects/[id]/documents/[path]/approve/route';
import { POST as unapprovePOST } from '@/app/api/projects/[id]/documents/[path]/unapprove/route';
import { POST as acknowledgePOST } from '@/app/api/projects/[id]/documents/[path]/acknowledge/route';
import { ctx, jsonReq, readSse, type SseEvent } from '../helpers/route';

// insertEmptyDocuments만 골라 실패시킬 수 있게 감싼다 (approve 트랜잭션 롤백 확인용).
const hooks = vi.hoisted(() => ({ failInsert: false }));
vi.mock('@/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/db')>();
  return {
    ...actual,
    insertEmptyDocuments: (...args: Parameters<typeof actual.insertEmptyDocuments>) => {
      if (hooks.failInsert) throw new Error('boom');
      return actual.insertEmptyDocuments(...args);
    },
  };
});

afterEach(() => {
  hooks.failInsert = false;
  vi.restoreAllMocks();
});

const BASE = 'http://127.0.0.1:3000';
const PRODUCT_LINKS = '# 제품\n\n- [프로젝트](requirements/project.md)\n- [내보내기](requirements/export.md)\n';

const u = (id: number, p: string, action?: string) => `${BASE}${docApiPath(id, p, action)}`;
const c = (id: number, p: string) => ctx({ id: String(id), path: p });

function newProject(skipped = true) {
  const p = createProject({ name: 'p', idea: 'i', designMd: null });
  if (skipped) createInterview(p.id, null, 'skipped');
  return p;
}

function setDoc(id: number, p: string, patch: Parameters<typeof updateDocument>[2]) {
  return updateDocument(id, p, patch);
}

async function waitUntil(cond: () => boolean, ms = 10000) {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function generate(id: number, p: string, body: Record<string, unknown>, signal?: AbortSignal) {
  return generatePOST(jsonReq('POST', u(id, p, 'generate'), body, signal), c(id, p));
}

async function generateAndWait(id: number, p: string, body: Record<string, unknown>): Promise<SseEvent[]> {
  return readSse(await generate(id, p, body));
}

// 테스트에서 응답 필드를 바로 꺼내 쓰므로 any를 허용한다 (helper와 같은 이유).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('생성 (generate)', () => {
  it('시나리오 4: 생성 → 수정 → 피드백 재생성 → 되돌리기 → 다시 생성 → 승인', async () => {
    const p = newProject();
    const first = await generateAndWait(p.id, '0-PRODUCT.md', { agent: 'codex' });
    const done = first.find((e) => e.event === 'done');
    expect(done?.data.text).toContain('# 제품');
    expect(getDocument(p.id, '0-PRODUCT.md')).toMatchObject({ status: 'draft', agent: 'codex' });

    const put = await docPUT(
      jsonReq('PUT', u(p.id, '0-PRODUCT.md'), { content: PRODUCT_LINKS.replace('내보내기', '수정') }),
      c(p.id, '0-PRODUCT.md'),
    );
    expect(put.status).toBe(200);
    const edited = getDocument(p.id, '0-PRODUCT.md')!.content;

    await generateAndWait(p.id, '0-PRODUCT.md', { agent: 'codex', feedback: '짧게' });
    expect(getDocument(p.id, '0-PRODUCT.md')!.previousContent).toBe(edited);

    const undo = await undoPOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'undo')), c(p.id, '0-PRODUCT.md'));
    const undone = (await json<{ document: DocumentView }>(undo)).document;
    expect(undone.content).toBe(edited);
    expect(undone.canUndo).toBe(false);

    await generateAndWait(p.id, '0-PRODUCT.md', { agent: 'codex' });
    const approve = await approvePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'approve')), c(p.id, '0-PRODUCT.md'));
    const body = await json<ApproveResponse>(approve);
    expect(body.requirements).toEqual(['project', 'export']);
    const reqs = listDocuments(p.id).filter((d) => d.path.startsWith('requirements/'));
    expect(reqs.map((d) => d.path).sort()).toEqual(['requirements/export.md', 'requirements/project.md']);
    expect(reqs.every((d) => d.status === 'empty')).toBe(true);
  });

  it('FAKE_FENCE=1이면 울타리 없이 저장한다', async () => {
    process.env.FAKE_FENCE = '1';
    const p = newProject();
    await generateAndWait(p.id, '0-PRODUCT.md', { agent: 'codex' });
    const content = getDocument(p.id, '0-PRODUCT.md')!.content;
    expect(content.startsWith('# 제품')).toBe(true);
    expect(content).not.toContain('```');
  });

  it('실패하면 error 이벤트만 오고 본문과 상태는 그대로다', async () => {
    process.env.FAKE_MODE = 'fail';
    const p = newProject();
    const events = await generateAndWait(p.id, '0-PRODUCT.md', { agent: 'codex' });
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'agent_failed' } });
    expect(getDocument(p.id, '0-PRODUCT.md')).toMatchObject({ content: '', status: 'empty' });
    expect(getRun(p.id)).toBeNull();
  });

  it('생성 중 연결이 끊기면 본문·상태·이전 본문을 바꾸지 않고 잠금을 푼다', async () => {
    process.env.FAKE_MODE = 'slow';
    const p = newProject();
    setDoc(p.id, '0-PRODUCT.md', { content: '원본', status: 'draft' });
    const ac = new AbortController();
    const res = await generate(p.id, '0-PRODUCT.md', { agent: 'codex' }, ac.signal);
    await waitUntil(() => getRun(p.id) !== null);
    ac.abort();
    await readSse(res);
    await waitUntil(() => getRun(p.id) === null);
    expect(getDocument(p.id, '0-PRODUCT.md')).toMatchObject({ content: '원본', status: 'draft', previousContent: null });
  });

  it('경합: CLI가 끝난 직후 저장 전에 끊기면 저장하지 않는다', async () => {
    const p = newProject();
    setDoc(p.id, '0-PRODUCT.md', { content: '원본', status: 'draft' });
    const ac = new AbortController();
    const original = codexAdapter.run.bind(codexAdapter);
    vi.spyOn(codexAdapter, 'run').mockImplementationOnce(async (i) => {
      const r = await original(i);
      ac.abort();
      return r;
    });
    const events = await readSse(await generate(p.id, '0-PRODUCT.md', { agent: 'codex' }, ac.signal));
    expect(events.some((e) => e.event === 'done')).toBe(false);
    expect(getDocument(p.id, '0-PRODUCT.md')).toMatchObject({ content: '원본', status: 'draft', previousContent: null });
    await waitUntil(() => getRun(p.id) === null);
  });

  it('인터뷰가 active면 0-PRODUCT 생성은 409 precondition', async () => {
    const p = createProject({ name: 'a', idea: 'b', designMd: null });
    createInterview(p.id, 'claude', 'active');
    const res = await generate(p.id, '0-PRODUCT.md', { agent: 'codex' });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('precondition');
  });

  it('0-PRODUCT이 승인되지 않았으면 1-SYSTEM 생성은 409 precondition', async () => {
    const p = newProject();
    setDoc(p.id, '0-PRODUCT.md', { content: PRODUCT_LINKS, status: 'draft' });
    const res = await generate(p.id, '1-SYSTEM-ARCHITECTURE.md', { agent: 'codex' });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('precondition');
  });

  it('새 프로젝트의 changes 생성은 409 precondition', async () => {
    const p = newProject();
    const res = await generate(p.id, 'changes/001-mvp.md', { agent: 'codex' });
    expect((await json(res)).code).toBe('precondition');
  });

  it('실행 중이면 다른 문서 생성은 busy, 실행 중인 문서의 저장·되돌리기·승인·승인 취소도 busy', async () => {
    process.env.FAKE_MODE = 'slow';
    const p = newProject();
    const ac = new AbortController();
    const res = await generate(p.id, '0-PRODUCT.md', { agent: 'codex' }, ac.signal);
    await waitUntil(() => getRun(p.id) !== null);

    expect((await json(await generate(p.id, '1-SYSTEM-ARCHITECTURE.md', { agent: 'codex' }))).code).toBe('busy');
    const put = await docPUT(jsonReq('PUT', u(p.id, '0-PRODUCT.md'), { content: 'x' }), c(p.id, '0-PRODUCT.md'));
    expect((await json(put)).code).toBe('busy');
    const undo = await undoPOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'undo')), c(p.id, '0-PRODUCT.md'));
    expect((await json(undo)).code).toBe('busy');
    const approve = await approvePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'approve')), c(p.id, '0-PRODUCT.md'));
    expect((await json(approve)).code).toBe('busy');
    const unapprove = await unapprovePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'unapprove')), c(p.id, '0-PRODUCT.md'));
    expect((await json(unapprove)).code).toBe('busy');

    ac.abort();
    await readSse(res);
    await waitUntil(() => getRun(p.id) === null);
  });

  it('인터뷰 실행 중이면 0-PRODUCT 생성은 busy', async () => {
    const p = newProject();
    const stuck = acquireRun(p.id, 'interview', null);
    try {
      expect((await json(await generate(p.id, '0-PRODUCT.md', { agent: 'codex' }))).code).toBe('busy');
    } finally {
      stuck?.release();
    }
  });

  it('승인된 문서는 생성·저장·되돌리기 모두 409 approved_locked', async () => {
    const p = newProject();
    setDoc(p.id, '0-PRODUCT.md', { content: PRODUCT_LINKS, status: 'approved', previousContent: '이전' });
    expect((await json(await generate(p.id, '0-PRODUCT.md', { agent: 'codex' }))).code).toBe('approved_locked');
    const put = await docPUT(jsonReq('PUT', u(p.id, '0-PRODUCT.md'), { content: 'x' }), c(p.id, '0-PRODUCT.md'));
    expect((await json(put)).code).toBe('approved_locked');
    const undo = await undoPOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'undo')), c(p.id, '0-PRODUCT.md'));
    expect((await json(undo)).code).toBe('approved_locked');
  });

  it('요청 형식 오류는 400, 없는 문서 경로는 400 또는 404', async () => {
    const p = newProject();
    expect((await generate(p.id, '0-PRODUCT.md', { agent: 'gpt' })).status).toBe(400);
    expect((await generate(p.id, '0-PRODUCT.md', { agent: 'codex', feedback: 3 })).status).toBe(400);
    expect((await generate(p.id, 'AGENTS.md', { agent: 'codex' })).status).toBe(400);
    expect((await generate(p.id, 'requirements/none.md', { agent: 'codex' })).status).toBe(404);
    expect((await generate(987654, '0-PRODUCT.md', { agent: 'codex' })).status).toBe(404);
  });
});

describe('직접 저장 (PUT)', () => {
  it('빈 문서에 쓰면 draft가 된다', async () => {
    const p = newProject();
    const res = await docPUT(jsonReq('PUT', u(p.id, '0-PRODUCT.md'), { content: '직접 씀' }), c(p.id, '0-PRODUCT.md'));
    expect((await json<{ document: DocumentView }>(res)).document.status).toBe('draft');
  });

  it('빈 문서에 공백만 저장하면 400이고 문서는 empty로 남는다', async () => {
    const p = newProject();
    const res = await docPUT(jsonReq('PUT', u(p.id, '0-PRODUCT.md'), { content: '   ' }), c(p.id, '0-PRODUCT.md'));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('invalid_input');
    expect(getDocument(p.id, '0-PRODUCT.md')).toMatchObject({ content: '', status: 'empty' });
  });

  it('마크다운 문서에 generatedBy나 keepUndo를 보내면 400', async () => {
    const p = newProject();
    const gen = await docPUT(jsonReq('PUT', u(p.id, '0-PRODUCT.md'), { content: 'x', generatedBy: 'claude' }), c(p.id, '0-PRODUCT.md'));
    expect(gen.status).toBe(400);
    const keep = await docPUT(jsonReq('PUT', u(p.id, '0-PRODUCT.md'), { content: 'x', keepUndo: true }), c(p.id, '0-PRODUCT.md'));
    expect(keep.status).toBe(400);
  });

  it('화면에서 keepUndo 없이 generatedBy를 보내면 400, 잘못된 agent 이름도 400', async () => {
    const p = newProject();
    setDoc(p.id, '0-PRODUCT.md', { content: PRODUCT_LINKS, status: 'approved' });
    insertEmptyDocuments(p.id, ['screens/home.html']);
    const noKeep = await docPUT(jsonReq('PUT', u(p.id, 'screens/home.html'), { content: '<html></html>', generatedBy: 'claude' }), c(p.id, 'screens/home.html'));
    expect(noKeep.status).toBe(400);
    const badAgent = await docPUT(jsonReq('PUT', u(p.id, 'screens/home.html'), { content: '<html></html>', keepUndo: true, generatedBy: 'gpt' }), c(p.id, 'screens/home.html'));
    expect(badAgent.status).toBe(400);
  });

  it('요청 본문 content가 글이 아니면 400', async () => {
    const p = newProject();
    const res = await docPUT(jsonReq('PUT', u(p.id, '0-PRODUCT.md'), { content: 3 }), c(p.id, '0-PRODUCT.md'));
    expect(res.status).toBe(400);
  });
});

describe('화면 정의서', () => {
  // 디자인·요구사항·화면 목록을 승인된 상태로 준비한다.
  function screenReady() {
    const p = createProject({ name: 'a', idea: 'b', designMd: '# 디자인' });
    createInterview(p.id, null, 'skipped');
    setDoc(p.id, '0-PRODUCT.md', { content: '[p](requirements/project.md)', status: 'approved' });
    insertEmptyDocuments(p.id, ['requirements/project.md', 'screens/home.html']);
    setDoc(p.id, 'requirements/project.md', { content: '# project', status: 'approved' });
    setDoc(p.id, '4-USERFLOW.md', { content: '[홈](screens/home.html)', status: 'approved' });
    return p;
  }

  it('생성 응답은 원문이고 저장하지 않는다', async () => {
    const p = screenReady();
    const events = await generateAndWait(p.id, 'screens/home.html', { agent: 'codex' });
    const done = events.find((e) => e.event === 'done');
    expect(done?.data.text).toContain('data-component="top-bar"');
    expect(getDocument(p.id, 'screens/home.html')).toMatchObject({ content: '', status: 'empty' });
  });

  it('디자인 문서가 없으면 생성은 design_required', async () => {
    const p = screenReady();
    updateDocument(p.id, '0-PRODUCT.md', { status: 'approved' });
    db.setDesign(p.id, null);
    const res = await generate(p.id, 'screens/home.html', { agent: 'codex' });
    expect((await json(res)).code).toBe('design_required');
  });

  it('<script>이 들어가면 저장을 거부한다 (대소문자 무관)', async () => {
    const p = screenReady();
    for (const content of ['<html><script>x</script></html>', '<html><SCRIPT>x</SCRIPT></html>']) {
      const res = await docPUT(jsonReq('PUT', u(p.id, 'screens/home.html'), { content }), c(p.id, 'screens/home.html'));
      expect(res.status).toBe(400);
      expect((await json(res)).code).toBe('script_rejected');
    }
  });

  it('keepUndo 저장 뒤 되돌리기로 직전 HTML이 복구된다', async () => {
    const p = screenReady();
    await docPUT(jsonReq('PUT', u(p.id, 'screens/home.html'), { content: '<html>A</html>' }), c(p.id, 'screens/home.html'));
    const keep = await docPUT(jsonReq('PUT', u(p.id, 'screens/home.html'), { content: '<html>B</html>', keepUndo: true }), c(p.id, 'screens/home.html'));
    expect((await json<{ document: DocumentView }>(keep)).document.canUndo).toBe(true);
    const undo = await undoPOST(jsonReq('POST', u(p.id, 'screens/home.html', 'undo')), c(p.id, 'screens/home.html'));
    expect((await json<{ document: DocumentView }>(undo)).document.content).toBe('<html>A</html>');
  });

  it('표시가 붙은 화면에 keepUndo+generatedBy로 저장하면 표시가 사라지고 agent가 바뀐다', async () => {
    const p = screenReady();
    await docPUT(jsonReq('PUT', u(p.id, 'screens/home.html'), { content: '<html>A</html>' }), c(p.id, 'screens/home.html'));
    flagUpstream(p.id, ['screens/home.html']);
    const res = await docPUT(
      jsonReq('PUT', u(p.id, 'screens/home.html'), { content: '<html>C</html>', keepUndo: true, generatedBy: 'claude' }),
      c(p.id, 'screens/home.html'),
    );
    expect(getDocument(p.id, 'screens/home.html')).toMatchObject({ upstreamChanged: false, agent: 'claude' });
    expect(res.status).toBe(200);
  });

  it('keepUndo만 보내면 표시와 agent는 그대로다', async () => {
    const p = screenReady();
    await docPUT(jsonReq('PUT', u(p.id, 'screens/home.html'), { content: '<html>A</html>' }), c(p.id, 'screens/home.html'));
    flagUpstream(p.id, ['screens/home.html']);
    setDoc(p.id, 'screens/home.html', { agent: 'codex' });
    const res = await docPUT(jsonReq('PUT', u(p.id, 'screens/home.html'), { content: '<html>D</html>', keepUndo: true }), c(p.id, 'screens/home.html'));
    expect(res.status).toBe(200);
    expect(getDocument(p.id, 'screens/home.html')).toMatchObject({ upstreamChanged: true, agent: 'codex' });
  });
});

describe('승인·승인 취소·확인·삭제', () => {
  it('승인 취소하면 뒤 단계 본문 문서에 표시가 붙고 승인 취소한 문서가 draft가 된다', async () => {
    const p = newProject();
    setDoc(p.id, '0-PRODUCT.md', { content: PRODUCT_LINKS, status: 'approved' });
    setDoc(p.id, '1-SYSTEM-ARCHITECTURE.md', { content: 'a', status: 'approved' });
    setDoc(p.id, '3-DATABASE.md', { content: 'b', status: 'draft' });
    const res = await unapprovePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'unapprove')), c(p.id, '0-PRODUCT.md'));
    const body = await json<{ document: DocumentView; flagged: string[] }>(res);
    expect(body.flagged).toEqual(['1-SYSTEM-ARCHITECTURE.md', '3-DATABASE.md']);
    expect(body.document.status).toBe('draft');
    expect(getDocument(p.id, '1-SYSTEM-ARCHITECTURE.md')?.upstreamChanged).toBe(true);
  });

  it('승인 취소 뒤 링크를 바꿔 다시 승인하면 새 문서가 생기고 빠진 문서는 목록에서 빠진다 (시나리오 8)', async () => {
    const p = newProject();
    insertEmptyDocuments(p.id, ['requirements/project.md', 'requirements/export.md']);
    setDoc(p.id, '0-PRODUCT.md', { content: PRODUCT_LINKS, status: 'approved' });
    setDoc(p.id, 'requirements/project.md', { content: '# p', status: 'approved' });
    await unapprovePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'unapprove')), c(p.id, '0-PRODUCT.md'));
    setDoc(p.id, '0-PRODUCT.md', { content: '- [프로젝트](requirements/project.md)\n- [API](requirements/api.md)\n' });
    const approve = await approvePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'approve')), c(p.id, '0-PRODUCT.md'));
    expect((await json<ApproveResponse>(approve)).requirements).toEqual(['project', 'api']);
    expect(getDocument(p.id, 'requirements/api.md')?.status).toBe('empty');

    const missing = await docDELETE(jsonReq('DELETE', u(p.id, 'requirements/export.md')), c(p.id, 'requirements/export.md'));
    expect(missing.status).toBe(204);
    const notMissing = await docDELETE(jsonReq('DELETE', u(p.id, 'requirements/project.md')), c(p.id, 'requirements/project.md'));
    expect(notMissing.status).toBe(409);
    expect((await json(notMissing)).code).toBe('invalid_state');
  });

  it('0-PRODUCT에 링크가 없거나 agents 링크가 있으면 승인은 409 invalid_links', async () => {
    const p = newProject();
    setDoc(p.id, '0-PRODUCT.md', { content: '# 링크 없음', status: 'draft' });
    const none = await approvePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'approve')), c(p.id, '0-PRODUCT.md'));
    expect(await json(none)).toMatchObject({ code: 'invalid_links', items: [] });
    setDoc(p.id, '0-PRODUCT.md', { content: '[a](requirements/agents.md)' });
    const bad = await approvePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'approve')), c(p.id, '0-PRODUCT.md'));
    expect(bad.status).toBe(409);
    expect(await json(bad)).toMatchObject({ code: 'invalid_links', items: ['agents'] });
  });

  it('승인 중 행 추가가 실패하면 0-PRODUCT는 draft로 남는다', async () => {
    const p = newProject();
    setDoc(p.id, '0-PRODUCT.md', { content: PRODUCT_LINKS, status: 'draft' });
    hooks.failInsert = true;
    await expect(
      approvePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'approve')), c(p.id, '0-PRODUCT.md')),
    ).rejects.toThrow('boom');
    expect(getDocument(p.id, '0-PRODUCT.md')?.status).toBe('draft');
  });

  it('승인된 문서가 표시를 가지면 확인으로 표시만 지워지고, draft에 표시가 있으면 승인으로 사라진다', async () => {
    const p = newProject();
    setDoc(p.id, '0-PRODUCT.md', { content: PRODUCT_LINKS, status: 'approved' });
    setDoc(p.id, '1-SYSTEM-ARCHITECTURE.md', { content: 'a', status: 'approved', upstreamChanged: true });
    const ack = await acknowledgePOST(jsonReq('POST', u(p.id, '1-SYSTEM-ARCHITECTURE.md', 'acknowledge')), c(p.id, '1-SYSTEM-ARCHITECTURE.md'));
    expect(ack.status).toBe(200);
    expect(getDocument(p.id, '1-SYSTEM-ARCHITECTURE.md')).toMatchObject({ status: 'approved', upstreamChanged: false });

    setDoc(p.id, '1-SYSTEM-ARCHITECTURE.md', { status: 'draft', upstreamChanged: true });
    const approve = await approvePOST(jsonReq('POST', u(p.id, '1-SYSTEM-ARCHITECTURE.md', 'approve')), c(p.id, '1-SYSTEM-ARCHITECTURE.md'));
    expect(approve.status).toBe(200);
    expect(getDocument(p.id, '1-SYSTEM-ARCHITECTURE.md')).toMatchObject({ status: 'approved', upstreamChanged: false });
  });

  it('draft에 확인을 보내면 409 invalid_state', async () => {
    const p = newProject();
    setDoc(p.id, '1-SYSTEM-ARCHITECTURE.md', { content: 'a', status: 'draft', upstreamChanged: true });
    const res = await acknowledgePOST(jsonReq('POST', u(p.id, '1-SYSTEM-ARCHITECTURE.md', 'acknowledge')), c(p.id, '1-SYSTEM-ARCHITECTURE.md'));
    expect((await json(res)).code).toBe('invalid_state');
  });

  it('승인된 문서가 아니면 승인 취소는 409 invalid_state, 되돌릴 것이 없으면 nothing_to_undo', async () => {
    const p = newProject();
    const notApproved = await unapprovePOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'unapprove')), c(p.id, '0-PRODUCT.md'));
    expect((await json(notApproved)).code).toBe('invalid_state');
    const undo = await undoPOST(jsonReq('POST', u(p.id, '0-PRODUCT.md', 'undo')), c(p.id, '0-PRODUCT.md'));
    expect((await json(undo)).code).toBe('nothing_to_undo');
  });

  it('인터뷰가 없는 새 프로젝트의 changes는 승인도 precondition', async () => {
    const p = newProject();
    setDoc(p.id, 'changes/001-mvp.md', { content: '# 변경', status: 'draft' });
    const res = await approvePOST(jsonReq('POST', u(p.id, 'changes/001-mvp.md', 'approve')), c(p.id, 'changes/001-mvp.md'));
    expect((await json(res)).code).toBe('precondition');
  });

  it('목록에서 빠지지 않은 문서는 삭제할 수 없다 (0-PRODUCT는 못 지움)', async () => {
    const p = newProject();
    const res = await docDELETE(jsonReq('DELETE', u(p.id, '0-PRODUCT.md')), c(p.id, '0-PRODUCT.md'));
    expect(res.status).toBe(409);
  });
});
