import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/projects/[id]/export/route';
import { exportFileName } from '@/server/export';
import { createProject, insertEmptyDocuments, updateDocument } from '@/server/db';
import { ctx, jsonReq } from '../helpers/route';

const CONTENT: Record<string, string> = {
  '0-PRODUCT.md': '# 제품\n\n- [프로젝트](requirements/project.md)\n',
  '1-SYSTEM-ARCHITECTURE.md': '# 시스템\n',
  '3-DATABASE.md': '# 데이터\n',
  '4-USERFLOW.md': '# 흐름\n\n- [홈](screens/home.html)\n',
  'changes/001-mvp.md': '# 변경\n',
  'requirements/project.md': '# 프로젝트 요구사항\n',
  'screens/home.html': '<!DOCTYPE html><html data-frame="page"><body></body></html>',
};

function setup(name: string, designMd: string | null, approve: boolean) {
  const p = createProject({ name, idea: 'idea', designMd });
  insertEmptyDocuments(p.id, ['requirements/project.md', 'screens/home.html']);
  for (const [path, content] of Object.entries(CONTENT)) {
    updateDocument(p.id, path, { content, status: approve ? 'approved' : 'draft' });
  }
  return p;
}

function download(id: number) {
  return GET(jsonReq('GET', 'http://127.0.0.1:3000/x'), ctx({ id: String(id) }));
}

describe('exportFileName', () => {
  it('문자·숫자·-·_ 밖의 글자를 -로 바꾸고 한글은 RFC 5987로 적는다', () => {
    const { ascii, encoded } = exportFileName('나의 앱 v2');
    expect(encoded).toBe('%EB%82%98%EC%9D%98-%EC%95%B1-v2-docs.zip');
    expect(ascii).toMatch(/^[A-Za-z0-9_-]+-docs\.zip$/);
    expect(ascii).toBe('-----v2-docs.zip');
  });
});

describe('GET /api/projects/:id/export', () => {
  it('미승인 문서가 있으면 409 export_blocked와 그 문서 경로', async () => {
    const p = setup('app', null, false);
    const res = await download(p.id);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; items: string[] };
    expect(body.code).toBe('export_blocked');
    expect(body.items).toContain('requirements/project.md');
    expect(body.items).toContain('0-PRODUCT.md');
  });

  it('전부 승인되면 docs/ 구조와 승인된 본문을 zip으로 준다 (디자인 없음)', async () => {
    const p = setup('app', null, true);
    const res = await download(p.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="app-docs.zip"; filename*=UTF-8''app-docs.zip`);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(names).toEqual(
      [
        'docs/AGENTS.md',
        'docs/0-PRODUCT.md',
        'docs/1-SYSTEM-ARCHITECTURE.md',
        'docs/3-DATABASE.md',
        'docs/4-USERFLOW.md',
        'docs/changes/001-mvp.md',
        'docs/requirements/project.md',
        'docs/screens/home.html',
      ].sort(),
    );
    expect(await zip.file('docs/AGENTS.md')?.async('string')).toBe(
      fs.readFileSync(path.resolve('docs/AGENTS.md'), 'utf8'),
    );
    expect(await zip.file('docs/requirements/project.md')?.async('string')).toBe(CONTENT['requirements/project.md']);
    expect(await zip.file('docs/screens/home.html')?.async('string')).toBe(CONTENT['screens/home.html']);
  });

  it('디자인 문서가 있으면 docs/2-DESIGN.md를 원문 그대로 넣는다', async () => {
    const design = '# 디자인\n\n- 색: #123456';
    const p = setup('app2', design, true);
    const zip = await JSZip.loadAsync(await (await download(p.id)).arrayBuffer());
    expect(await zip.file('docs/2-DESIGN.md')?.async('string')).toBe(design);
  });

  it('한글 프로젝트 이름은 filename*=UTF-8 헤더로 준다', async () => {
    const p = setup('나의 앱 v2', null, true);
    const res = await download(p.id);
    expect(res.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${exportFileName('나의 앱 v2').ascii}"; filename*=UTF-8''%EB%82%98%EC%9D%98-%EC%95%B1-v2-docs.zip`,
    );
  });

  it('없는 프로젝트는 404', async () => {
    expect((await download(987654)).status).toBe(404);
  });
});
