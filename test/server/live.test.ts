import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject, getDocument, insertEmptyDocuments, updateDocument } from '@/server/db';
import { changedScreens, importLive, liveDir, liveStatus, prepareWorkspace, setLiveForTest } from '@/server/live';
import { GET as screenGET } from '@/app/screens/[file]/route';
import { ctx } from '../helpers/route';

afterEach(() => setLiveForTest(null));

const A = '<!DOCTYPE html><html><body><h1>A</h1></body></html>';
const INJECTED = (html: string) => html.replace('</body>', '<!-- impeccable-live-start -->\n<script src="http://localhost:8400/live.js?token=t"></script>\n<!-- impeccable-live-end -->\n</body>');

function project() {
  const p = createProject({ name: 'p', idea: 'i', designMd: '# 디자인', repo: null });
  updateDocument(p.id, '0-PRODUCT.md', { content: '# 제품', status: 'approved' });
  insertEmptyDocuments(p.id, ['screens/a.html', 'screens/b.html', 'screens/c.html']);
  updateDocument(p.id, 'screens/a.html', { content: A, status: 'draft' });
  updateDocument(p.id, 'screens/b.html', { content: A.replace('A', 'B'), status: 'approved' });
  return p; // c는 비어 있어 내보내지 않는다
}
const file = (id: number, p: string) => path.join(liveDir(id), p);

describe('impeccable live 작업 폴더', () => {
  it('본문이 있는 화면과 PRODUCT·DESIGN·설정을 내보낸다', () => {
    const p = project();
    const dir = prepareWorkspace(p.id);
    expect(fs.readFileSync(path.join(dir, 'screens/a.html'), 'utf8')).toBe(A);
    expect(fs.existsSync(path.join(dir, 'screens/c.html'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'DESIGN.md'), 'utf8')).toBe('# 디자인');
    expect(fs.readFileSync(path.join(dir, 'PRODUCT.md'), 'utf8')).toBe('# 제품');
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.impeccable/live/config.json'), 'utf8')).files).toEqual(['screens/*.html']);
  });

  it('주입된 스크립트만으로는 변경이 아니고, 가져오지 않은 변경은 다시 내보내도 지킨다', () => {
    const p = project();
    prepareWorkspace(p.id);
    fs.writeFileSync(file(p.id, 'screens/a.html'), INJECTED(A));
    expect(changedScreens(p.id)).toEqual([]);
    fs.writeFileSync(file(p.id, 'screens/a.html'), INJECTED(A.replace('<h1>A</h1>', '<h1>새 A</h1>')));
    expect(changedScreens(p.id)).toEqual(['screens/a.html']);
    prepareWorkspace(p.id);
    expect(fs.readFileSync(file(p.id, 'screens/a.html'), 'utf8')).toContain('새 A');
    expect(liveStatus(p.id).changed).toEqual(['screens/a.html']);
  });

  it('가져오기는 주입을 지우고 저장하며 되돌리기를 남긴다. 승인된 화면과 그 사이 앱에서 바뀐 화면은 건너뛴다', () => {
    const p = project();
    insertEmptyDocuments(p.id, ['screens/d.html']);
    updateDocument(p.id, 'screens/d.html', { content: A.replace('A', 'D'), status: 'draft' });
    prepareWorkspace(p.id);
    fs.writeFileSync(file(p.id, 'screens/a.html'), INJECTED(A.replace('<h1>A</h1>', '<h1>새 A</h1>')));
    fs.writeFileSync(file(p.id, 'screens/b.html'), A.replace('A', '새 B'));
    fs.writeFileSync(file(p.id, 'screens/d.html'), A.replace('A', '새 D'));
    updateDocument(p.id, 'screens/d.html', { content: A.replace('A', '앱에서 바꾼 D') });

    const r = importLive(p.id);
    expect(r.saved).toEqual(['screens/a.html']);
    expect(r.skipped.map((s) => s.path)).toEqual(['screens/b.html', 'screens/d.html']);
    const a = getDocument(p.id, 'screens/a.html')!;
    expect(a.content).toContain('새 A');
    expect(a.content).not.toContain('live.js');
    expect(a.previousContent).toBe(A);
    expect(changedScreens(p.id)).toEqual(['screens/b.html', 'screens/d.html']); // 가져온 화면은 기준이 된다
  });

  it('변형을 고르는 중이거나 스크립트가 든 화면은 가져오지 않는다', () => {
    const p = project();
    prepareWorkspace(p.id);
    fs.writeFileSync(file(p.id, 'screens/a.html'), A.replace('<h1>A</h1>', '<div data-impeccable-variant="1"><h1>v</h1></div>'));
    expect(importLive(p.id).skipped[0].reason).toContain('Accept');
    fs.writeFileSync(file(p.id, 'screens/a.html'), A.replace('<h1>A</h1>', '<script>x()</script>'));
    expect(importLive(p.id).skipped[0].reason).toContain('스크립트');
    expect(getDocument(p.id, 'screens/a.html')!.content).toBe(A);
  });
});

describe('GET /screens/:file', () => {
  it('열린 세션의 화면만 주고, 이름 규칙에 맞지 않으면 404다', async () => {
    const p = project();
    prepareWorkspace(p.id);
    const get = (f: string) => screenGET(new Request(`http://127.0.0.1:3000/screens/${f}`), ctx({ file: f }));
    expect((await get('a.html')).status).toBe(404); // 세션 없음
    setLiveForTest({ projectId: p.id, agent: 'claude' });
    const ok = await get('a.html');
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe(A);
    expect((await get('..%2F.sddmaker-baseline.json')).status).toBe(404);
    expect((await get('nope.html')).status).toBe(404);
  });
});
