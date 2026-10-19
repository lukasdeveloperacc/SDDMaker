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
  attempt: number;
  agent: AgentName;
  running: boolean;
  prompt: { url: string; code?: string } | null;
  output: string;
  outputLength: number;
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
  const [cancelling, setCancelling] = useState<AgentName | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attemptRef = useRef(0);

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
    setLoadError(null);
    setLogin({ attempt: ++attemptRef.current, agent, running: true, prompt: null, output: '', outputLength: 0, loginId: null, error: null });
    const status = agents?.[agent];
    const fail = (message: string, code: 'login_failed' | 'cli_not_found' = 'login_failed') =>
      setLogin((prev) => prev ? { ...prev, running: false, prompt: null, loginId: null, error: { message, help: agentErrorHelp(code, status) } } : prev);

    try {
      const res = await fetch(`/api/agents/${agent}/login`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal: true }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
        setLogin(null);
        if (data?.code === 'login_running') {
          setAgents((prev) => prev ? { ...prev, [agent]: { ...prev[agent], loginRunning: true } } : prev);
          return;
        }
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
          const text = String(m.data.text);
          setLogin((prev) => prev ? { ...prev, output: (prev.output + text).slice(-65_536), outputLength: prev.outputLength + text.length } : prev);
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
      if (!controller.signal.aborted && abortRef.current === controller) {
        fail('연결이 끊겼습니다.');
        await refreshAgents();
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function cancelLogin(agent: AgentName) {
    const controller = abortRef.current;
    setCancelling(agent);
    setLoadError(null);
    try {
      await api('DELETE', `/api/agents/${agent}/login`);
      controller?.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLogin(null);
      }
      await refreshAgents();
      return true;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '로그인을 종료하지 못했습니다. 다시 시도하세요.');
      return false;
    } finally {
      setCancelling(null);
    }
  }

  async function restartLogin(agent: AgentName) {
    if (await cancelLogin(agent)) await startLogin(agent);
  }

  const busy = login?.running === true || cancelling !== null;

  return (
    <fieldset className="agent-picker" disabled={disabled}>
      <legend className="eyebrow">에이전트</legend>
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {AGENT_NAMES.map((a) => {
        const s = agents?.[a];
        const locked = lockedTo != null && lockedTo !== a;
        const showLogin = s !== undefined && needsLogin(s);
        const loginHere = login?.agent === a ? login : null;
        const elsewhere = s?.loginRunning && !loginHere?.running;
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
              <span className="agent-help">
                <a href={a === 'codex' ? 'https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta' : 'https://code.claude.com/docs/en/authentication'} target="_blank" rel="noopener noreferrer" aria-label={`${LABEL[a]} 로그인 도움말`} aria-describedby={`${groupName}-${a}-help`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 1.5-2.5 3.5M12 16v1" /></svg>
                </a>
                <span role="tooltip" id={`${groupName}-${a}-help`}>{a === 'codex' ? '기기 로그인이 막히면 ChatGPT 설정 → 보안에서 허용하세요.' : '브라우저에서 받은 인증 코드를 터미널에 붙여넣으세요.'}</span>
              </span>
              {showLogin && !elsewhere && (
                <Button variant="utility" disabled={busy || disabled} onClick={() => void startLogin(a)}>
                  계정 연결
                </Button>
              )}
            </div>

            {elsewhere && (
              <div className="row">
                <span className="caption">로그인 진행 중</span>
                <Button variant="utility" disabled={busy || disabled} onClick={() => void restartLogin(a)}>
                  {cancelling === a ? '종료 중…' : '연결 재시작'}
                </Button>
              </div>
            )}

            {loginHere && (
              <div className="stack">
                <LoginConsole key={loginHere.attempt} agent={a} output={loginHere.output} outputLength={loginHere.outputLength} loginId={loginHere.loginId}
                  running={loginHere.running}
                  onCancel={() => void cancelLogin(a)} />
                {loginHere.error && (
                  <Notice tone="error" title={loginHere.error.help.title}>
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
          </div>
        );
      })}
    </fieldset>
  );
}
