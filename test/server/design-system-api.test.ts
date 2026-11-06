import { afterEach, describe, expect, it, vi } from 'vitest';
import { codexAdapter } from '@/server/agents/codex';
import { createInterview, createProject, getProject, insertEmptyDocuments, setDesignHtml, updateDocument } from '@/server/db';
import { exportFiles } from '@/server/export';
import { getRun } from '@/server/runtime';
import { generationPrompt } from '@/server/documents';
import { POST } from '@/app/api/projects/[id]/design/system/route';
import { ctx, jsonReq, readSse } from '../helpers/route';

afterEach(() => vi.restoreAllMocks());

const DESIGN = '---\nname: t\ncolors:\n  primary: "#2285E8"\n---\n\n# Overview\n';

function ready(designMd: string | null = DESIGN) {
  const p = createProject({ name: 'p', idea: 'i', designMd, repo: null });
  createInterview(p.id, null, 'skipped');
  updateDocument(p.id, '0-PRODUCT.md', { content: '[r](requirements/r.md)', status: 'approved' });
  updateDocument(p.id, '4-USERFLOW.md', { content: '[홈](screens/home.html)', status: 'approved' });
  insertEmptyDocuments(p.id, ['requirements/r.md', 'screens/home.html']);
  updateDocument(p.id, 'requirements/r.md', { content: '# r 요구사항', status: 'approved' });
  return p;
}
const gen = (id: number, body: Record<string, unknown> = { agent: 'codex' }) =>
  POST(jsonReq('POST', `http://127.0.0.1:3000/api/projects/${id}/design/system`, body), ctx({ id: String(id) }));

function capturePrompts(): string[] {
  const prompts: string[] = [];
  const original = codexAdapter.run.bind(codexAdapter);
  vi.spyOn(codexAdapter, 'run').mockImplementation(async (i) => {
    prompts.push(i.prompt);
    return original(i);
  });
  return prompts;
}

describe('디자인 시스템 페이지', () => {
  it('디자인 문서가 없으면 409', async () => {
    const res = await gen(ready(null).id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('design_required');
  });

  it('페이지가 없으면 피드백으로 다시 만들 수 없다', async () => {
    expect((await gen(ready().id, { agent: 'codex', feedback: '더 크게' })).status).toBe(400);
  });

  it('토큰 CSS와 요구사항을 넣어 만들고 서버가 저장한다', async () => {
    const p = ready();
    const prompts = capturePrompts();
    const events = await readSse(await gen(p.id));
    expect(events.at(-1)).toMatchObject({ event: 'done' });
    expect(prompts[0].split('\n')[0]).toBe('대상 문서: 2-DESIGN.html');
    expect(prompts[0]).toContain('--colors-primary: #2285E8;');
    expect(prompts[0]).toContain('### requirements/r.md\n# r 요구사항');
    expect(getProject(p.id)?.designHtml).toContain('data-component="button-primary"');
    expect(getRun(p.id)).toBeNull();
  });

  it('피드백이 있으면 현재 페이지를 함께 보낸다', async () => {
    const p = ready();
    setDesignHtml(p.id, '<html><body>현재 페이지</body></html>');
    const prompts = capturePrompts();
    await readSse(await gen(p.id, { agent: 'codex', feedback: '버튼을 키운다' }));
    expect(prompts[0]).toContain('## 현재 페이지\n<html><body>현재 페이지</body></html>');
    expect(prompts[0]).toContain('## 피드백\n버튼을 키운다');
  });

  it('스크립트가 든 결과는 저장하지 않는다', async () => {
    const p = ready();
    vi.spyOn(codexAdapter, 'run').mockResolvedValue({ text: '```html\n<html><body><script>x()</script></body></html>\n```', sessionId: 's' });
    const events = await readSse(await gen(p.id));
    expect(events.at(-1)).toMatchObject({ event: 'error' });
    expect(getProject(p.id)?.designHtml).toBeNull();
  });

  it('화면 생성 프롬프트에 토큰 CSS와 디자인 시스템 페이지가 들어간다', () => {
    const p = ready();
    expect(generationPrompt(p.id, 'screens/home.html')).not.toContain('## 디자인 시스템 페이지');
    setDesignHtml(p.id, '<html><body><button data-component="button-primary">저장</button></body></html>');
    const prompt = generationPrompt(p.id, 'screens/home.html');
    expect(prompt).toContain('## 디자인 토큰 CSS');
    expect(prompt).toContain('--colors-primary: #2285E8;');
    expect(prompt).toContain('## 디자인 시스템 페이지 (2-DESIGN.html)');
    expect(prompt).toContain('data-component="button-primary"');
    expect(generationPrompt(p.id, 'requirements/r.md')).not.toContain('## 디자인 토큰 CSS');
  });

  it('머리말 없는 디자인 문서면 페이지가 :root 토큰을 정하게 하고, 화면은 그 토큰을 받는다', async () => {
    const p = ready('# Starbucks 스타일\n\n초록 #00754A');
    const prompts = capturePrompts();
    await readSse(await gen(p.id));
    expect(prompts[0]).toContain('`:root` CSS 변수');
    expect(prompts[0]).not.toContain('## 디자인 토큰 CSS');
    setDesignHtml(p.id, '<html><head><style>:root { --color-primary: #00754A; }</style></head></html>');
    expect(generationPrompt(p.id, 'screens/home.html')).toContain(':root { --color-primary: #00754A; }');
  });

  it('내보내기에 토큰 CSS와 페이지가 들어간다', () => {
    const files = exportFiles({ designMd: DESIGN, designHtml: '<html></html>', docs: [], rules: 'r' }).map((f) => f.path);
    expect(files).toEqual(['docs/AGENTS.md', 'docs/2-DESIGN.md', 'docs/2-DESIGN.tokens.css', 'docs/2-DESIGN.html']);
    expect(exportFiles({ designMd: '# 머리말 없음', docs: [], rules: 'r' }).map((f) => f.path)).toEqual(['docs/AGENTS.md', 'docs/2-DESIGN.md']);
  });
});
