'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AgentChoice } from '@/components/AgentChoice';
import { RunSettings } from '@/components/RunSettings';
import { InterviewPanel, interviewPhase } from '@/components/InterviewPanel';
import { StageNav, DESIGN_KEY, EXPORT_KEY, INTERVIEW_KEY, defaultStageKey } from '@/components/StageNav';
import { ProjectHeader } from '@/components/projects/ProjectHeader';
import { DocumentPanel } from '@/components/documents/DocumentPanel';
import { BatchPanel } from '@/components/documents/BatchPanel';
import { SyncPanel } from '@/components/documents/SyncPanel';
import { ExportPanel } from '@/components/documents/ExportPanel';
import { DesignPanel } from '@/components/screens/DesignPanel';
import { ScreenPanel } from '@/components/screens/ScreenPanel';
import { Button, Notice } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { readAgent, writeAgent } from '@/lib/agent-options';
import type { AgentName, ProjectDetail } from '@/lib/contract';

function errorText(e: unknown): string {
  return e instanceof ApiRequestError ? e.message : '요청을 처리하지 못했습니다.';
}

export default function Page() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadError, setLoadError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const [agent, setAgent] = useState<AgentName>('claude');

  const refresh = useCallback(async () => {
    if (!validId) return;
    try {
      setDetail(await api<ProjectDetail>('GET', `/api/projects/${id}`));
      setLoadError(null);
    } catch (e) {
      setLoadError({
        notFound: e instanceof ApiRequestError && e.status === 404,
        message: errorText(e),
      });
    }
  }, [id, validId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 서버가 실행 상태·문서가 바뀌었다고 알리면 바로 다시 읽는다 (화면을 떠나도 이어지는 생성의 진행·완료가 실시간으로 보인다).
  // 이벤트가 몰리면 한 번으로 묶고, 연결이 끊겼다 다시 붙으면 한 번 읽는다.
  useEffect(() => {
    if (!validId || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/projects/${id}/events`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer !== null) return;
      timer = setTimeout(() => { timer = null; void refresh(); }, 80);
    };
    source.addEventListener('change', soon);
    source.addEventListener('ready', soon);
    return () => { source.close(); if (timer !== null) clearTimeout(timer); };
  }, [id, validId, refresh]);

  // 고른 에이전트는 브라우저에 남겨 다시 열어도 이어 쓴다 (서버 렌더와 맞추려고 마운트 뒤에 읽는다).
  useEffect(() => setAgent(readAgent()), []);

  if (!validId || loadError?.notFound) {
    return (
      <section className="stack">
        <Notice tone="error" title="없는 프로젝트입니다">
          <p className="notice-body">주소가 잘못되었거나 프로젝트가 삭제되었습니다.</p>
        </Notice>
        <div>
          <Link href="/">프로젝트 목록으로</Link>
        </div>
      </section>
    );
  }

  if (!detail) {
    return loadError ? (
      <Notice tone="error" title="오류">
        {loadError.message}{' '}
        <Button variant="utility" onClick={() => void refresh()}>
          다시 시도
        </Button>
      </Notice>
    ) : (
      <p className="caption" role="status">불러오는 중…</p>
    );
  }

  // 아직 고르지 않았으면 끝나지 않은 첫 단계를 보여 준다 (승인으로 상태가 바뀌면 다음 단계로 따라간다).
  const current = selected ?? defaultStageKey(detail);
  const navigate = (key: string) => {
    setSelected(key);
    setTrail([]);
  };
  const openScreen = (path: string) => {
    setTrail((t) => [...t, current]);
    setSelected(path);
  };
  const back = () => {
    const prev = trail[trail.length - 1];
    if (prev === undefined) return;
    setTrail(trail.slice(0, -1));
    setSelected(prev);
  };

  // 진행 중인 인터뷰는 시작한 에이전트로만 이어진다. 그 화면에서는 실행 설정도 그 에이전트로 고정한다.
  const lockedTo = current === INTERVIEW_KEY && interviewPhase(detail.interview) === 'chat' ? detail.interview?.agent ?? null : null;
  const effectiveAgent = lockedTo ?? agent;
  const chooseAgent = (next: AgentName) => {
    setAgent(next);
    writeAgent(next);
  };

  const panelProps = { projectId: id, detail, refresh, onNavigate: navigate };
  let panel: ReactNode;
  if (current === INTERVIEW_KEY) {
    panel = <InterviewPanel projectId={id} detail={detail} refresh={refresh} />;
  } else if (current === EXPORT_KEY) {
    panel = <ExportPanel projectId={id} detail={detail} />;
  } else if (current === DESIGN_KEY) {
    panel = <DesignPanel projectId={id} detail={detail} refresh={refresh} onNavigate={navigate} />;
  } else if (!detail.documents.some((d) => d.path === current)) {
    panel = <Notice tone="warn">이 단계는 목록에 없습니다. 왼쪽에서 다른 단계를 고르세요.</Notice>;
  } else if (current.startsWith('screens/')) {
    panel = (
      <ScreenPanel
        key={current}
        {...panelProps}
        path={current}
        trail={trail}
        onLinkNavigate={openScreen}
        onBack={back}
      />
    );
  } else {
    panel = <DocumentPanel key={current} {...panelProps} path={current} />;
  }

  return (
    <section className="stack" style={{ gap: 'var(--space-lg)' }}>
      <ProjectHeader project={detail.project} />

      {loadError && <Notice tone="warn" title="오류">{loadError.message} 화면 내용은 마지막으로 읽은 값입니다.</Notice>}

      <AgentChoice.Provider value={effectiveAgent}>
        <div className="project-workspace">
          <aside className="project-sidebar">
            <BatchPanel projectId={id} detail={detail} refresh={refresh} />
            <SyncPanel projectId={id} detail={detail} refresh={refresh} />
            <StageNav detail={detail} selected={current} onSelect={navigate} />
          </aside>
          <div className="project-panel">
            <details className="run-override">
              <summary>실행 설정 · {effectiveAgent === 'claude' ? 'Claude Code' : 'Codex'}</summary>
              <RunSettings agent={effectiveAgent} onAgentChange={chooseAgent} lockedTo={lockedTo} disabled={detail.running !== null} />
            </details>
            {panel}
          </div>
        </div>
      </AgentChoice.Provider>
    </section>
  );
}
