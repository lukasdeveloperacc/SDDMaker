'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentName, BatchEvent, ProjectDetail } from '@/lib/contract';
import { AgentPicker } from '@/components/AgentPicker';
import { Button, Modal, Notice } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { readSse } from '@/lib/sse-client';

export function BatchPanel({ projectId, detail, refresh }: { projectId: number; detail: ProjectDetail; refresh: () => Promise<void> }) {
  const [agent, setAgent] = useState<AgentName>('claude');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveText, setLiveText] = useState<{ path: string; text: string } | null>(null);
  const [review, setReview] = useState<{ token: string; paths: string[] } | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const batch = detail.batch;
  const interviewDone = detail.interview?.status === 'approved' || detail.interview?.status === 'skipped';
  const batchActive = streaming || batch?.state === 'running' || detail.running?.kind === 'batch';

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!batchActive || streaming) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [batchActive, streaming, refresh]);

  async function start() {
    const abort = new AbortController();
    controller.current = abort;
    setStreaming(true);
    setError(null);
    setLiveText(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent }), signal: abort.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new ApiRequestError(response.status, payload.code ?? 'unknown', payload.message ?? '초안을 만들지 못했습니다.', payload.items);
      }
      await readSse(response, (message) => {
        const event = message as BatchEvent;
        if (event.event === 'delta') setLiveText((current) => current?.path === event.data.path
          ? { ...current, text: current.text + event.data.text }
          : { path: event.data.path, text: event.data.text });
        if (event.event === 'error') setError(`${event.data.path ? `${event.data.path}: ` : ''}${event.data.message}`);
        if (event.event === 'progress' || event.event === 'done') void refresh();
      });
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '초안을 만들지 못했습니다.');
    } finally {
      if (controller.current === abort) controller.current = null;
      setStreaming(false);
      await refresh();
    }
  }

  async function cancel() {
    setError(null);
    try {
      await api('DELETE', `/api/projects/${projectId}/batch`);
      controller.current?.abort();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '실행을 취소하지 못했습니다.');
    }
    await refresh();
  }

  if (!detail.project.repo) return null;
  const paths = batch?.completedPaths ?? [];
  const pending = batch?.remainingPaths ?? [];
  const activeDocs = detail.documents.filter((doc) => batch?.completedPaths.includes(doc.path) && !doc.missingFromList);
  const reviewable = activeDocs.filter((doc) => doc.status === 'draft').map((doc) => doc.path);
  const flaggedActive = activeDocs.filter((doc) => doc.content.trim() !== '' && doc.upstreamChanged).map((doc) => doc.path);

  async function approveBatch() {
    if (!review || approving) return;
    setApproving(true);
    try {
      await api('POST', `/api/projects/${projectId}/batch/approve`, { reviewToken: review.token });
      setReview(null);
      setReviewError(null);
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === 'review_changed') {
        setReviewError('문서가 검토 후 바뀌었습니다. 이 창을 닫고 최신 내용을 다시 확인하세요.');
      } else setReviewError(cause instanceof Error ? cause.message : '일괄 승인하지 못했습니다.');
    } finally {
      setApproving(false);
    }
  }
  return (
    <section className="stack" aria-labelledby="batch-title">
      <h2 className="h3" id="batch-title">저장소 문서 초안</h2>
      <p className="caption">기존 내용은 유지하고 비어 있는 문서만 순서대로 초안으로 만듭니다. 화면 정의서는 만들지 않습니다.</p>
      {!interviewDone && <Notice tone="warn" title="인터뷰를 먼저 마치세요">인터뷰를 승인하거나 건너뛰면 시작할 수 있습니다. 인터뷰 단계에서 직접 건너뛸 수 있습니다.</Notice>}
      <div className="row">
        <AgentPicker value={agent} onChange={setAgent} disabled={batchActive || detail.running !== null || approving} />
        <Button disabled={batchActive || detail.running !== null || approving || !interviewDone || batch?.state === 'completed'} onClick={() => void start()}>
          {batch?.state === 'partial' ? '남은 초안 이어 만들기' : batch?.state === 'completed' ? '전체 초안 완료' : '전체 초안 만들기'}
        </Button>
        {batchActive && <Button variant="secondary" onClick={() => void cancel()}>실행 취소</Button>}
      </div>
      {batch && <div className="stack" aria-live="polite">
        <p className="caption">완료 {paths.length}개 · 남음 {pending.length}개{batch.currentPath ? ` · 현재 ${batch.currentPath}` : ''}</p>
        {batch.error && <Notice tone="error" title="초안 생성이 중단됐습니다"><p className="notice-body">{batch.error.path ? `${batch.error.path}: ` : ''}{batch.error.message}</p><p className="caption">저장된 초안은 유지됩니다. 남은 문서를 이어 만들 수 있습니다.</p></Notice>}
        {batch.state === 'completed' && <p className="caption" role="status">초안 생성이 끝났습니다. 각 문서를 확인한 뒤 승인하세요.</p>}
      </div>}
      {error && <Notice tone="error" title="초안 생성 오류"><p className="notice-body">{error}</p><p className="caption">저장된 초안은 문서 목록에서 확인할 수 있습니다.</p></Notice>}
      {streaming && liveText && <div className="stack" aria-live="polite"><p className="caption">현재 생성 중: {liveText.path}</p><pre className="run-stream" aria-label={`${liveText.path} 생성 내용`} style={{ maxHeight: 220, overflowY: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{liveText.text}</pre></div>}
      {reviewable.length > 0 && <div className="row">
        <Button variant="secondary" disabled={batchActive || detail.running !== null || approving || batch?.state !== 'completed' || !batch.reviewToken || flaggedActive.length > 0} onClick={() => { setReview({ token: batch!.reviewToken, paths: reviewable }); setReviewError(null); }}>검토한 초안 일괄 승인</Button>
        {flaggedActive.length > 0 && <p className="caption">앞 문서 변경을 확인해야 일괄 승인할 수 있습니다: {flaggedActive.join(', ')}</p>}
      </div>}
      <Modal open={review !== null} title="승인할 초안을 확인하세요" onClose={() => setReview(null)}>
        <div className="stack">
          <p className="caption">아래 문서만 승인합니다. 실행이나 초안 수정은 하지 않습니다.</p>
          <ul className="caption" style={{ maxHeight: 180, overflowY: 'auto', overflowWrap: 'anywhere' }}>{review?.paths.map((path) => <li key={path}>{path}</li>)}</ul>
          {reviewError && <Notice tone="error" title="다시 검토해야 합니다">{reviewError}</Notice>}
          <div className="row">
            <Button variant="primary" disabled={batchActive || detail.running !== null || approving || reviewError !== null} onClick={() => void approveBatch()}>목록의 초안 승인</Button>
            <Button variant="utility" onClick={() => setReview(null)}>취소</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
