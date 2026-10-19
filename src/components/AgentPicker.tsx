'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AGENT_NAMES, type AgentName, type AgentStatus, type AgentsResponse } from '@/lib/contract';
import { api } from '@/lib/api';
import { readSse } from '@/lib/sse-client';
import { agentErrorHelp, isAgentErrorCode, type AgentErrorHelp } from '@/lib/agent-errors';
import { Badge, Button, Notice } from '@/components/ui';
import { LoginConsole } from '@/components/LoginConsole';

const LABEL: Record<AgentName, string> = { claude: 'Claude Code', codex: 'Codex' };

interface LoginState {
  agent: AgentName;
  running: boolean;
  prompt: { url: string; code?: string } | null;
  output: string;
  loginId: string | null;
  error: { message: string; help: AgentErrorHelp } | null;
}

function statusBadge(s: AgentStatus) {
  if (!s.installed) return <Badge tone="neutral">미설치</Badge>;
  if (!s.loggedIn) return <Badge tone="warn">미로그인</Badge>;
  if (!s.subscription) return <Badge tone="warn">구독 아닌 로그인</Badge>;
  return <Badge tone="success">로그인됨</Badge>;
}

function needsLogin(s: AgentStatus) {
  return s.installed && !(s.loggedIn && s.subscription);
}

export function AgentPicker({
  value,
  onChange,
  disabled,
  lockedTo,
}: {
  value: AgentName;
  onChange: (a: AgentName) => void;
  disabled?: boolean;
  lockedTo?: AgentName | null;
}) {
  const groupName = useId();
  const [agents, setAgents] = useState<AgentsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [login, setLogin] = useState<LoginState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshAgents = useCallback(async () => {
    try {
      setAgents(await api<AgentsResponse>('GET', '/api/agents'));
      setLoadError(null);
    } catch {
      setLoadError('에이전트 상태를 읽지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  // 언마운트되면 로그인 스트림을 끊는다 (서버가 로그인 프로세스를 끝낸다).
  useEffect(() => () => abortRef.current?.abort(), []);

  async function startLogin(agent: AgentName) {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setLogin({ agent, running: true, prompt: null, output: '', loginId: null, error: null });
    const status = agents?.[agent];
    const fail = (message: string, code: 'login_failed' | 'cli_not_found' = 'login_failed') =>
      setLogin((prev) => prev ? { ...prev, running: false, prompt: null, loginId: null, error: { message, help: agentErrorHelp(code, status) } } : prev);

    try {
      const res = await fetch(`/api/agents/${agent}/login`, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: unknown } | null;
        setLogin(null);
        setLoadError(typeof data?.message === 'string' ? data.message : '로그인을 시작하지 못했습니다.');
        return;
      }

      const outcome: { loggedIn?: boolean; error?: { code: string; message: string } } = {};
      await readSse(res, (m) => {
        if (abortRef.current !== controller) return;
        if (m.event === 'prompt') {
          const prompt = { url: String(m.data.url), code: m.data.code ? String(m.data.code) : undefined };
          setLogin((prev) => (prev ? { ...prev, prompt } : prev));
        } else if (m.event === 'output') {
          setLogin((prev) => prev ? { ...prev, output: (prev.output + String(m.data.text)).slice(-16_384) } : prev);
        } else if (m.event === 'input_ready') {
          setLogin((prev) => prev ? { ...prev, loginId: String(m.data.loginId) } : prev);
        } else if (m.event === 'done') {
          outcome.loggedIn = Boolean(m.data.loggedIn);
        } else if (m.event === 'error') {
          outcome.error = { code: String(m.data.code), message: String(m.data.message) };
        }
      });

      await refreshAgents();
      if (controller.signal.aborted) return;
      if (abortRef.current === controller) abortRef.current = null;

      if (outcome.error) {
        const code = isAgentErrorCode(outcome.error.code) ? outcome.error.code : 'login_failed';
        fail(outcome.error.message, code === 'cli_not_found' ? 'cli_not_found' : 'login_failed');
      } else if (outcome.loggedIn !== true) {
        fail('로그인이 완료되지 않았습니다.');
      } else {
        setLogin(null);
      }
    } catch {
      if (!controller.signal.aborted) fail('연결이 끊겼습니다.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function cancelLogin(agent: AgentName) {
    const controller = abortRef.current;
    try {
      await fetch(`/api/agents/${agent}/login`, { method: 'DELETE' });
    } catch {
      // 연결 오류는 무시한다. 로그인 스트림이 끝나면 화면이 갱신된다.
    } finally {
      controller?.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLogin(null);
      }
    }
  }

  const busy = login?.running === true;

  return (
    <fieldset className="agent-picker" disabled={disabled}>
      <legend className="eyebrow">에이전트</legend>
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {AGENT_NAMES.map((a) => {
        const s = agents?.[a];
        const locked = lockedTo != null && lockedTo !== a;
        const showLogin = s !== undefined && needsLogin(s);
        const loginHere = login?.agent === a ? login : null;
        return (
          <div key={a} className="agent-option">
            <div className="agent-row">
              <label className="agent-choice">
                <input
                  type="radio"
                  name={groupName}
                  value={a}
                  checked={value === a}
                  disabled={disabled || locked}
                  onChange={() => onChange(a)}
                />
                <span className="title">{LABEL[a]}</span>
              </label>
              {s ? statusBadge(s) : <Badge tone="neutral">확인 중</Badge>}
              {showLogin && (
                <Button variant="utility" disabled={busy || disabled} onClick={() => void startLogin(a)}>
                  계정 연결
                </Button>
              )}
            </div>

            {loginHere && (
              <div className="stack">
                <LoginConsole agent={a} output={loginHere.output} prompt={loginHere.prompt} loginId={loginHere.loginId}
                  running={loginHere.running} onSubmitted={() => setLogin((prev) => prev?.loginId === loginHere.loginId ? { ...prev, loginId: null } : prev)}
                  onCancel={() => void cancelLogin(a)} />
                {loginHere.error && (
                  <Notice tone="error" title={loginHere.error.help.title}>
                    <p className="notice-body">{loginHere.error.help.body}</p>
                    <p className="caption">{loginHere.error.message}</p>
                    <div>
                      <Button variant="utility" onClick={() => void startLogin(a)}>
                        다시 시도
                      </Button>
                    </div>
                  </Notice>
                )}
              </div>
            )}
            {showLogin && s && (
              <details className="caption agent-login-help">
                <summary>터미널에서 직접 로그인</summary>
                <p>앱 서버가 실행되는 터미널에서 사용하세요. Docker에서는 컨테이너 안에서 실행합니다.</p>
                <code>{s.loginCommand}</code>
              </details>
            )}
          </div>
        );
      })}
      {agents && <p className="caption">연결은 SDDMaker 전용 저장소에 보관됩니다. 호스트의 로그인과 분리됩니다.</p>}
    </fieldset>
  );
}
