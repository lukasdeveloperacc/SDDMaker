import fs from 'node:fs';
import Database from 'better-sqlite3';
import {
  BASE_DOCS,
  CHANGE_DOC,
  type AgentName,
  type DocumentRecord,
  type InterviewMessage,
  type InterviewRecord,
  type InterviewStatus,
  type MessageRole,
  type Project,
} from '@/lib/contract';
import { dataDir, dbFile } from '@/server/env';
import { SCHEMA_SQL } from './schema';

declare global {
  var __sddmakerDb: { file: string; db: Database.Database } | undefined;
}

export function getDb(): Database.Database {
  const file = dbFile();
  const cached = globalThis.__sddmakerDb;
  if (cached && cached.file === file) return cached.db;
  if (cached) cached.db.close();
  fs.mkdirSync(dataDir(), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  globalThis.__sddmakerDb = { file, db };
  return db;
}

// 여러 행 쓰기를 한 묶음으로 (실패하면 전부 되돌린다).
export function tx<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

const now = () => new Date().toISOString();

interface ProjectRow {
  id: number; name: string; idea: string; design_md: string | null; created_at: string;
}
function toProject(r: ProjectRow): Project {
  return { id: r.id, name: r.name, idea: r.idea, designMd: r.design_md, createdAt: r.created_at };
}

interface InterviewRow {
  id: number; project_id: number; agent: AgentName | null; session_id: string | null;
  summary: string | null; status: InterviewStatus;
}
function toInterview(r: InterviewRow): InterviewRecord {
  return {
    id: r.id, projectId: r.project_id, agent: r.agent, sessionId: r.session_id,
    summary: r.summary, status: r.status,
  };
}

interface MessageRow { id: number; role: MessageRole; content: string; created_at: string }
function toMessage(r: MessageRow): InterviewMessage {
  return { id: r.id, role: r.role, content: r.content, createdAt: r.created_at };
}

interface DocumentRow {
  project_id: number; path: string; content: string; previous_content: string | null;
  status: DocumentRecord['status']; upstream_changed: number; agent: AgentName | null; updated_at: string;
}
function toDocument(r: DocumentRow): DocumentRecord {
  return {
    projectId: r.project_id, path: r.path, content: r.content, previousContent: r.previous_content,
    status: r.status, upstreamChanged: r.upstream_changed === 1, agent: r.agent, updatedAt: r.updated_at,
  };
}

export function createProject(i: { name: string; idea: string; designMd: string | null }): Project {
  return tx(() => {
    const info = getDb()
      .prepare('INSERT INTO projects (name, idea, design_md, created_at) VALUES (?, ?, ?, ?)')
      .run(i.name, i.idea, i.designMd, now());
    const id = Number(info.lastInsertRowid);
    insertEmptyDocuments(id, [...BASE_DOCS, CHANGE_DOC]);
    return getProject(id) as Project;
  });
}

export function listProjects(): (Project & { interviewStatus: InterviewStatus | null })[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, i.status AS interview_status
         FROM projects p LEFT JOIN interviews i ON i.project_id = p.id
        ORDER BY p.created_at DESC, p.id DESC`,
    )
    .all() as (ProjectRow & { interview_status: InterviewStatus | null })[];
  return rows.map((r) => ({ ...toProject(r), interviewStatus: r.interview_status }));
}

export function getProject(id: number): Project | undefined {
  const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  return r && toProject(r);
}

export function setDesign(id: number, designMd: string | null): Project {
  getDb().prepare('UPDATE projects SET design_md = ? WHERE id = ?').run(designMd, id);
  const p = getProject(id);
  if (!p) throw new Error(`project ${id} not found`);
  return p;
}

export function deleteProject(id: number): boolean {
  return getDb().prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}

export function getInterview(projectId: number): InterviewRecord | undefined {
  const r = getDb().prepare('SELECT * FROM interviews WHERE project_id = ?').get(projectId) as
    | InterviewRow
    | undefined;
  return r && toInterview(r);
}

export function createInterview(
  projectId: number,
  agent: AgentName | null,
  status: InterviewStatus,
): InterviewRecord {
  const info = getDb()
    .prepare('INSERT INTO interviews (project_id, agent, status) VALUES (?, ?, ?)')
    .run(projectId, agent, status);
  return toInterview(
    getDb().prepare('SELECT * FROM interviews WHERE id = ?').get(info.lastInsertRowid) as InterviewRow,
  );
}

// 바꿀 수 있는 열만 이름으로 고른다 (patch 키를 SQL에 직접 넣지 않는다).
const INTERVIEW_COLUMNS = {
  agent: 'agent',
  sessionId: 'session_id',
  summary: 'summary',
  status: 'status',
} as const;

export function updateInterview(
  projectId: number,
  patch: Partial<Pick<InterviewRecord, 'agent' | 'sessionId' | 'summary' | 'status'>>,
): InterviewRecord {
  const keys = (Object.keys(INTERVIEW_COLUMNS) as (keyof typeof INTERVIEW_COLUMNS)[]).filter(
    (k) => k in patch,
  );
  if (keys.length > 0) {
    const set = keys.map((k) => `${INTERVIEW_COLUMNS[k]} = ?`).join(', ');
    const values = keys.map((k) => patch[k] ?? null);
    getDb().prepare(`UPDATE interviews SET ${set} WHERE project_id = ?`).run(...values, projectId);
  }
  const r = getInterview(projectId);
  if (!r) throw new Error(`interview for project ${projectId} not found`);
  return r;
}

export function listMessages(interviewId: number): InterviewMessage[] {
  return (
    getDb()
      .prepare('SELECT * FROM interview_messages WHERE interview_id = ? ORDER BY created_at, id')
      .all(interviewId) as MessageRow[]
  ).map(toMessage);
}

export function addMessage(interviewId: number, role: MessageRole, content: string): InterviewMessage {
  const info = getDb()
    .prepare('INSERT INTO interview_messages (interview_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(interviewId, role, content, now());
  return toMessage(
    getDb().prepare('SELECT * FROM interview_messages WHERE id = ?').get(info.lastInsertRowid) as MessageRow,
  );
}

export function listDocuments(projectId: number): DocumentRecord[] {
  return (
    getDb().prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY path').all(projectId) as DocumentRow[]
  ).map(toDocument);
}

export function getDocument(projectId: number, path: string): DocumentRecord | undefined {
  const r = getDb()
    .prepare('SELECT * FROM documents WHERE project_id = ? AND path = ?')
    .get(projectId, path) as DocumentRow | undefined;
  return r && toDocument(r);
}

export function insertEmptyDocuments(projectId: number, paths: string[]): void {
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO documents (project_id, path, content, status, updated_at)
     VALUES (?, ?, '', 'empty', ?)`,
  );
  for (const p of paths) stmt.run(projectId, p, now());
}

// 바꿀 수 있는 열만 이름으로 고른다 (patch 키를 SQL에 직접 넣지 않는다).
const DOCUMENT_COLUMNS = {
  content: 'content',
  previousContent: 'previous_content',
  status: 'status',
  upstreamChanged: 'upstream_changed',
  agent: 'agent',
} as const;

export function updateDocument(
  projectId: number,
  path: string,
  patch: Partial<Pick<DocumentRecord, 'content' | 'previousContent' | 'status' | 'upstreamChanged' | 'agent'>>,
): DocumentRecord {
  const keys = (Object.keys(DOCUMENT_COLUMNS) as (keyof typeof DOCUMENT_COLUMNS)[]).filter((k) => k in patch);
  const set = [...keys.map((k) => `${DOCUMENT_COLUMNS[k]} = ?`), 'updated_at = ?'].join(', ');
  const values = keys.map((k) => {
    const v = patch[k];
    if (k === 'upstreamChanged') return v ? 1 : 0;
    return v ?? null;
  });
  const info = getDb()
    .prepare(`UPDATE documents SET ${set} WHERE project_id = ? AND path = ?`)
    .run(...values, now(), projectId, path);
  if (info.changes === 0) throw new Error(`document ${path} of project ${projectId} not found`);
  return getDocument(projectId, path) as DocumentRecord;
}

export function deleteDocument(projectId: number, path: string): void {
  getDb().prepare('DELETE FROM documents WHERE project_id = ? AND path = ?').run(projectId, path);
}

export function flagUpstream(projectId: number, paths: string[]): void {
  if (paths.length === 0) return;
  const marks = paths.map(() => '?').join(', ');
  getDb()
    .prepare(`UPDATE documents SET upstream_changed = 1 WHERE project_id = ? AND path IN (${marks})`)
    .run(projectId, ...paths);
}
