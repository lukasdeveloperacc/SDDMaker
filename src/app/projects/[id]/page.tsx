'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DesignDocInput } from '@/components/DesignDocInput';
import { InterviewPanel } from '@/components/InterviewPanel';
import { StageNav, EXPORT_KEY, INTERVIEW_KEY, defaultStageKey } from '@/components/StageNav';
import { DocumentPanel } from '@/components/documents/DocumentPanel';
import { ExportPanel } from '@/components/documents/ExportPanel';
import { ScreenPanel } from '@/components/screens/ScreenPanel';
import { Button, Card, Notice } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import type { ProjectDetail, ProjectResponse } from '@/lib/contract';

const layout: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 'var(--space-lg)' };
const navCol: CSSProperties = { flex: '0 1 240px', minWidth: 0, width: '100%', maxWidth: 280 };
const panelCol: CSSProperties = { flex: '1 1 420px', minWidth: 0 };

function errorText(e: unknown): string {
  return e instanceof ApiRequestError ? e.message : '요청을 처리하지 못했습니다.';
}

// 디자인 문서 섹션. 저장 값은 서버 값을 처음 한 번만 옮긴다 (다시 읽을 때 입력 중인 글이 지워지지 않게).
function DesignSection({
  projectId,
  designMd,
  refresh,
}: {
  projectId: number;
  designMd: string | null;
  refresh: () => Promise<void>;
}) {
  const saved = designMd ?? '';
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = value !== saved;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // trim하지 않는다. 서버가 공백만 있으면 NULL로 둔다.
      await api<ProjectResponse>('PUT', `/api/projects/${projectId}/design`, { designMd: value });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      return;
    }
    setBusy(false);
    await refresh();
  };

  return (
    <details>
      <summary className="title" style={{ cursor: 'pointer' }}>
        디자인 문서 · {saved.trim() === '' ? '없음' : '있음'}
      </summary>
      <div className="stack" style={{ marginTop: 'var(--space-sm)' }}>
        <DesignDocInput value={value} onChange={setValue} />
        {error && <Notice tone="error" title="오류">{error}</Notice>}
        <div className="row">
          <Button variant="secondary" disabled={!changed || busy} onClick={() => void save()}>
            {busy ? '저장하는 중…' : '디자인 문서 저장'}
          </Button>
        </div>
      </div>
    </details>
  );
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
      <header className="stack" style={{ gap: 'var(--space-xs)' }}>
        <Link href="/" className="caption">
          ← 프로젝트 목록
        </Link>
        <h1 className="h2">{detail.project.name}</h1>
        <p className="caption" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {detail.project.idea}
        </p>
      </header>

      {loadError && <Notice tone="warn" title="오류">{loadError.message} 화면 내용은 마지막으로 읽은 값입니다.</Notice>}

      <Card>
        <DesignSection projectId={id} designMd={detail.project.designMd} refresh={refresh} />
      </Card>

      <div style={layout}>
        <div style={navCol}>
          <StageNav detail={detail} selected={current} onSelect={navigate} />
        </div>
        <div style={panelCol}>{panel}</div>
      </div>
    </section>
  );
}
