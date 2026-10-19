import { useCallback, useSyncExternalStore } from 'react';
import type { Annotation } from '@/lib/contract';

// 그림 주석은 미리보기에 그리려고 선 좌표를 함께 든다. 서버로 보낼 때는 뺀다.
export type StoredAnnotation = Annotation & { points?: { x: number; y: number }[] };

// 화면별 주석 목록. 화면을 옮겨도 남고, 새로고침하면 사라진다.
const store = new Map<string, StoredAnnotation[]>();
const listeners = new Set<() => void>();
const EMPTY: StoredAnnotation[] = [];

function keyOf(projectId: number, path: string): string {
  return `${projectId}:${path}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAnnotations(
  projectId: number,
  path: string,
): [StoredAnnotation[], (next: StoredAnnotation[]) => void] {
  const key = keyOf(projectId, path);
  const value = useSyncExternalStore(
    subscribe,
    () => store.get(key) ?? EMPTY,
    () => EMPTY,
  );
  const set = useCallback(
    (next: StoredAnnotation[]) => {
      if (next.length > 0) store.set(key, next);
      else store.delete(key);
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}

// 서버로 보낼 모양만 남긴다 (preview와 보내기가 같은 값을 쓴다)
export function toPayload(list: StoredAnnotation[]): Annotation[] {
  return list.map(({ kind, target, note }) => ({ kind, target, note }));
}
