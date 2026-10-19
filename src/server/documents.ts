import {
  DOC_PATH_RE,
  type DocumentView,
  type Interview,
  type ProjectDetail,
  type ProjectSummary,
} from '@/lib/contract';
import {
  getDocument,
  getInterview,
  getProject,
  listDocuments,
  listMessages,
  listProjects,
} from '@/server/db';
import { getRun } from '@/server/runtime';
import { apiError, parseId } from '@/server/http';
import { buildDocumentPrompt } from './prompts';
import {
  buildDocumentViews,
  computeMissing,
  exportGate,
  inputDocsFor,
  nameOf,
  screenFiles,
} from './doc-rules';

export function projectDetail(projectId: number): ProjectDetail | null {
  const project = getProject(projectId);
  if (!project) return null;
  const rec = getInterview(projectId);
  const interview: Interview | null = rec
    ? {
        status: rec.status,
        agent: rec.agent,
        hasSession: rec.sessionId !== null,
        summary: rec.summary,
        messages: listMessages(rec.id),
      }
    : null;
  const running = getRun(projectId);
  const documents = buildDocumentViews({
    docs: listDocuments(projectId),
    interviewStatus: interview?.status ?? null,
    hasDesign: project.designMd !== null && project.designMd.trim() !== '',
    running,
  });
  return { project, interview, documents, running, exportGate: exportGate(documents) };
}

export function documentView(projectId: number, path: string): DocumentView | null {
  return projectDetail(projectId)?.documents.find((d) => d.path === path) ?? null;
}

// 목록에서 빠진 문서는 진행 집계에서 뺀다.
export function projectSummaries(): ProjectSummary[] {
  return listProjects().map((p) => {
    const docs = listDocuments(p.id);
    const missing = computeMissing(docs);
    const counted = docs.filter((d) => !missing.has(d.path));
    return {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      interviewStatus: p.interviewStatus,
      approvedCount: counted.filter((d) => d.status === 'approved').length,
      totalCount: counted.length,
    };
  });
}

// --- 라우트 도우미 (BE-5·BE-6a·BE-6b 공용) ---

export interface DocRef { projectId: number; path: string }

// :id와 :path를 검사한다. 실패하면 응답을 돌려준다 (id 404, 경로 400, 문서 행 404).
export function resolveDocRef(rawId: string, path: string): DocRef | Response {
  const projectId = parseId(rawId);
  if (projectId === null || !getProject(projectId)) {
    return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  }
  if (!DOC_PATH_RE.test(path)) return apiError(400, 'invalid_input', '잘못된 문서 경로입니다');
  if (!getDocument(projectId, path)) return apiError(404, 'not_found', '문서를 찾을 수 없습니다');
  return { projectId, path };
}

// 문서의 현재 뷰 (resolveDocRef를 통과한 뒤에만 부른다).
export function viewOf(ref: DocRef): DocumentView {
  const v = documentView(ref.projectId, ref.path);
  if (!v) throw new Error(`document ${ref.path} of project ${ref.projectId} not found`);
  return v;
}

// 생성 프롬프트 조립. feedback이 있으면 현재 본문을 함께 넣는다.
export function generationPrompt(projectId: number, path: string, feedback?: string): string {
  const project = getProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const docs = listDocuments(projectId);
  const rec = getInterview(projectId);
  const screens = screenFiles(docs);
  const current = feedback === undefined ? undefined : docs.find((d) => d.path === path)?.content;
  return buildDocumentPrompt({
    path,
    idea: project.idea,
    summary: rec?.status === 'approved' ? rec.summary : null,
    designMd: project.designMd,
    inputDocs: inputDocsFor(path, docs),
    screenNames: screens.map((p) => nameOf(p)),
    screenFiles: screens,
    current,
    feedback,
  });
}
