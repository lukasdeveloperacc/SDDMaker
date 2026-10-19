import type { Gate, HttpErrorCode } from '@/lib/contract';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function apiError(
  status: 400 | 403 | 404 | 409,
  code: HttpErrorCode,
  message: string,
  items?: string[],
): Response {
  return json(items ? { code, message, items } : { code, message }, status);
}

export function gateError(g: Exclude<Gate, { ok: true }>): Response {
  return apiError(409, g.code, g.reason, g.items);
}

// 빈 본문은 {}, 파싱 실패나 객체가 아닌 값은 null.
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.trim() === '') return {};
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// 양의 정수 문자열만 받는다 ('1' -> 1, '0', '-1', '1.5', 'abc' -> null).
export function parseId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
