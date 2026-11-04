import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedRequest } from '@/lib/host-check';
import { log } from '@/lib/log';

export function middleware(req: NextRequest) {
  const allowed = isAllowedRequest({
    method: req.method,
    host: req.headers.get('host'),
    origin: req.headers.get('origin'),
  });
  const path = req.nextUrl.pathname;
  // 조회(GET)는 화면이 자주 다시 읽어서 남기지 않는다. 바꾸는 요청과 거절만 남긴다.
  if (!allowed) log('warn', 'http_forbidden', { method: req.method, path, host: req.headers.get('host') });
  else if (req.method !== 'GET' && req.method !== 'HEAD' && path.startsWith('/api/')) log('info', 'http_request', { method: req.method, path });
  if (allowed) return NextResponse.next();
  return NextResponse.json(
    { code: 'forbidden_host', message: '허용되지 않은 요청입니다' },
    { status: 403 },
  );
}
