import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as preview } from '@/app/api/projects/[id]/documents/[path]/annotations/preview/route';
import { POST as send } from '@/app/api/projects/[id]/documents/[path]/annotations/route';
import { claudeAdapter } from '@/server/agents/claude';
import { createProject, insertEmptyDocuments, updateDocument } from '@/server/db';
import { acquireRun } from '@/server/runtime';
import { ctx, jsonReq, readSse } from '../helpers/route';

afterEach(() => {
  vi.restoreAllMocks();
});

const HTML = '<!DOCTYPE html><html data-frame="page"><body><header data-component="top-bar">상단</header></body></html>';

function screenProject(status: 'empty' | 'draft' | 'approved' = 'draft') {
  const p = createProject({ name: 'app', idea: 'idea', designMd: '# 디자인\n\n토큰 목록' });
  insertEmptyDocuments(p.id, ['screens/home.html']);
  if (status !== 'empty') {
    updateDocument(p.id, 'screens/home.html', { content: HTML, status });
  }
  return p;
}

const ONE = [
  { kind: 'change', target: { component: 'top-bar', tag: 'header', text: '상단' }, note: '색을 바꿔 주세요' },
];

function previewReq(id: number, body: unknown, path = 'screens/home.html') {
  return preview(jsonReq('POST', 'http://127.0.0.1:3000/x', body), ctx({ id: String(id), path }));
}

function sendReq(id: number, body: unknown, path = 'screens/home.html') {
  return send(jsonReq('POST', 'http://127.0.0.1:3000/x', body), ctx({ id: String(id), path }));
}

describe('주석 미리보기', () => {
  it('화면 주석을 조립한 프롬프트를 돌려준다', async () => {
    const p = screenProject();
    const res = await previewReq(p.id, { annotations: ONE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { prompt: string };
    expect(body.prompt.startsWith('대상 화면: screens/home.html')).toBe(true);
    expect(body.prompt).toContain('[수정] 컴포넌트 `top-bar` (header, "상단")');
    expect(body.prompt).toContain(HTML);
  });

  it('화면이 아니거나 주석이 틀리면 400', async () => {
    const p = screenProject();
    expect((await previewReq(p.id, { annotations: ONE }, '0-PRODUCT.md')).status).toBe(400);
    expect((await previewReq(p.id, { annotations: [] })).status).toBe(400);
    expect((await previewReq(p.id, { annotations: [{ ...ONE[0], kind: 'fix' }] })).status).toBe(400);
    expect((await previewReq(p.id, { annotations: [{ ...ONE[0], note: '  ' }] })).status).toBe(400);
    expect((await previewReq(p.id, { annotations: [{ ...ONE[0], target: { component: 'Top Bar', tag: 'header', text: '' } }] })).status).toBe(400);
    const badBox = { kind: 'question', target: { drawing: { box: { x1: 0.6, y1: 0, x2: 0.4, y2: 0.1 }, components: [] } }, note: '질문' };
    expect((await previewReq(p.id, { annotations: [badBox] })).status).toBe(400);
  });

  it('없는 프로젝트는 404', async () => {
    expect((await previewReq(987654, { annotations: ONE })).status).toBe(404);
  });
});

describe('주석 보내기', () => {
  it('응답 원문을 done으로 보내고 화면 HTML은 그대로 둔다', async () => {
    const p = screenProject();
    const res = await sendReq(p.id, { agent: 'claude', annotations: ONE });
    expect(res.status).toBe(200);
    const events = await readSse(res);
    const done = events.find((e) => e.event === 'done');
    expect(done?.data.text).toContain('```html');
    expect(events.at(-1)?.event).toBe('done');
    const after = await previewReq(p.id, { annotations: ONE });
    expect(((await after.json()) as { prompt: string }).prompt).toContain(HTML);
  });

  it('보내는 프롬프트는 미리보기와 같다', async () => {
    const p = screenProject();
    const spy = vi.spyOn(claudeAdapter, 'run').mockResolvedValue({ text: '답', sessionId: 's' });
    const res = await sendReq(p.id, { agent: 'claude', annotations: ONE });
    await readSse(res);
    const pv = (await (await previewReq(p.id, { annotations: ONE })).json()) as { prompt: string };
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].prompt).toBe(pv.prompt);
  });

  it('승인된 화면은 409 approved_locked, 빈 화면은 409 invalid_state', async () => {
    const approved = screenProject('approved');
    const r1 = await sendReq(approved.id, { agent: 'claude', annotations: ONE });
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as { code: string }).code).toBe('approved_locked');
    const empty = screenProject('empty');
    const r2 = await sendReq(empty.id, { agent: 'claude', annotations: ONE });
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as { code: string }).code).toBe('invalid_state');
  });

  it('잘못된 agent나 주석이면 400, 실행 중이면 409 busy', async () => {
    const p = screenProject();
    expect((await sendReq(p.id, { agent: 'gpt', annotations: ONE })).status).toBe(400);
    expect((await sendReq(p.id, { agent: 'claude', annotations: [] })).status).toBe(400);
    const handle = acquireRun(p.id, 'document', null);
    try {
      const r = await sendReq(p.id, { agent: 'claude', annotations: ONE });
      expect(r.status).toBe(409);
      expect(((await r.json()) as { code: string }).code).toBe('busy');
    } finally {
      handle?.release();
    }
  });
});
