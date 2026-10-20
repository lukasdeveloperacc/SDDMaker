import { getUsage } from '@/server/agents/usage';
import { json } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CLI 확인이 실패해도 200으로 답한다. 확인되지 않은 쪽은 null이라 화면에서 숨겨진다.
export async function GET() {
  return json(await getUsage());
}
