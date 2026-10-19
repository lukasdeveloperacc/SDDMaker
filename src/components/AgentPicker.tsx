'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AGENT_NAMES, type AgentName, type AgentStatus, type AgentsResponse } from '@/lib/contract';
import { api } from '@/lib/api';
import { readSse } from '@/lib/sse-client';
import { agentErrorHelp, isAgentErrorCode, type AgentErrorHelp } from '@/lib/agent-errors';
import { Badge, Button, Notice } from '@/components/ui';

const LABEL: Record<AgentName, string> = { claude: 'Claude Code', codex: 'Codex' };

interface LoginState {
  agent: AgentName;
  running: boolean;
  prompt: { url: string; code?: string } | null;
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
    const controller = new AbortController();
    abortRef.current = controller;
    setLogin({ agent, running: true, prompt: null, error: null });
    const status = agents?.[agent];
    const fail = (message: string, code: 'login_failed' | 'cli_not_found' = 'login_failed') =>
      setLogin({
        agent,
        running: false,
        prompt: null,
        error: { message, help: agentErrorHelp(code, status) },
      });

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
        if (m.event === 'prompt') {
          const prompt = { url: String(m.data.url), code: m.data.code ? String(m.data.code) : undefined };
          setLogin((prev) => (prev ? { ...prev, prompt } : prev));
        } else if (m.event === 'done') {
          outcome.loggedIn = Boolean(m.data.loggedIn);
        } else if (m.event === 'error') {
          outcome.error = { code: String(m.data.code), message: String(m.data.message) };
        }
      });

      if (outcome.error) {
        const code = isAgentErrorCode(outcome.error.code) ? outcome.error.code : 'login_failed';
        fail(outcome.error.message, code === 'cli_not_found' ? 'cli_not_found' : 'login_failed');
      } else if (outcome.loggedIn === false) {
        fail('로그인이 완료되지 않았습니다.');
      } else {
        setLogin(null);
      }
      await refreshAgents();
    } catch {
      if (!controller.signal.aborted) fail('연결이 끊겼습니다.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function cancelLogin(agent: AgentName) {
    try {
      await fetch(`/api/agents/${agent}/login`, { method: 'DELETE' });
    } catch {
      // 연결 오류는 무시한다. 로그인 스트림이 끝나면 화면이 갱신된다.
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
                  로그인
                </Button>
              )}
            </div>

            {showLogin && s && (
              <p className="caption">
                서버 터미널 로그인: <code>{s.loginCommand}</code>
              </p>
            )}
            {showLogin && (
              <p className="caption">
                로그인은 SDDMaker 전용 저장소에 보관됩니다. Docker에서는 컨테이너 안에서 위 명령을 실행하세요.
              </p>
            )}

            {loginHere && (
              <div className="stack">
                {loginHere.prompt && /^https?:\/\//.test(loginHere.prompt.url) && (
                  <a href={loginHere.prompt.url} target="_blank" rel="noopener noreferrer">
                    브라우저에서 로그인 열기
                  </a>
                )}
                {loginHere.prompt?.code && (
                  <div>
                    <p className="caption">화면에 표시된 코드를 입력하세요</p>
                    <p className="login-code">{loginHere.prompt.code}</p>
                  </div>
                )}
                {loginHere.running && !loginHere.prompt && <p className="caption">로그인 준비 중…</p>}
                {loginHere.running && (
                  <div>
                    <Button variant="utility" onClick={() => void cancelLogin(a)}>
                      취소
                    </Button>
                  </div>
                )}
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
          </div>
        );
      })}
    </fieldset>
  );
}
