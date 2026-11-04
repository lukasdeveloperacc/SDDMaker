import { getProject } from '@/server/db';
import { subscribeProject } from '@/server/events';
import { apiError, parseId } from '@/server/http';
import { createSse } from '@/server/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 프로젝트의 실행 상태·문서가 바뀔 때마다 `change`를 보낸다 (본문은 싣지 않는다. 화면이 상세를 다시 읽는다).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (id === null || !getProject(id)) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  const sse = createSse(req.signal);
  const off = subscribeProject(id, () => sse.send('change', {}));
  const ping = setInterval(() => sse.send('ping', {}), 20_000); // 중간 장비가 연결을 끊지 않게 한다
  sse.signal.addEventListener('abort', () => { off(); clearInterval(ping); }, { once: true });
  sse.send('ready', {});
  return sse.response;
}
