import { existsSync } from 'node:fs';
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
import { repoDir } from '@/server/env';
import { AgentError } from './agents/exec';
import { buildDocumentPrompt, repoEvidencePrompt } from './prompts';
import { readRepoContext } from './repo-context';
import { batchView } from './batch';
import {
  batchPaths,
  batchInputDocsFor,
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
  let repoContext = null;
  if (project.repo) {
    try {
      repoContext = readRepoContext(projectId, batchPaths(listDocuments(projectId)));
    } catch {
      // Unavailable clone: do not fabricate absent originals.
    }
  }
  return { project, interview, documents, running, batch: batchView(projectId), repoContext, exportGate: exportGate(documents) };
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

// 저장소 프로젝트의 클론 폴더. 저장소가 없으면 undefined. 클론이 없으면 에이전트를 띄우기 전에 AgentError.
export function runDirOf(projectId: number): string | undefined {
  if (!getProject(projectId)?.repo) return undefined;
  const dir = repoDir(projectId);
  if (!existsSync(dir)) throw new AgentError('agent_failed', '저장소 클론이 없습니다. 프로젝트를 다시 만드세요');
  return dir;
}

export function generationRepoEvidence(projectId: number): string {
  return getProject(projectId)?.repo ? repoEvidencePrompt(readRepoContext(projectId, batchPaths(listDocuments(projectId)))) : '';
}

// 생성 프롬프트 조립. feedback이 있으면 현재 본문을 함께 넣는다.
export function generationPrompt(projectId: number, path: string, feedback?: string, batch = false): string {
  const project = getProject(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const docs = listDocuments(projectId);
  const rec = getInterview(projectId);
  const screens = screenFiles(docs);
  const current = feedback === undefined ? undefined : docs.find((d) => d.path === path)?.content;
  const context = project.repo ? readRepoContext(projectId, [path, ...batchPaths(docs).filter((p) => p !== path)]) : undefined;
  return buildDocumentPrompt({
    path,
    idea: project.idea,
    summary: rec?.status === 'approved' ? rec.summary : null,
    designMd: project.designMd,
    inputDocs: batch ? batchInputDocsFor(path, docs) : inputDocsFor(path, docs),
    screenNames: screens.map((p) => nameOf(p)),
    screenFiles: screens,
    current,
    feedback,
    ...(project.repo
      ? { repo: { name: project.repo, baseline: context!.baselineCommit }, repoContext: context }
      : {}),
  });
}
