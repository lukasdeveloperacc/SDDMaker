// 프로젝트 상태(실행 잠금·문서)가 바뀌었다는 알림. 화면은 알림을 받으면 상태를 다시 읽는다.
// 개발 서버가 모듈을 다시 읽어도 구독이 사라지지 않게 globalThis에 둔다.
const g = globalThis as typeof globalThis & { __sddmakerEvents?: Map<number, Set<() => void>> };
const subs = (g.__sddmakerEvents ??= new Map());

export function emitProject(projectId: number): void {
  for (const listener of subs.get(projectId) ?? []) listener();
}

export function subscribeProject(projectId: number, listener: () => void): () => void {
  const set = subs.get(projectId) ?? new Set();
  set.add(listener);
  subs.set(projectId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) subs.delete(projectId);
  };
}
