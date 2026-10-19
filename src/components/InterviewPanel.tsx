'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AgentName, Interview, InterviewMessage, InterviewUnapproveResponse, ProjectDetail } from '@/lib/contract';
import { api, ApiRequestError } from '@/lib/api';
import { useAgentRun } from '@/lib/use-agent-run';
import { AgentPicker } from '@/components/AgentPicker';
import { RunStatus } from '@/components/RunStatus';
import { MarkdownEditor } from '@/components/documents/MarkdownEditor';
import { Markdown } from '@/components/Markdown';
import { Button, Card, Notice, TextArea } from '@/components/ui';

export type InterviewPhase = 'start' | 'chat' | 'summary' | 'approved' | 'skipped';

// 인터뷰 상태로 보여 줄 화면을 고른다 (시작 화면은 인터뷰가 없거나 세션 없이 active일 때).
export function interviewPhase(interview: Interview | null): InterviewPhase {
  if (!interview) return 'start';
  if (interview.status === 'active') return interview.hasSession ? 'chat' : 'start';
  if (interview.status === 'summarized') return 'summary';
  if (interview.status === 'approved') return 'approved';
  return 'skipped';
}

function errorText(e: unknown): string {
  return e instanceof ApiRequestError ? e.message : '요청을 처리하지 못했습니다.';
}

const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' };
const pre: CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

function Transcript({ messages, agent }: { messages: InterviewMessage[]; agent: AgentName }) {
  return (
    <ol style={list} aria-label="인터뷰 대화">
      {messages.map((m) => (
        <li key={m.id} className="card">
          <p className="eyebrow caption" style={{ margin: '0 0 var(--space-xxs)' }}>
            {m.role === 'agent' ? (agent === 'claude' ? 'Claude 질문' : 'Codex 질문') : '내 답변'}
          </p>
          {m.role === 'agent' ? <Markdown source={m.content} /> : <p style={pre}>{m.content}</p>}
        </li>
      ))}
    </ol>
  );
}

export function InterviewPanel({
  projectId,
  detail,
  refresh,
}: {
  projectId: number;
  detail: ProjectDetail;
  refresh: () => Promise<void>;
}) {
  const interview = detail.interview;
  const phase = interviewPhase(interview);
  const base = `/api/projects/${projectId}/interview`;
  const messages = interview?.messages ?? [];
  const last = messages[messages.length - 1];
  const lastRole = last?.role;
  const lastId = last?.id;
  // 마지막이 user면 답변이 저장된 뒤 실패한 상태다 (다시 시도 대상).
  const awaitingRetry = phase === 'chat' && lastRole === 'user';
  const agent: AgentName = interview?.agent ?? 'claude';

  const [startAgent, setStartAgent] = useState<AgentName>('claude');
  const [draft, setDraft] = useState('');
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<string[]>([]);
  const run = useAgentRun();
  const locked = busy || run.running;

  // 답변이 저장되어 마지막 메시지가 user가 되면 입력란을 비운다 (보내기 실패로 저장되지 않았으면 남긴다).
  useEffect(() => {
    if (lastRole === 'user') setDraft('');
  }, [lastRole, lastId]);

  const summaryText = summaryDraft ?? interview?.summary ?? '';
  const dirty = summaryDraft !== null && summaryDraft !== (interview?.summary ?? '');

  // 실행 한 번 뒤에는 상세를 다시 읽는다 (실패해도 저장 여부를 화면에 맞춘다).
  const runThenRefresh = async (url: string, body: unknown) => {
    await run.start(url, body);
    await refresh();
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
    await refresh();
  };

  const skip = () => act(() => api('POST', `${base}/skip`));
  const start = () => runThenRefresh(base, { agent: startAgent });
  const send = () => {
    const content = draft.trim();
    if (content === '') return;
    return runThenRefresh(`${base}/messages`, { content });
  };
  const retry = () => runThenRefresh(`${base}/messages`, {});
  const summarize = () => runThenRefresh(`${base}/summary`, {});
  const saveSummary = () =>
    act(async () => {
      await api('PUT', `${base}/summary`, { summary: summaryText });
      setSummaryDraft(null);
    });
  const approve = () => act(() => api('POST', `${base}/approve`));
  const unapprove = () =>
    act(async () => {
      const r = await api<InterviewUnapproveResponse>('POST', `${base}/unapprove`);
      setFlagged(r.flagged);
      setSummaryDraft(null);
    });

  const statusNotes = (
    <>
      {error && <Notice tone="error" title="오류">{error}</Notice>}
      <RunStatus run={run} agent={phase === 'start' ? startAgent : agent} />
    </>
  );

  let body: ReactNode;
  if (phase === 'start') {
    body = (
      <Card>
        <div className="stack">
          {interview?.status === 'active' && (
            <Notice tone="warn">첫 질문을 만들지 못했습니다. 다시 시작해 주세요.</Notice>
          )}
          <AgentPicker value={startAgent} onChange={setStartAgent} disabled={locked} />
          <div className="row">
            <Button variant="primary" disabled={locked} onClick={() => void start()}>
              인터뷰 시작
            </Button>
            <Button variant="secondary" disabled={locked} onClick={() => void skip()}>
              건너뛰기
            </Button>
          </div>
          {statusNotes}
        </div>
      </Card>
    );
  } else if (phase === 'chat') {
    body = (
      <div className="stack">
        <AgentPicker value={agent} onChange={() => {}} disabled lockedTo={agent} />
        <Transcript messages={messages} agent={agent} />
        {awaitingRetry ? (
          <div className="row">
            <Button variant="primary" disabled={locked} onClick={() => void retry()}>
              다시 시도
            </Button>
          </div>
        ) : (
          <div className="stack">
            <TextArea
              label="답변"
              rows={3}
              value={draft}
              disabled={locked}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="row">
              <Button variant="primary" disabled={locked || draft.trim() === ''} onClick={() => void send()}>
                보내기
              </Button>
              <span className="caption">⌘↵ 또는 Ctrl+Enter로 보냅니다.</span>
            </div>
          </div>
        )}
        <div className="row">
          <Button variant="secondary" disabled={locked} onClick={() => void summarize()}>
            인터뷰 완료
          </Button>
          <Button variant="utility" disabled={locked} onClick={() => void skip()}>
            건너뛰기
          </Button>
        </div>
        {statusNotes}
      </div>
    );
  } else if (phase === 'summary') {
    const approveBlocked = locked || dirty || summaryText.trim() === '';
    body = (
      <div className="stack">
        <p className="caption">대화를 요약했습니다. 고친 뒤 승인하면 0-PRODUCT.md 단계가 열립니다.</p>
        <MarkdownEditor
          label="인터뷰 요약"
          value={summaryText}
          onChange={(v) => setSummaryDraft(v)}
          readOnly={locked}
        />
        <div className="row">
          <Button variant="secondary" disabled={locked || !dirty || summaryText.trim() === ''} onClick={() => void saveSummary()}>
            저장
          </Button>
          <Button variant="primary" disabled={approveBlocked} onClick={() => void approve()}>
            승인
          </Button>
          <Button variant="utility" disabled={locked} onClick={() => void skip()}>
            건너뛰기
          </Button>
        </div>
        {dirty && <p className="caption">수정한 내용을 저장한 뒤 승인할 수 있습니다.</p>}
        {statusNotes}
      </div>
    );
  } else if (phase === 'approved') {
    body = (
      <div className="stack">
        <Card>
          <Markdown source={interview?.summary ?? ''} />
        </Card>
        <div className="row">
          <Button variant="utility" disabled={locked} onClick={() => void unapprove()}>
            승인 취소
          </Button>
        </div>
        <p className="caption">승인을 취소하면 요약을 다시 고칠 수 있습니다. 뒤 문서에는 &quot;앞 문서 변경됨&quot; 표시가 붙습니다.</p>
        {flagged.length > 0 && (
          <Notice tone="warn">
            뒤 문서 {flagged.length}개에 &quot;앞 문서 변경됨&quot; 표시가 붙었습니다.
          </Notice>
        )}
        {statusNotes}
      </div>
    );
  } else {
    body = (
      <div className="stack">
        <Notice tone="info">아이디어만으로 문서를 만듭니다. 아래 대화는 기록으로만 남고 문서 생성에 쓰지 않습니다.</Notice>
        {messages.length > 0 && <Transcript messages={messages} agent={agent} />}
        {statusNotes}
      </div>
    );
  }

  return (
    <section className="stack">
      <h2 className="h3">인터뷰</h2>
      {body}
    </section>
  );
}
