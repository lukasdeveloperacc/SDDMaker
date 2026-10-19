export const ALLOWED_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1'];

const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// 'localhost:3000' -> 'localhost', null -> null
export function hostnameOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname || null;
  } catch {
    return null;
  }
}

// Host 헤더의 host:port (기본 포트면 포트 없음). 파싱 실패면 null.
function hostPortOf(hostHeader: string | null): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).host || null;
  } catch {
    return null;
  }
}

export function isAllowedRequest(input: { method: string; host: string | null; origin: string | null }): boolean {
  const hostname = hostnameOf(input.host);
  if (!hostname || !ALLOWED_HOSTNAMES.includes(hostname)) return false;
  if (!STATE_CHANGING.has(input.method.toUpperCase())) return true;
  if (!input.origin) return false;
  // Origin은 Host와 host:port가 같아야 한다 (다른 로컬 포트의 페이지나 localhost↔127.0.0.1 혼용을 막는다).
  try {
    const origin = new URL(input.origin);
    return ALLOWED_HOSTNAMES.includes(origin.hostname) && origin.host === hostPortOf(input.host);
  } catch {
    return false;
  }
}
