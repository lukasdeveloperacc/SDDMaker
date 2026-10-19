import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readSse } from '@/lib/sse-client';

export interface AgentRun {
  running: boolean;
  text: string;
  elapsedSec: number;
  error: { code: string; message: string; items?: string[] } | null;
  start(url: string, body: unknown): Promise<{ ok: true; text: string } | { ok: false }>;
  cancel(): void;
}

// 에이전트 실행 한 번을 감싼다. 취소·연결 끊김은 오류로 보지 않는다(끊김은 제외).
export function useAgentRun(): AgentRun {
  const [running, setRunning] = useState(false);
  const [text, setText] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<AgentRun['error']>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stopTimer();
    };
  }, [stopTimer]);

  const start = useCallback<AgentRun['start']>(
    async (url, body) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setText('');
      setError(null);
      setElapsedSec(0);
      stopTimer();
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);

      const outcome: { done?: string; error?: { code: string; message: string } } = {};
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            code?: unknown;
            message?: unknown;
            items?: unknown;
          } | null;
          setError({
            code: typeof data?.code === 'string' ? data.code : 'unknown',
            message: typeof data?.message === 'string' ? data.message : '요청을 처리하지 못했습니다.',
            items: Array.isArray(data?.items) ? data.items.map(String) : undefined,
          });
          return { ok: false };
        }

        await readSse(res, (m) => {
          if (m.event === 'delta') {
            setText((t) => t + String(m.data.text));
          } else if (m.event === 'done') {
            outcome.done = String(m.data.text);
            setText(outcome.done);
          } else if (m.event === 'error') {
            outcome.error = { code: String(m.data.code), message: String(m.data.message) };
          }
        });
      } catch {
        if (controller.signal.aborted) return { ok: false };
        setError({ code: 'agent_failed', message: '연결이 끊겼습니다' });
        return { ok: false };
      } finally {
        stopTimer();
        abortRef.current = null;
        setRunning(false);
      }

      if (outcome.done !== undefined) return { ok: true, text: outcome.done };
      if (outcome.error) setError(outcome.error);
      else setError({ code: 'agent_failed', message: '연결이 끊겼습니다' });
      return { ok: false };
    },
    [stopTimer],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return useMemo(
    () => ({ running, text, elapsedSec, error, start, cancel }),
    [running, text, elapsedSec, error, start, cancel],
  );
}
