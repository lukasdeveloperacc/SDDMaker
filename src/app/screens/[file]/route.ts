import fs from 'node:fs';
import path from 'node:path';
import { activeLive } from '@/server/live';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 열려 있는 impeccable live 세션의 화면을 그대로 준다. 화면 안 링크(login.html)가 같은 폴더로 이어지게 /screens/ 아래에 둔다.
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const s = activeLive();
  if (!s || !/^[a-z0-9-]+\.html$/.test(file)) return new Response('Not found', { status: 404 });
  try {
    const html = fs.readFileSync(path.join(s.dir, 'screens', file), 'utf8');
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
