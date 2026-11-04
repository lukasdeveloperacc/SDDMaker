import { useSyncExternalStore } from 'react';

// 이 화면에서 에이전트 실행이 하나라도 돌고 있는지. 실행 설정(에이전트·모델·강도)을 실행 중에 바꾸지 못하게 잠그는 데 쓴다.
let active = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

// 실행을 시작할 때 부르고, 돌려받은 함수를 실행이 끝날 때(성공·실패·취소 모두) 부른다.
export function beginRun(): () => void {
  active += 1;
  emit();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active -= 1;
    emit();
  };
}

export function useRunActive(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => active > 0,
    () => false,
  );
}
