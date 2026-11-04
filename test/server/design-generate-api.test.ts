import { afterEach, describe, expect, it, vi } from 'vitest';
import { docApiPath } from '@/lib/contract';
import { codexAdapter } from '@/server/agents/codex';
import { createInterview, createProject, getProject, insertEmptyDocuments, updateDocument } from '@/server/db';
import { acquireRun, getRun } from '@/server/runtime';
import { POST as designPOST } from '@/app/api/projects/[id]/design/generate/route';
import { POST as generatePOST } from '@/app/api/projects/[id]/documents/[path]/generate/route';
import { ctx, jsonReq, readSse } from '../helpers/route';

afterEach(() => vi.restoreAllMocks());

const BASE = 'http://127.0.0.1:3000';

// 요구사항 승인까지 끝나고 화면 목록이 있는 프로젝트
function ready(designMd: string | null = null) {
  const p = createProject({ name: 'p', idea: '아이디어', designMd });
  createInterview(p.id, null, 'skipped');
  updateDocument(p.id, '0-PRODUCT.md', { content: '[p](requirements/project.md)', status: 'approved' });
  insertEmptyDocuments(p.id, ['requirements/project.md', 'screens/home.html', 'screens/detail.html']);
  updateDocument(p.id, 'requirements/project.md', { content: '# project', status: 'approved' });
  updateDocument(p.id, '4-USERFLOW.md', { content: '[홈](screens/home.html) [상세](screens/detail.html)', status: 'approved' });
  return p;
}

function design(id: number, body: Record<string, unknown>, signal?: AbortSignal) {
  return designPOST(jsonReq('POST', `${BASE}/api/projects/${id}/design/generate`, body, signal), ctx({ id: String(id) }));
}

function generateScreen(id: number, path: string) {
  return generatePOST(
    jsonReq('POST', `${BASE}${docApiPath(id, path, 'generate')}`, { agent: 'codex' }),
    ctx({ id: String(id), path }),
  );
}

// 어댑터를 그대로 부르면서 넘어간 프롬프트를 모은다.
function capturePrompts(): string[] {
  const prompts: string[] = [];
  const original = codexAdapter.run.bind(codexAdapter);
  vi.spyOn(codexAdapter, 'run').mockImplementation(async (i) => {
    prompts.push(i.prompt);
    return original(i);
  });
  return prompts;
}

async function waitUntil(cond: () => boolean, ms = 10000) {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('디자인 문서 생성', () => {
  it('결과를 done으로 주고 저장하지 않으며 잠금을 푼다', async () => {
    const p = ready();
    const events = await readSse(await design(p.id, { agent: 'codex' }));
    expect(events.at(-1)).toMatchObject({ event: 'done' });
    expect(events.at(-1)?.data.text).toContain('# 2-DESIGN.md');
    expect(events.at(-1)?.data.text).not.toContain('```');
    expect(getProject(p.id)?.designMd).toBeNull();
    expect(getRun(p.id)).toBeNull();
  });

  it('화면에서 다듬던 작업본(base)을 저장본보다 우선해 반영한다', async () => {
    const p = ready('# 저장본');
    const prompts = capturePrompts();
    await readSse(await design(p.id, { agent: 'codex', base: '# 작업본' }));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('## 기준 디자인 문서\n# 작업본');
    expect(prompts[0]).not.toContain('# 저장본');
    expect(prompts[0]).toContain('### requirements/project.md\n# project');
  });

  it('base를 보내지 않으면 저장된 디자인 문서를 반영한다', async () => {
    const p = ready('# 저장본');
    const prompts = capturePrompts();
    await readSse(await design(p.id, { agent: 'codex' }));
    expect(prompts[0]).toContain('## 기준 디자인 문서\n# 저장본');
  });

  it('빈 작업본이면 기준 없이 새로 만든다', async () => {
    const p = ready('# 저장본');
    const prompts = capturePrompts();
    await readSse(await design(p.id, { agent: 'codex', base: '' }));
    expect(prompts[0]).toContain('기준이 되는 디자인 문서가 없다');
    expect(prompts[0]).not.toContain('# 저장본');
  });

  it('피드백은 기준 문서가 있을 때만 받는다', async () => {
    const none = await design(ready().id, { agent: 'codex', feedback: '둥글게' });
    expect(none.status).toBe(400);
    expect((await none.json()).code).toBe('invalid_input');

    const p = ready('# 저장본');
    const prompts = capturePrompts();
    await readSse(await design(p.id, { agent: 'codex', feedback: '둥글게' }));
    expect(prompts[0]).toContain('## 피드백\n둥글게');
  });

  it('요구사항 문서를 모두 승인하기 전에는 precondition', async () => {
    const p = ready();
    updateDocument(p.id, 'requirements/project.md', { status: 'draft' });
    const res = await design(p.id, { agent: 'codex' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('precondition');
    expect(getRun(p.id)).toBeNull();
  });

  it('저장소 프로젝트는 승인된 문서 없이도 만들 수 있고, 클론이 없으면 실행 전에 멈춘다', async () => {
    const p = createProject({ name: 'r', idea: '', designMd: null, repo: 'owner/repo' });
    const events = await readSse(await design(p.id, { agent: 'codex' }));
    expect(events.at(-1)).toMatchObject({ event: 'error', data: { code: 'agent_failed' } });
    expect(events.at(-1)?.data.message).toContain('클론');
    expect(getRun(p.id)).toBeNull();
  });

  it('없는 프로젝트와 잘못된 입력', async () => {
    expect((await design(9999, { agent: 'codex' })).status).toBe(404);
    const p = ready();
    expect((await design(p.id, { agent: 'gpt' })).status).toBe(400);
    expect((await design(p.id, { agent: 'codex', base: 1 })).status).toBe(400);
    expect((await design(p.id, { agent: 'codex', feedback: 1 })).status).toBe(400);
  });

  it('다른 작업이 돌고 있으면 busy', async () => {
    const p = ready();
    const other = acquireRun(p.id, 'document', '0-PRODUCT.md')!;
    const res = await design(p.id, { agent: 'codex' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('busy');
    other.release();
  });

  it('실행 중에는 design 종류로 잠그고, 연결이 끊기면 푼다', async () => {
    process.env.FAKE_MODE = 'slow';
    const p = ready();
    const ac = new AbortController();
    const res = await design(p.id, { agent: 'codex' }, ac.signal);
    await waitUntil(() => getRun(p.id)?.kind === 'design');
    ac.abort();
    await readSse(res);
    await waitUntil(() => getRun(p.id) === null);
    expect(getProject(p.id)?.designMd).toBeNull();
  });
});

describe('기준 화면', () => {
  it('승인된 다른 화면이 있으면 새 화면 프롬프트에 그 HTML을 넣는다', async () => {
    const p = ready('# 디자인');
    updateDocument(p.id, 'screens/home.html', { content: '<main data-component="anchor-list"></main>', status: 'approved' });
    const prompts = capturePrompts();
    await readSse(await generateScreen(p.id, 'screens/detail.html'));
    expect(prompts[0]).toContain('## 기준 화면 (screens/home.html, 승인됨)');
    expect(prompts[0]).toContain('<main data-component="anchor-list"></main>');
  });

  it('승인되기 전의 화면은 기준이 아니다', async () => {
    const p = ready('# 디자인');
    updateDocument(p.id, 'screens/home.html', { content: '<main data-component="anchor-list"></main>', status: 'draft' });
    const prompts = capturePrompts();
    await readSse(await generateScreen(p.id, 'screens/detail.html'));
    expect(prompts[0]).not.toContain('## 기준 화면');
  });
});
