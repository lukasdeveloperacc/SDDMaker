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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  useEffect(() => {
    if (!running) setCode('');
  }, [running]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!loginId || submitting || !code.trim()) return;
    setSubmitting(true);
    setError(null);
    const value = code;
    setCode('');
    try {
      await api('PUT', `/api/agents/${agent}/login`, { loginId, code: value });
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : '코드를 전달하지 못했습니다. 다시 시도하세요.');
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
      {running && agent === 'claude' && !loginId && prompt && <p role="status">인증 결과를 확인하고 있습니다…</p>}
      {error && <p role="alert">{error}</p>}
      <details className="login-console-details">
        <summary>로그인 콘솔 보기</summary>
        <div className="login-console">
          <pre className="login-console-command">$ {agent === 'claude' ? 'claude auth login --claudeai' : 'codex login --device-auth'}</pre>
          <pre ref={outputRef} className="login-console-output" role="log" aria-label="로그인 CLI 출력" tabIndex={0}>
            {output || '로그인 명령을 시작합니다…'}
          </pre>
        </div>
      </details>
      {running && <div><Button type="button" variant="utility" onClick={onCancel}>로그인 취소</Button></div>}
    </section>
  );
}
