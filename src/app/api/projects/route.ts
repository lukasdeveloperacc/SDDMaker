import { randomUUID } from 'node:crypto';
import { readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { createProject, deleteProject } from '@/server/db';
import { projectSummaries } from '@/server/documents';
import { AgentError } from '@/server/agents/exec';
import { apiError, json, readJson } from '@/server/http';
import { cloneRepo, ensureConnected, GithubError, parseRepo, viewRepo, type RepoInfo } from '@/server/github';
import { reposDir, repoDir } from '@/server/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STALE_TMP_MS = 15 * 60_000;

export async function GET() {
  return json({ projects: projectSummaries() });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 잘못되었습니다');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  if (body.repo != null && typeof body.repo !== 'string') return apiError(400, 'invalid_input', '저장소 주소는 글이어야 합니다');
  if (body.designMd != null && typeof body.designMd !== 'string') {
    return apiError(400, 'invalid_input', '디자인 문서는 글이어야 합니다');
  }
  // 빈 값은 없는 것으로 보고, 아니면 입력 원문 그대로 저장한다.
  const designMd = typeof body.designMd === 'string' && body.designMd.trim() !== '' ? body.designMd : null;

  const rawRepo = typeof body.repo === 'string' ? body.repo.trim() : '';
  if (rawRepo === '') {
    if (name === '' || idea === '') return apiError(400, 'invalid_input', '이름과 아이디어를 입력하세요');
    return json({ project: createProject({ name, idea, designMd }) }, 201);
  }
  const repo = parseRepo(rawRepo);
  if (!repo) return apiError(400, 'invalid_input', '저장소 주소 형식을 확인하세요 (owner/repo 또는 https://github.com/owner/repo)');
  return createRepoProject(req, repo, name, idea, designMd);
}

// 저장소를 복제해 프로젝트를 만든다. 실패하면 행과 임시 폴더를 남기지 않는다.
async function createRepoProject(
  req: Request,
  repo: string,
  name: string,
  idea: string,
  designMd: string | null,
): Promise<Response> {
  const tmp = path.join(reposDir(), `.tmp-${randomUUID()}`);
  let projectId: number | null = null;
  try {
    sweepStaleTmp();
    await ensureConnected();
    const info = await checkRepo(repo, req.signal);
    await cloneRepo(info.nameWithOwner, tmp, req.signal);
    const project = createProject({
      name: name || info.nameWithOwner.slice(info.nameWithOwner.indexOf('/') + 1),
      idea,
      designMd,
      repo: info.nameWithOwner,
    });
    projectId = project.id;
    renameSync(tmp, repoDir(project.id));
    return json({ project }, 201);
  } catch (e) {
    if (projectId !== null) deleteProject(projectId);
    rmSync(tmp, { recursive: true, force: true });
    return failure(e);
  }
}

// 저장소 확인이 시간 안에 안 끝나면 복제 실패로 보고한다 (저장소가 없다는 뜻이 아니다).
async function checkRepo(repo: string, signal: AbortSignal): Promise<RepoInfo> {
  try {
    return await viewRepo(repo, signal);
  } catch (e) {
    if (e instanceof AgentError) throw new GithubError('clone_failed', '저장소 정보를 제때 확인하지 못했습니다. 다시 시도하세요');
    throw e;
  }
}

function failure(e: unknown): Response {
  if (e instanceof GithubError) return json({ code: e.code, message: e.message }, e.status);
  return json({ code: 'clone_failed', message: '저장소를 받지 못했습니다. 다시 시도하세요' }, 502);
}

// 앱이 중간에 꺼져 남은 임시 복제 폴더를 치운다 (15분 넘게 그대로인 것만).
// best-effort: 한 항목의 오류(다른 요청과의 경쟁 등)는 무시해서 이번 요청을 실패시키지 않는다.
function sweepStaleTmp(): void {
  const dir = reposDir();
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.startsWith('.tmp-')) continue;
    const p = path.join(dir, entry);
    try {
      if (now - statSync(p).mtimeMs > STALE_TMP_MS) rmSync(p, { recursive: true, force: true });
    } catch {
      // 이미 사라졌거나 쓸 수 없는 항목은 건너뛴다
    }
  }
}
