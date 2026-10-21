'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { type AgentStatus, type AgentsResponse, type GithubStatus, type LoginTarget } from '@/lib/contract';
import { api } from '@/lib/api';
import { readSse } from '@/lib/sse-client';
import { agentErrorHelp, isAgentErrorCode, type AgentErrorHelp } from '@/lib/agent-errors';
import { USAGE_REFRESH_EVENT } from '@/lib/use-agent-run';
import { Badge, Button, Notice } from '@/components/ui';
import { LoginConsole, LOGIN_LABEL } from '@/components/LoginConsole';

const HELP_URL: Record<LoginTarget, string> = {
  claude: 'https://code.claude.com/docs/en/authentication',
  codex: 'https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta',
  github: 'https://cli.github.com/manual/gh_auth_login',
};
const GH_NOT_FOUND_HELP: AgentErrorHelp = {
  title: 'GitHub CLI(gh)를 찾지 못했습니다',
  body: 'gh 설치 후 GH_CLI로 경로를 지정할 수 있습니다.',
  action: 'none',
};

type LoginStatus = AgentStatus | GithubStatus;

interface LoginState {
  attempt: number;
  agent: LoginTarget;
  running: boolean;
  prompt: { url: string; code?: string } | null;
  output: string;
  outputLength: number;
  loginId: string | null;
  error: { message: string; help: AgentErrorHelp } | null;
}

function statusBadge(s: LoginStatus) {
  if (!s.installed) return <Badge tone="neutral">미설치</Badge>;
  if (!s.loggedIn) return <Badge tone="warn">미로그인</Badge>;
  if (!('subscription' in s)) return <Badge tone="success">로그인됨{s.login ? ` · ${s.login}` : ''}</Badge>;
  if (!s.subscription) return <Badge tone="warn">구독 아닌 로그인</Badge>;
  return <Badge tone="success">로그인됨</Badge>;
}

function connected(s: LoginStatus) {
  return s.loggedIn && (!('subscription' in s) || s.subscription);
}

function needsLogin(s: LoginStatus) {
  return s.installed && !connected(s);
}

export function AgentConnections() {
  const groupName = useId();
  const [mode, setMode] = useState<'guided' | 'terminal'>('guided');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [login, setLogin] = useState<LoginState | null>(null);
  const [cancelling, setCancelling] = useState<LoginTarget | null>(null);
  const [disconnecting, setDisconnecting] = useState<LoginTarget | null>(null);
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

  async function startLogin(agent: LoginTarget) {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadError(null);
    setCode('');
    setCopied(false);
    setInputError(null);
    setLogin({ attempt: ++attemptRef.current, agent, running: true, prompt: null, output: '', outputLength: 0, loginId: null, error: null });
    const status = agent === 'github' ? undefined : agents?.[agent];
    const fail = (message: string, code: 'login_failed' | 'cli_not_found' = 'login_failed') =>
      setLogin((prev) => prev ? { ...prev, running: false, prompt: null, loginId: null, error: { message, help: agent === 'github' && code === 'cli_not_found' ? GH_NOT_FOUND_HELP : agentErrorHelp(code, status) } } : prev);

    try {
      const res = await fetch(`/api/agents/${agent}/login`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal: mode === 'terminal' }),
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
        if (agent !== 'github') window.dispatchEvent(new Event(USAGE_REFRESH_EVENT));
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

  async function cancelLogin(agent: LoginTarget) {
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

  async function restartLogin(agent: LoginTarget) {
    if (await cancelLogin(agent)) await startLogin(agent);
  }

  async function disconnect(agent: LoginTarget) {
    setDisconnecting(agent);
    setLoadError(null);
    try {
      await api('POST', `/api/agents/${agent}/logout`);
      if (agent !== 'github') window.dispatchEvent(new Event(USAGE_REFRESH_EVENT));
      setLogin((prev) => prev?.agent === agent ? null : prev);
      setCode('');
      setInputError(null);
      await refreshAgents();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '연결을 해제하지 못했습니다.');
    } finally {
      setDisconnecting(null);
    }
  }

  const busy = login?.running === true || cancelling !== null || disconnecting !== null;

  function selectTab(next: 'guided' | 'terminal') {
    if (busy) return;
    setMode(next);
    setLogin(null);
    setInputError(null);
  }

  function tabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'guided' : event.key === 'End' ? 'terminal' : mode === 'guided' ? 'terminal' : 'guided';
    selectTab(next);
    document.getElementById(`${groupName}-${next}-tab`)?.focus();
  }

  async function submitCode() {
    if (!login?.running || !login.loginId || !code.trim() || submitting) return;
    const active = login;
    setSubmitting(true);
    setInputError(null);
    try {
      await api('PUT', `/api/agents/${active.agent}/login`, { loginId: active.loginId, code: code.trim() });
      if (attemptRef.current === active.attempt) setCode('');
    } catch (e) {
      if (attemptRef.current === active.attempt) setInputError(e instanceof Error ? e.message : '코드를 전송하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCode(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setInputError(null);
    } catch {
      setInputError('코드를 선택해 직접 복사하세요.');
    }
  }

  function renderProvider(a: LoginTarget) {
    const s = agents?.[a];
    const showLogin = s !== undefined && needsLogin(s);
    const loginHere = login?.agent === a ? login : null;
    const elsewhere = s?.loginRunning && !loginHere?.running;
    let authUrl: string | null = null;
    if (loginHere?.prompt) {
      try {
        const url = new URL(loginHere.prompt.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') authUrl = url.href;
      } catch { /* invalid CLI URLs are never rendered as links */ }
    }
    return (
      <div key={a} className="connection-provider">
        <div className="connection-heading">
          <div className="connection-identity">
            <span className="connection-mark" data-agent={a} aria-hidden="true">
              {a === 'claude' ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5M8 3l8 18M3 8l18 8M3 16l18-8M8 21l8-18" /></svg> : a === 'codex' ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m8 5-6 7 6 7m8-14 6 7-6 7M14 3l-4 18" /></svg> : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10M18 9c0 4-6 4-12 8" /></svg>}
            </span>
            <span className="connection-name">{LOGIN_LABEL[a]}</span>
            <span className="agent-help">
              <a href={HELP_URL[a]} target="_blank" rel="noopener noreferrer" aria-label={`${LOGIN_LABEL[a]} 로그인 도움말`} aria-describedby={`${groupName}-${a}-help`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 1.5-2.5 3.5M12 16v1" /></svg>
              </a>
              <span role="tooltip" id={`${groupName}-${a}-help`}>{a === 'github' ? 'GitHub 페이지에서 기기 코드를 입력하세요.' : a === 'codex' ? '기기 로그인이 막히면 ChatGPT 설정 → 보안에서 허용하세요.' : mode === 'terminal' ? '브라우저에서 받은 인증 코드를 터미널에 붙여넣으세요.' : '브라우저에서 받은 인증 코드를 아래에 붙여넣으세요.'}</span>
            </span>
          </div>
          <div className="connection-actions">
            {s ? statusBadge(s) : <Badge tone="neutral">확인 중</Badge>}
            {s?.loggedIn && !elsewhere && !loginHere?.running && (
              <Button variant="utility" disabled={busy} aria-label={`${LOGIN_LABEL[a]} 연결 해제`}
                title="SDDMaker에 저장된 로그인만 해제합니다." onClick={() => void disconnect(a)}>
                {disconnecting === a ? '해제 중…' : '연결 해제'}
              </Button>
            )}
            {showLogin && !elsewhere && !loginHere?.running && (
              <Button variant="utility" disabled={busy} onClick={() => void startLogin(a)}>계정 연결</Button>
            )}
            {elsewhere && <Button variant="utility" disabled={busy} onClick={() => void restartLogin(a)}>{cancelling === a ? '종료 중…' : '연결 재시작'}</Button>}
          </div>
        </div>
        {a === 'github' && s && !s.installed && <p className="caption">gh 설치 후 GH_CLI로 경로를 지정할 수 있습니다.</p>}
        {elsewhere && <p className="caption">로그인 진행 중</p>}
        {loginHere && (
          <div className="connection-flow">
            {mode === 'terminal' ? (
              <LoginConsole key={loginHere.attempt} agent={a} output={loginHere.output} outputLength={loginHere.outputLength} loginId={loginHere.loginId}
                running={loginHere.running} onCancel={() => void cancelLogin(a)} />
            ) : loginHere.running ? (
              <div className="stack">
                <div className="connection-browser-action">
                  {authUrl ? <a className="btn btn-primary" href={authUrl} target="_blank" rel="noopener noreferrer">인증 페이지 열기</a> : <span className="caption" role="status">로그인 준비 중…</span>}
                  {authUrl && <span className="caption" role="status">인증 대기 중</span>}
                </div>
                {a !== 'claude' && loginHere.prompt?.code && (
                  <div className="connection-code"><code>{loginHere.prompt.code}</code><Button variant="utility" onClick={() => void copyCode(loginHere.prompt!.code!)}>{copied ? '복사됨' : '코드 복사'}</Button></div>
                )}
                {a === 'claude' && authUrl && (
                  <form className="connection-code-form" onSubmit={(event) => { event.preventDefault(); void submitCode(); }}>
                    <label htmlFor={`${groupName}-auth-code`}>인증 코드</label>
                    <div className="row"><input id={`${groupName}-auth-code`} type="password" autoComplete="off" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} placeholder="브라우저에서 받은 코드" disabled={submitting} />
                      <Button type="submit" variant="primary" disabled={!loginHere.loginId || !code.trim() || submitting}>{submitting ? '확인 중…' : '연결 완료'}</Button></div>
                  </form>
                )}
                {inputError && <Notice tone="error">{inputError}</Notice>}
                <div><Button variant="utility" disabled={cancelling !== null} onClick={() => void cancelLogin(a)}>{cancelling === a ? '종료 중…' : '취소'}</Button></div>
              </div>
            ) : null}
            {loginHere.error && (
              <Notice tone="error" title={loginHere.error.help.title}>
                <p className="caption">{loginHere.error.message}</p>
                <div><Button variant="utility" disabled={busy} onClick={() => void startLogin(a)}>다시 시도</Button></div>
              </Notice>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="agent-connections" aria-label="연결">
      <div className="connection-tabs" role="tablist" aria-label="로그인 방식">
        {(['guided', 'terminal'] as const).map((tab) => (
          <button key={tab} type="button" role="tab" id={`${groupName}-${tab}-tab`}
            aria-selected={mode === tab} aria-controls={`${groupName}-panel`} tabIndex={mode === tab ? 0 : -1}
            disabled={busy} className={mode === tab ? 'is-active' : undefined}
            onKeyDown={tabKeyDown} onClick={() => selectTab(tab)}>
            {tab === 'guided' ? '간편 로그인' : '터미널'}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${groupName}-panel`} aria-labelledby={`${groupName}-${mode}-tab`}>
        {loadError && <Notice tone="error">{loadError}</Notice>}
        <section className="connection-section" aria-label="AI 에이전트">
          <h2 className="h3">AI 에이전트</h2>
          <p className="caption">인터뷰와 문서 생성에 쓰는 구독 계정입니다.</p>
          {(['claude', 'codex'] as const).map(renderProvider)}
        </section>
        {/* 응답에 github가 없으면 섹션을 만들지 않는다 */}
        {agents?.github && (
          <section className="connection-section" aria-label="GitHub">
            <h2 className="h3">GitHub</h2>
            <p className="caption">저장소를 받아 문서를 만들고 PR을 올릴 때 씁니다.</p>
            {renderProvider('github')}
          </section>
        )}
      </div>
    </section>
  );
}
