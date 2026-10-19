import { createProject } from '@/server/db';
import { projectSummaries } from '@/server/documents';
import { apiError, json, readJson } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return json({ projects: projectSummaries() });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body) return apiError(400, 'invalid_input', '요청 형식이 잘못되었습니다');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  if (name === '' || idea === '') return apiError(400, 'invalid_input', '이름과 아이디어를 입력하세요');
  if (body.designMd != null && typeof body.designMd !== 'string') {
    return apiError(400, 'invalid_input', '디자인 문서는 글이어야 합니다');
  }
  // 빈 값은 없는 것으로 보고, 아니면 입력 원문 그대로 저장한다.
  const designMd = typeof body.designMd === 'string' && body.designMd.trim() !== '' ? body.designMd : null;
  return json({ project: createProject({ name, idea, designMd }) }, 201);
}
