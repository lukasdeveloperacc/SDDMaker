import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedRequest } from '@/lib/host-check';

export function middleware(req: NextRequest) {
  const allowed = isAllowedRequest({
    method: req.method,
    host: req.headers.get('host'),
    origin: req.headers.get('origin'),
  });
  if (allowed) return NextResponse.next();
  return NextResponse.json(
    { code: 'forbidden_host', message: '허용되지 않은 요청입니다' },
    { status: 403 },
  );
}
