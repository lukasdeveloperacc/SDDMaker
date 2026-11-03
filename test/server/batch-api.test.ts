import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASELINE_DOC } from '@/lib/contract';
import { createInterview, createProject, getDocument, insertEmptyDocuments, listDocuments, updateDocument } from '@/server/db';
import { batchView } from '@/server/batch';
import { batchInputDocsFor } from '@/server/doc-rules';
import { acquireRun, cancelRun, getRun } from '@/server/runtime';
import { codexAdapter } from '@/server/agents/codex';
import { repoDir } from '@/server/env';
import { generationPrompt, projectDetail } from '@/server/documents';
import { POST, DELETE } from '@/app/api/projects/[id]/batch/route';
import { POST as approve } from '@/app/api/projects/[id]/batch/approve/route';
import { PUT } from '@/app/api/projects/[id]/documents/[path]/route';
import { POST as undo } from '@/app/api/projects/[id]/documents/[path]/undo/route';
import { PUT as design } from '@/app/api/projects/[id]/design/route';
import { POST as interviewSkip } from '@/app/api/projects/[id]/interview/skip/route';
import { POST as interviewApprove } from '@/app/api/projects/[id]/interview/approve/route';
import { POST as interviewUnapprove } from '@/app/api/projects/[id]/interview/unapprove/route';
import { PUT as interviewSummary } from '@/app/api/projects/[id]/interview/summary/route';
import { DELETE as deleteDoc } from '@/app/api/projects/[id]/documents/[path]/route';
import { DELETE as deleteProject } from '@/app/api/projects/[id]/route';
import { POST as generateDoc } from '@/app/api/projects/[id]/documents/[path]/generate/route';
import { POST as approveDoc } from '@/app/api/projects/[id]/documents/[path]/approve/route';
import { POST as unapproveDoc } from '@/app/api/projects/[id]/documents/[path]/unapprove/route';
import { POST as acknowledge } from '@/app/api/projects/[id]/documents/[path]/acknowledge/route';
import { seedRemote } from '../helpers/github';
import { ctx, jsonReq, readSse } from '../helpers/route';

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) cleanup(); });
const context = (id: number) => ctx({ id: String(id) });
const dc = (id: number, path: string) => ctx({ id: String(id), path });
const req = (body: object = { agent: 'codex' }, signal?: AbortSignal) => jsonReq('POST', 'http://localhost/api', body, signal);
function project() {
  const p = createProject({ name: 'repo', idea: '', designMd: null, repo: 'a/b' });
  createInterview(p.id, null, 'skipped');
  const remote = seedRemote(); cleanups.push(remote.cleanup);
  execFileSync('git', ['clone', '-q', remote.remote, repoDir(p.id)]);
  return p;
}
function fake() {
  vi.spyOn(codexAdapter, 'run').mockImplementation(async (input) => {
    const path = /대상 문서: (.*)/.exec(input.prompt)![1];
    return { text: path === '0-PRODUCT.md' ? '[active](requirements/active.md)' : `# ${path}`, sessionId: 'batch-test' };
  });
}
async function run(id: number) { return readSse(await POST(req(), context(id))); }
async function wait(cond: () => boolean) { for (let i = 0; i < 200; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timeout'); }

describe('repository batch', () => {
  it('generates every applicable draft in order without approvals or screens; manual gates remain', async () => {
    const p = project(); fake();
    const events = await run(p.id);
    expect(events.at(-1)?.event).toBe('done');
    const docs = listDocuments(p.id);
    expect(docs).toHaveLength(6);
    expect(docs.every((d) => d.status === 'draft')).toBe(true);
    expect(projectDetail(p.id)!.documents.find((d) => d.path === '1-SYSTEM-ARCHITECTURE.md')!.generate.ok).toBe(false);
    expect(batchView(p.id)).toMatchObject({ state: 'completed', remainingPaths: [] });
    const calls = vi.mocked(codexAdapter.run).mock.calls;
    expect(calls[1][0].prompt).toContain('검토 전 초안');
    expect(calls[1][0].prompt).toContain('기준 커밋:');
  });
  it('uses current draft PRODUCT set, preserves obsolete and existing drafts, inserts missing active row', async () => {
    const p = project(); fake();
    updateDocument(p.id, '0-PRODUCT.md', { content: '[new](requirements/new.md)', status: 'draft' });
    insertEmptyDocuments(p.id, ['requirements/old.md']);
    updateDocument(p.id, 'requirements/old.md', { content: 'OBSOLETE CONTENT', status: 'approved' });
    await run(p.id);
    expect(getDocument(p.id, '0-PRODUCT.md')!.content).toBe('[new](requirements/new.md)');
    expect(getDocument(p.id, 'requirements/new.md')!.status).toBe('draft');
    expect(getDocument(p.id, 'requirements/old.md')!.content).toBe('OBSOLETE CONTENT');
    expect(batchInputDocsFor(BASELINE_DOC, listDocuments(p.id)).map((d) => d.path)).not.toContain('requirements/old.md');
    expect(generationPrompt(p.id, BASELINE_DOC, undefined, true)).not.toContain('OBSOLETE CONTENT');
  });
  it('preserves completed drafts after failure, reconstructs partial, resumes missing only', async () => {
    const p = project(); fake();
    vi.mocked(codexAdapter.run).mockImplementationOnce(async () => ({ text: '[a](requirements/a.md)', sessionId: 'batch-test' }))
      .mockRejectedValueOnce(new Error('failure'));
    expect((await run(p.id)).at(-1)?.event).toBe('error');
    expect(batchView(p.id)!.state).toBe('partial');
    expect(getRun(p.id)).toBeNull();
    const saved = getDocument(p.id, '0-PRODUCT.md')!.content;
    await run(p.id);
    expect(getDocument(p.id, '0-PRODUCT.md')!.content).toBe(saved);
    expect(batchView(p.id)!.state).toBe('completed');
  });
  it('invalid and empty output does not save or expand', async () => {
    const p = project(); fake();
    vi.mocked(codexAdapter.run).mockResolvedValueOnce({ text: '# missing links', sessionId: 'batch-test' });
    expect((await run(p.id)).at(-1)?.data.code).toBe('invalid_links');
    expect(getDocument(p.id, '0-PRODUCT.md')!.status).toBe('empty');
    expect(listDocuments(p.id)).toHaveLength(5);
    vi.mocked(codexAdapter.run).mockResolvedValueOnce({ text: ' ', sessionId: 'batch-test' });
    expect((await run(p.id)).at(-1)?.data.code).toBe('agent_failed');
    expect(getDocument(p.id, '0-PRODUCT.md')!.content).toBe('');
  });
  it('explicit approval is atomic, rejects missing/stale/flagged inputs, then approves all', async () => {
    const p = project(); fake(); await run(p.id);
    const token = batchView(p.id)!.reviewToken;
    updateDocument(p.id, BASELINE_DOC, { content: 'edited' });
    expect((await approve(req({ reviewToken: token }), context(p.id))).status).toBe(409);
    updateDocument(p.id, BASELINE_DOC, { content: '' });
    expect((await approve(req({ reviewToken: batchView(p.id)!.reviewToken }), context(p.id))).status).toBe(409);
    expect(listDocuments(p.id).every((d) => d.status === 'draft')).toBe(true);
    updateDocument(p.id, BASELINE_DOC, { content: '# baseline', upstreamChanged: true });
    expect((await approve(req({ reviewToken: batchView(p.id)!.reviewToken }), context(p.id))).status).toBe(409);
    expect((await POST(req(), context(p.id))).status).toBe(409);
    expect((await acknowledge(req(), dc(p.id, BASELINE_DOC))).status).toBe(200);
    expect(getDocument(p.id, BASELINE_DOC)!.status).toBe('draft');
    expect((await approve(req({ reviewToken: batchView(p.id)!.reviewToken }), context(p.id))).status).toBe(200);
    expect(listDocuments(p.id).every((d) => d.status === 'approved')).toBe(true);
  });
  it('blocks concurrent mutations including request-body await race, duplicate start and unrelated cancellation', async () => {
    const p = project();
    let finish!: (text: string) => void;
    const pending = req();
    vi.spyOn(pending, 'text').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const saving = PUT(pending, dc(p.id, '0-PRODUCT.md'));
    await wait(() => !!finish);
    const handle = acquireRun(p.id, 'batch', null)!;
    finish(JSON.stringify({ content: 'race' }));
    expect((await saving).status).toBe(409);
    expect((await POST(req(), context(p.id))).status).toBe(409);
    expect((await acknowledge(req(), dc(p.id, '0-PRODUCT.md'))).status).toBe(409);
    handle.release();
    const manual = acquireRun(p.id, 'interview', null)!;
    expect((await DELETE(req(), context(p.id))).status).toBe(409);
    expect(manual.controller.signal.aborted).toBe(false); manual.release();
  });
  it('disconnect between CLI result and save persists no partial document', async () => {
    const p = project(); fake(); const ac = new AbortController();
    vi.mocked(codexAdapter.run).mockImplementationOnce(async () => { ac.abort(); return { text: '[a](requirements/a.md)', sessionId: 'batch-test' }; });
    await readSse(await POST(req({ agent: 'codex' }, ac.signal), context(p.id)));
    await wait(() => getRun(p.id) === null);
    expect(getDocument(p.id, '0-PRODUCT.md')!.content).toBe('');
  });
  it('cancel waits for active CLI and retains previously saved document', async () => {
    const p = project(); fake();
    vi.mocked(codexAdapter.run).mockImplementationOnce(async () => ({ text: '[a](requirements/a.md)', sessionId: 'batch-test' }))
      .mockImplementationOnce(async ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true })));
    const res = await POST(req(), context(p.id));
    await wait(() => getRun(p.id)?.path === '1-SYSTEM-ARCHITECTURE.md');
    expect((await DELETE(req(), context(p.id))).status).toBe(204);
    await readSse(res);
    expect(getDocument(p.id, '0-PRODUCT.md')!.content).not.toBe('');
    expect(getDocument(p.id, '1-SYSTEM-ARCHITECTURE.md')!.content).toBe('');
    await cancelRun(p.id);
  });
  it('body changes flag downstream drafts atomically; no-op save and undo do not', async () => {
    const p = project();
    updateDocument(p.id, '0-PRODUCT.md', { content: 'original', previousContent: 'original', status: 'draft' });
    updateDocument(p.id, '1-SYSTEM-ARCHITECTURE.md', { content: 'retained', status: 'draft' });
    await PUT(jsonReq('PUT', 'http://localhost/api', { content: 'original' }), dc(p.id, '0-PRODUCT.md'));
    await undo(req(), dc(p.id, '0-PRODUCT.md'));
    expect(getDocument(p.id, '1-SYSTEM-ARCHITECTURE.md')!.upstreamChanged).toBe(false);
    await PUT(jsonReq('PUT', 'http://localhost/api', { content: '[a](requirements/a.md)' }), dc(p.id, '0-PRODUCT.md'));
    expect(getDocument(p.id, '1-SYSTEM-ARCHITECTURE.md')!.upstreamChanged).toBe(true);
    expect((await POST(req(), context(p.id))).status).toBe(409);
  });
  it('rejects retained invalid USERFLOW links before any agent call', async () => {
    const p = project(); fake();
    updateDocument(p.id, '4-USERFLOW.md', { content: '[bad](screens/Bad_Name.html)', status: 'draft' });
    expect((await POST(req(), context(p.id))).status).toBe(409);
    expect(codexAdapter.run).not.toHaveBeenCalled();
  });
  it('batch lock protects all document, design and interview mutation surfaces', async () => {
    const p = project();
    const handle = acquireRun(p.id, 'batch', null)!;
    try {
      const responses = await Promise.all([
        PUT(jsonReq('PUT', 'http://localhost/api', { content: 'x' }), dc(p.id, '3-DATABASE.md')),
        undo(req(), dc(p.id, '3-DATABASE.md')), deleteDoc(req(), dc(p.id, '3-DATABASE.md')),
        approveDoc(req(), dc(p.id, '3-DATABASE.md')), unapproveDoc(req(), dc(p.id, '3-DATABASE.md')),
        design(jsonReq('PUT', 'http://localhost/api', { designMd: '# design' }), context(p.id)),
        interviewSummary(jsonReq('PUT', 'http://localhost/api', { summary: 'x' }), context(p.id)),
        interviewSkip(req(), context(p.id)), interviewApprove(req(), context(p.id)), interviewUnapprove(req(), context(p.id)),
      ]);
      for (const response of responses) { expect(response.status).toBe(409); expect((await response.json()).code).toBe('busy'); }
    } finally { handle.release(); }
  });
  it('approval validates invalid later draft before changing any status and ignores obsolete rows', async () => {
    const p = project(); fake(); await run(p.id);
    insertEmptyDocuments(p.id, ['requirements/obsolete.md']);
    updateDocument(p.id, '4-USERFLOW.md', { content: '[bad](screens/Bad.html)' });
    let response = await approve(req({ reviewToken: batchView(p.id)!.reviewToken }), context(p.id));
    expect(response.status).toBe(409);
    expect(listDocuments(p.id).some((d) => d.status === 'approved')).toBe(false);
    updateDocument(p.id, '4-USERFLOW.md', { content: '# flow' });
    response = await approve(req({ reviewToken: batchView(p.id)!.reviewToken }), context(p.id));
    expect(response.status).toBe(200);
    expect((await response.json()).approved).not.toContain('requirements/obsolete.md');
    expect(getDocument(p.id, 'requirements/obsolete.md')!.status).toBe('empty');
  });

  it('reconstructs persisted partial without runtime history, preserves approved and edited drafts byte-for-byte', async () => {
    const p = project(); fake();
    updateDocument(p.id, '0-PRODUCT.md', { content: '[manual](requirements/manual.md)\n', status: 'approved' });
    updateDocument(p.id, '1-SYSTEM-ARCHITECTURE.md', { content: '# edited draft\n  keep spacing\n', status: 'draft' });
    const before = listDocuments(p.id).filter((d) => d.content);
    expect(getRun(p.id)).toBeNull();
    expect(batchView(p.id)).toMatchObject({ state: 'partial', error: null, completedPaths: ['0-PRODUCT.md', '1-SYSTEM-ARCHITECTURE.md'] });
    await run(p.id);
    for (const retained of before) expect(getDocument(p.id, retained.path)).toEqual(retained);
    const targets = vi.mocked(codexAdapter.run).mock.calls.map(([input]) => /대상 문서: (.*)/.exec(input.prompt)![1]);
    expect(targets).not.toContain('0-PRODUCT.md'); expect(targets).not.toContain('1-SYSTEM-ARCHITECTURE.md');
  });
  it('invalid persisted PRODUCT never reports completed or commits approvals', async () => {
    const p = project();
    for (const d of listDocuments(p.id)) updateDocument(p.id, d.path, { content: '# invalid', status: 'draft' });
    expect(batchView(p.id)!.state).toBe('partial');
    expect((await POST(req(), context(p.id))).status).toBe(409);
    expect((await approve(req({ reviewToken: batchView(p.id)!.reviewToken }), context(p.id))).status).toBe(409);
    expect(listDocuments(p.id).every((d) => d.status === 'draft')).toBe(true);
  });
  it('explicit regeneration flags downstream draft body and project deletion cancels active batch before removal', async () => {
    const p = project(); fake();
    updateDocument(p.id, '0-PRODUCT.md', { content: 'old', status: 'draft' });
    updateDocument(p.id, '1-SYSTEM-ARCHITECTURE.md', { content: 'retained', status: 'draft' });
    await readSse(await generateDoc(req(), dc(p.id, '0-PRODUCT.md')));
    expect(getDocument(p.id, '1-SYSTEM-ARCHITECTURE.md')!.upstreamChanged).toBe(true);
    const fresh = project();
    vi.mocked(codexAdapter.run).mockImplementationOnce(async ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancel')), { once: true })));
    const response = await POST(req(), context(fresh.id));
    await wait(() => getRun(fresh.id)?.path === '0-PRODUCT.md');
    expect((await deleteProject(req(), context(fresh.id))).status).toBe(204);
    await readSse(response);
    expect(getRun(fresh.id)).toBeNull(); expect(batchView(fresh.id)).toBeNull();
  });

});
