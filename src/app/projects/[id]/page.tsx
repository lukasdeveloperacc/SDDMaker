'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { InterviewPanel } from '@/components/InterviewPanel';
import { StageNav, EXPORT_KEY, INTERVIEW_KEY, defaultStageKey } from '@/components/StageNav';
import { DocumentPanel } from '@/components/documents/DocumentPanel';
import { ExportPanel } from '@/components/documents/ExportPanel';
import { ScreenPanel } from '@/components/screens/ScreenPanel';
import { Button, Notice } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import type { ProjectDetail } from '@/lib/contract';

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

  const panelProps = { projectId: id, detail, refresh, onNavigate: navigate };
  let panel: ReactNode;
  if (current === INTERVIEW_KEY) {
    panel = <InterviewPanel projectId={id} detail={detail} refresh={refresh} />;
  } else if (current === EXPORT_KEY) {
    panel = <ExportPanel projectId={id} detail={detail} />;
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
      <header className="project-heading">
        <Link href="/" className="caption">
          ← 프로젝트 목록
        </Link>
        <h1 className="h2">{detail.project.name}</h1>
        {detail.project.repo && (
          <a
            className="caption"
            href={`https://github.com/${detail.project.repo}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${detail.project.repo} GitHub 저장소 (새 탭에서 열림)`}
            style={{ overflowWrap: 'anywhere', justifySelf: 'start' }}
          >
            {detail.project.repo}
          </a>
        )}
        <p className="caption" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {detail.project.idea}
        </p>
      </header>

      {loadError && <Notice tone="warn" title="오류">{loadError.message} 화면 내용은 마지막으로 읽은 값입니다.</Notice>}

      <div className="project-workspace">
        <aside className="project-sidebar">
          <StageNav detail={detail} selected={current} onSelect={navigate} />
        </aside>
        <div className="project-panel">{panel}</div>
      </div>
    </section>
  );
}
