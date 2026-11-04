'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api';
import { agentHeaders } from '@/lib/agent-options';
import { useAgentChoice } from '@/components/AgentChoice';
import { Button, Notice } from '@/components/ui';

interface LiveStatus {
  active: boolean;
  otherProject: number | null;
  agent: 'claude' | 'codex' | null;
  agentRunning: boolean;
  error: string | null;
  startedAt: string | null;
  changed: string[];
}

// impeccable live: 새 탭에서 화면 요소를 눌러 변형을 만들고 고른 뒤, 바뀐 화면을 가져온다.
// 앱 안에서는 다른 호스트 이름(localhost↔127.0.0.1)으로 띄운다: 에이전트가 고치는 화면이 앱과 같은 출처에서 돌지 않게 한다 (live.js는 그대로 돈다).
function isolatedOrigin(): string {
  const host = location.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  return `${location.protocol}//${host}${location.port ? `:${location.port}` : ''}`;
}

export function LivePanel({ projectId, name, refresh, onActiveChange }: {
  projectId: number;
  name: string;
  refresh: () => Promise<void>;
  onActiveChange?: (active: boolean) => void;
}) {
  const agent = useAgentChoice();
  const url = `/api/projects/${projectId}/live`;
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'info' | 'warn'; text: string; items?: string[] } | null>(null);

  const load = useCallback(async () => {
    try { setStatus(await api<LiveStatus>('GET', url)); } catch { /* 상태를 못 읽으면 마지막 값을 둔다 */ }
  }, [url]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onActiveChange?.(status?.active ?? false); }, [status?.active, onActiveChange]);
  // 세션이 열려 있는 동안 바뀐 화면 수와 에이전트 상태를 따라간다.
  useEffect(() => {
    if (!status?.active) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [status?.active, load]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiRequestError ? e.message : '요청을 처리하지 못했습니다.' });
    } finally {
      setBusy(false);
      await load();
    }
  };

  const start = () => act(async () => {
    const res = await fetch(url, { method: 'POST', headers: agentHeaders(), body: JSON.stringify({ agent }) });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { message?: string };
      throw new ApiRequestError(res.status, 'live', e.message ?? 'live를 시작하지 못했습니다.');
    }
  });
  const importAll = () => act(async () => {
    const r = await api<{ saved: string[]; skipped: { path: string; reason: string }[] }>('POST', `${url}/import`);
    setMsg({
      tone: r.skipped.length > 0 ? 'warn' : 'info',
      text: `${r.saved.length}개 화면을 가져왔습니다.${r.skipped.length > 0 ? ' 일부는 가져오지 못했습니다.' : ''}`,
      items: r.skipped.map((s) => `${s.path}: ${s.reason}`),
    });
    await refresh();
  });
  const stop = () => act(() => api('DELETE', url));

  if (!status) return null;
  const changed = status.changed.length;

  return (
    <section className="stack" aria-label="impeccable live">
      {!status.active ? (
        <div className="row">
          <Button variant="secondary" disabled={busy || status.otherProject !== null} onClick={() => void start()}>
            impeccable live로 다듬기
          </Button>
          <span className="caption">
            {status.otherProject !== null
              ? `프로젝트 ${status.otherProject}에서 live가 열려 있습니다.`
              : '여기서(또는 새 탭에서) 요소를 눌러 변형 3개를 만들고 골라 적용합니다.'}
          </span>
          {changed > 0 && <Button variant="primary" disabled={busy} onClick={() => void importAll()}>가져오기 · {changed}개</Button>}
        </div>
      ) : (
        <div className="row">
          <a className="btn btn-secondary" href={`/screens/${name}.html`} target="_blank" rel="noopener">새 탭에서 열기</a>
          <Button variant="primary" disabled={busy || changed === 0} onClick={() => void importAll()}>가져오기 · {changed}개</Button>
          {!status.agentRunning && <Button variant="utility" disabled={busy} onClick={() => void start()}>에이전트 다시 시작</Button>}
          <Button variant="utility" disabled={busy} onClick={() => void stop()}>live 종료</Button>
          <span className="caption">
            {status.agentRunning
              ? `${status.agent === 'codex' ? 'Codex' : 'Claude Code'}가 브라우저 요청을 기다리는 중`
              : '에이전트가 멈췄습니다'}
          </span>
        </div>
      )}
      {status.active && (
        <iframe
          title={`${name} live`}
          src={`${isolatedOrigin()}/screens/${name}.html`}
          style={{ display: 'block', width: '100%', height: 900, border: '1px solid var(--color-border, #ddd)', borderRadius: 8, background: '#fff' }}
        />
      )}
      {status.error && <Notice tone="error" title="live 에이전트 오류"><p className="notice-body">{status.error}</p></Notice>}
      {msg && (
        <Notice tone={msg.tone}>
          <p className="notice-body">{msg.text}</p>
          {msg.items && msg.items.length > 0 && <ul className="caption">{msg.items.map((i) => <li key={i}>{i}</li>)}</ul>}
        </Notice>
      )}
    </section>
  );
}
