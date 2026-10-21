import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { BASE_DOCS, BASELINE_DOC, CHANGE_DOC } from '@/lib/contract';
import {
  addMessage,
  createInterview,
  createProject,
  deleteDocument,
  deleteProject,
  flagUpstream,
  getDb,
  getDocument,
  getProject,
  insertEmptyDocuments,
  listDocuments,
  listMessages,
  listProjects,
  setDesign,
  tx,
  updateDocument,
  updateInterview,
} from '@/server/db';
import { dataDir } from '@/server/env';

const EXPECTED_PATHS = [...BASE_DOCS, CHANGE_DOC].sort();

const countWhere = (sql: string, ...args: unknown[]) =>
  (getDb().prepare(sql).get(...args) as { n: number }).n;

describe('DB 모듈', () => {
  it('데이터 폴더는 임시 폴더 아래다 (./data를 쓰지 않는다)', () => {
    expect(path.resolve(dataDir()).startsWith(path.resolve(os.tmpdir()))).toBe(true);
  });

  it('createProject는 문서 5개를 empty로 만든다', () => {
    const p = createProject({ name: 'a', idea: 'b', designMd: null });
    const docs = listDocuments(p.id);
    expect(docs.map((d) => d.path).sort()).toEqual(EXPECTED_PATHS);
    expect(docs.every((d) => d.status === 'empty' && d.content === '' && !d.upstreamChanged)).toBe(true);
  });

  it('repo가 있으면 기준 문서와 changes/001-baseline.md를 만들고 repo를 돌려준다', () => {
    const p = createProject({ name: 'r', idea: '', designMd: null, repo: 'octo/app' });
    expect(p.repo).toBe('octo/app');
    expect(listDocuments(p.id).map((d) => d.path).sort()).toEqual([...BASE_DOCS, BASELINE_DOC].sort());
    expect(getProject(p.id)?.repo).toBe('octo/app');
  });

  it('repo가 없으면 repo는 null이고 changes/001-mvp.md를 만든다', () => {
    const p = createProject({ name: 's', idea: 't', designMd: null });
    expect(p.repo).toBeNull();
    expect(getDocument(p.id, CHANGE_DOC)).toBeDefined();
  });

  it('repo 열이 없는 옛 DB를 열면 열을 추가하고 기존 행을 유지한다', () => {
    const prev = process.env.SDDMAKER_DATA_DIR;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sddmaker-old-'));
    getDb().close();
    delete globalThis.__sddmakerDb;
    process.env.SDDMAKER_DATA_DIR = dir;
    try {
      const old = new Database(path.join(dir, 'sddmaker.db'));
      old.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, idea TEXT NOT NULL,
        design_md TEXT, created_at TEXT NOT NULL);
        INSERT INTO projects (name, idea, created_at) VALUES ('old', 'i', '2020-01-01T00:00:00.000Z');`);
      old.close();
      const rows = listProjects();
      expect(rows.map((r) => [r.name, r.repo])).toEqual([['old', null]]);
    } finally {
      getDb().close();
      delete globalThis.__sddmakerDb;
      if (prev === undefined) delete process.env.SDDMAKER_DATA_DIR;
      else process.env.SDDMAKER_DATA_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deleteProject는 인터뷰·메시지·문서를 함께 지운다 (CASCADE)', () => {
    const p = createProject({ name: 'c', idea: 'd', designMd: null });
    const iv = createInterview(p.id, 'claude', 'active');
    addMessage(iv.id, 'agent', '질문');
    expect(deleteProject(p.id)).toBe(true);
    expect(getProject(p.id)).toBeUndefined();
    expect(countWhere('SELECT COUNT(*) AS n FROM documents WHERE project_id = ?', p.id)).toBe(0);
    expect(countWhere('SELECT COUNT(*) AS n FROM interviews WHERE project_id = ?', p.id)).toBe(0);
    expect(countWhere('SELECT COUNT(*) AS n FROM interview_messages WHERE interview_id = ?', iv.id)).toBe(0);
  });

  it('(project_id, path) 중복 insert는 무시된다', () => {
    const p = createProject({ name: 'e', idea: 'f', designMd: null });
    insertEmptyDocuments(p.id, ['0-PRODUCT.md', '0-PRODUCT.md']);
    expect(listDocuments(p.id)).toHaveLength(5);
  });

  it('잘못된 status는 CHECK로 throw한다', () => {
    const p = createProject({ name: 'g', idea: 'h', designMd: null });
    expect(() => createInterview(p.id, 'claude', 'bogus' as never)).toThrow();
  });

  it('tx 안에서 throw하면 updateDocument 변경이 롤백된다', () => {
    const p = createProject({ name: 'i', idea: 'j', designMd: null });
    updateDocument(p.id, '0-PRODUCT.md', { content: '원본', status: 'draft' });
    expect(() =>
      tx(() => {
        updateDocument(p.id, '0-PRODUCT.md', { content: '바뀜', status: 'approved' });
        throw new Error('중간 실패');
      }),
    ).toThrow('중간 실패');
    const d = getDocument(p.id, '0-PRODUCT.md');
    expect(d?.content).toBe('원본');
    expect(d?.status).toBe('draft');
  });

  it('db를 닫고 캐시를 지운 뒤 다시 열어도 데이터가 남는다', () => {
    const p = createProject({ name: 'k', idea: 'l', designMd: '디자인' });
    getDb().close();
    delete globalThis.__sddmakerDb;
    expect(getProject(p.id)?.designMd).toBe('디자인');
  });

  it('setDesign·updateInterview·flagUpstream·deleteDocument가 값을 저장한다', () => {
    const p = createProject({ name: 'm', idea: 'n', designMd: null });
    expect(setDesign(p.id, '디자인').designMd).toBe('디자인');
    const iv = createInterview(p.id, null, 'active');
    expect(updateInterview(p.id, { agent: 'codex', sessionId: 's1', status: 'summarized' })).toMatchObject({
      id: iv.id,
      agent: 'codex',
      sessionId: 's1',
      status: 'summarized',
    });
    flagUpstream(p.id, ['4-USERFLOW.md']);
    expect(getDocument(p.id, '4-USERFLOW.md')?.upstreamChanged).toBe(true);
    deleteDocument(p.id, CHANGE_DOC);
    expect(getDocument(p.id, CHANGE_DOC)).toBeUndefined();
  });

  it('listProjects는 최신순이고 인터뷰 상태를 붙인다', () => {
    const a = createProject({ name: 'older-x', idea: 'o', designMd: null });
    const b = createProject({ name: 'newer-x', idea: 'p', designMd: null });
    createInterview(b.id, 'claude', 'skipped');
    const rows = listProjects().filter((r) => r.id === a.id || r.id === b.id);
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(rows[0].interviewStatus).toBe('skipped');
    expect(rows[1].interviewStatus).toBeNull();
  });

  it('메시지는 생성 순서대로 돌려준다', () => {
    const p = createProject({ name: 'q', idea: 'r', designMd: null });
    const iv = createInterview(p.id, 'claude', 'active');
    addMessage(iv.id, 'agent', '첫 질문');
    addMessage(iv.id, 'user', '답');
    expect(listMessages(iv.id).map((m) => m.content)).toEqual(['첫 질문', '답']);
  });
});
