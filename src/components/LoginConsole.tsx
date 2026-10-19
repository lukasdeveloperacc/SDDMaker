'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AgentName } from '@/lib/contract';
import { api } from '@/lib/api';
import { Button, TextInput } from './ui';

export function LoginConsole({ agent, output, prompt, loginId, running, onSubmitted, onCancel }: {
  agent: AgentName;
  output: string;
  prompt: { url: string; code?: string } | null;
  loginId: string | null;
  running: boolean;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const inputId = useId();
  const outputRef = useRef<HTMLPreElement>(null);
  const [code, setCode] = useState('');
  const [consoleInput, setConsoleInput] = useState('');
  const [inputSent, setInputSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  useEffect(() => {
    if (!running) {
      setCode('');
      setConsoleInput('');
    }
  }, [running]);

  async function submit(e: FormEvent, terminal = false) {
    e.preventDefault();
    const value = terminal ? consoleInput : code;
    if (!loginId || submitting || (!terminal && !value.trim())) return;
    setSubmitting(true);
    setError(null);
    setInputSent(false);
    if (terminal) setConsoleInput('');
    else setCode('');
    try {
      await api('PUT', `/api/agents/${agent}/login`, { loginId, ...(terminal ? { input: value } : { code: value }) });
      if (terminal) setInputSent(true);
      else onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : '입력을 전달하지 못했습니다. 다시 시도하세요.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCode() {
    if (!prompt?.code) return;
    try {
      await navigator.clipboard.writeText(prompt.code);
      setCopied(true);
      setError(null);
    } catch {
      setError('복사하지 못했습니다. 위 코드를 직접 선택해 복사하세요.');
    }
  }

  return (
    <section className="login-connection" aria-label={`${agent === 'claude' ? 'Claude Code' : 'Codex'} 계정 연결`}>
      <div className="login-connection-header">
        <strong>브라우저에서 인증</strong>
        <span role="status">{running ? '인증 대기 중' : '종료됨'}</span>
      </div>
      {running && prompt && /^https?:\/\//.test(prompt.url) && (
        <div className="login-connection-actions">
          <a className="btn btn-primary" href={prompt.url} target="_blank" rel="noopener noreferrer">인증 페이지 열기</a>
          {agent === 'codex' && prompt.code && (
            <div className="login-console-device">
              <code className="login-code">{prompt.code}</code>
              <Button type="button" variant="utility" onClick={() => void copyCode()}>{copied ? '복사됨' : '코드 복사'}</Button>
            </div>
          )}
          <p>{agent === 'claude'
            ? '브라우저에서 로그인한 뒤 Authentication code가 나오면 전체 코드를 아래에 붙여넣으세요.'
            : '이 코드를 OpenAI 인증 페이지에 입력하세요. 인증을 마치면 연결 상태를 자동으로 확인합니다.'}</p>
        </div>
      )}
      {running && agent === 'claude' && loginId && prompt && (
        <form className="login-connection-input" onSubmit={(e) => void submit(e)}>
          <div className="login-console-input-row">
            <TextInput label="Claude 인증 코드" id={inputId} type="password" value={code} onChange={(e) => setCode(e.target.value)}
              autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={4096}
              placeholder="브라우저에서 받은 전체 코드" disabled={submitting} aria-describedby={`${inputId}-help`} />
            <Button type="submit" disabled={submitting || !code.trim()}>{submitting ? '전달 중…' : '코드 제출'}</Button>
          </div>
          <p id={`${inputId}-help`}>Enter로 제출합니다. 입력한 코드는 화면에 표시하거나 저장하지 않습니다.</p>
        </form>
      )}
      {running && !prompt && <p role="status">인증 페이지를 준비하고 있습니다…</p>}
      {running && agent === 'codex' && (
        <p className="login-device-help">기기 로그인이 차단되면 ChatGPT의 설정 → 보안에서 기기 코드 로그인을 허용한 뒤, 이 로그인을 취소하고 다시 연결하세요. <a href="https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta" target="_blank" rel="noopener noreferrer">설정 안내</a></p>
      )}
      {running && agent === 'claude' && !loginId && prompt && <p role="status">인증 결과를 확인하고 있습니다…</p>}
      {error && <p role="alert">{error}</p>}
      <details className="login-console-details">
        <summary>로그인 콘솔 열기 · 입력 가능</summary>
        <div className="login-console">
          <pre className="login-console-command">$ {agent === 'claude' ? 'claude auth login --claudeai' : 'codex login --device-auth'}</pre>
          <pre ref={outputRef} className="login-console-output" role="log" aria-label="로그인 CLI 출력" tabIndex={0}>
            {output || '로그인 명령을 시작합니다…'}
          </pre>
          {running && loginId && (
            <form className="login-terminal-form" onSubmit={(e) => void submit(e, true)} onKeyDown={(e) => {
              if (e.ctrlKey && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                onCancel();
              }
            }}>
              <div className="login-console-input-row">
                <TextInput label="로그인 CLI 입력" type="password" value={consoleInput} onChange={(e) => { setConsoleInput(e.target.value); setInputSent(false); }}
                  autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={4096}
                  placeholder="입력 후 Enter" disabled={submitting} aria-describedby={`${inputId}-terminal-help`} />
                <Button type="submit" variant="utility" disabled={submitting}>입력 전송</Button>
              </div>
              <p id={`${inputId}-terminal-help`}>Enter: 한 줄 전송 · Ctrl+C: 로그인 취소. 입력은 보안을 위해 가려집니다.</p>
              <p>{agent === 'codex' ? 'Codex 기기 코드는 위 OpenAI 인증 페이지에 입력하세요. 이 명령은 브라우저 인증을 기다립니다.' : '브라우저에서 받은 인증 코드를 여기에 붙여넣을 수도 있습니다.'} 로그인 명령의 입력만 받습니다.</p>
              {inputSent && <p role="status">입력을 CLI에 전달했습니다.</p>}
            </form>
          )}
        </div>
      </details>
      {running && <div><Button type="button" variant="utility" onClick={onCancel}>로그인 취소</Button></div>}
    </section>
  );
}
