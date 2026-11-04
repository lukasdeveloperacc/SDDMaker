// 구조화 로그: 한 줄에 JSON 하나 ({ ts, level, event, ...fields }). `docker compose logs`에서 jq로 거를 수 있다.
// 미들웨어(edge)에서도 쓰므로 Node 모듈을 쓰지 않는다.
// 프롬프트·문서 본문·로그인 코드·CLI 표준 오류 원문은 넣지 않는다 (비밀값이 섞일 수 있다).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function minLevel(): number {
  return ORDER[(process.env.LOG_LEVEL ?? 'info') as LogLevel | 'silent'] ?? ORDER.info;
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < minLevel()) return;
  const ts = new Date().toISOString();
  // 필드가 ts·level·event를 덮지 못하게 마지막에 다시 쓴다 (키 순서는 처음 것이 유지된다).
  const line = JSON.stringify(Object.assign({ ts, level, event }, fields, { ts, level, event }), (_k, v: unknown) =>
    v instanceof Error ? { name: v.name, message: v.message } : v,
  );
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

// 오류를 로그 필드로 (메시지만, 스택은 debug일 때만).
export function errorFields(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { error: String(e) };
  const code = (e as { code?: unknown }).code;
  return {
    error: e.message,
    errorName: e.name,
    ...(typeof code === 'string' ? { errorCode: code } : {}),
    ...(minLevel() <= ORDER.debug && e.stack ? { stack: e.stack } : {}),
  };
}
