export class ApiRequestError extends Error {
  status: number;
  code: string;
  items?: string[];

  constructor(status: number, code: string, message: string, items?: string[]) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.items = items;
  }
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? {}) as { code?: unknown; message?: unknown; items?: unknown };
    throw new ApiRequestError(
      res.status,
      typeof err.code === 'string' ? err.code : 'unknown',
      typeof err.message === 'string' ? err.message : '요청을 처리하지 못했습니다.',
      Array.isArray(err.items) ? err.items.map(String) : undefined,
    );
  }
  return data as T;
}
