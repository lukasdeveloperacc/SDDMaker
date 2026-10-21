'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { NO_PUSH_TEXT, PrDialog, prErrorView, type PrError } from '@/components/documents/PrDialog';
import { Button, Notice } from '@/components/ui';
import { api } from '@/lib/api';
import type { PrInfoResponse, ProjectDetail } from '@/lib/contract';

const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', alignItems: 'center' };

export function ExportPanel({ projectId, detail }: { projectId: number; detail: ProjectDetail }) {
  const gate = detail.exportGate;
  const repo = detail.project.repo;
  const [info, setInfo] = useState<PrInfoResponse | null>(null);
  const [infoError, setInfoError] = useState<PrError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  // 저장소 프로젝트만, 내보내기 조건이 맞을 때 push 권한을 확인한다.
  useEffect(() => {
    if (!repo || !gate.ok) return;
    let stale = false;
    api<PrInfoResponse>('GET', `/api/projects/${projectId}/pr`)
      .then((res) => {
        if (stale) return;
        setInfo(res);
        setInfoError(null);
      })
      .catch((err: unknown) => {
        if (stale) return;
        setInfoError(prErrorView(err));
      });
    return () => {
      stale = true;
    };
  }, [projectId, repo, gate.ok, attempt]);

  return (
    <div className="stack">
      <h2 className="h3">내보내기</h2>
      <p className="caption">승인된 문서 세트를 docs/ 폴더 구조의 zip으로 받습니다.</p>

      {gate.ok ? (
        <div style={row}>
          <a className="btn btn-primary" href={`/api/projects/${projectId}/export`} download>
            zip 다운로드
          </a>
          {repo && (
            <Button
              type="button"
              variant="secondary"
              disabled={!info?.canPush}
              onClick={() => setDialogOpen(true)}
            >
              PR 올리기
            </Button>
          )}
        </div>
      ) : (
        <div className="stack">
          <div style={row}>
            <Button variant="primary" disabled>
              zip 다운로드
            </Button>
            {repo && (
              <Button variant="secondary" disabled>
                PR 올리기
              </Button>
            )}
          </div>
          <Notice tone="warn" title="아직 내보낼 수 없습니다">
            <p className="notice-body">승인되지 않았거나 목록에서 빠진 문서를 먼저 처리해 주세요.</p>
            <ul className="caption">
              {gate.blocking.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {repo && gate.ok && infoError && (
        infoError.connect ? (
          <Notice tone="warn" title="GitHub 연결이 필요합니다">
            <p className="notice-body">{infoError.message}</p>
            <p className="notice-body">
              <Link href="/settings/agents">연결에서 GitHub 확인</Link>
            </p>
          </Notice>
        ) : (
          <Notice tone="error" title="오류">
            <p className="notice-body">{infoError.message}</p>
            <Button variant="utility" onClick={() => setAttempt((n) => n + 1)}>
              다시 시도
            </Button>
          </Notice>
        )
      )}

      {repo && gate.ok && !infoError && info && !info.canPush && (
        <p className="caption" role="status">{NO_PUSH_TEXT}</p>
      )}

      {repo && gate.ok && !infoError && !info && (
        <p className="caption" role="status">PR 권한을 확인하는 중…</p>
      )}

      {prUrl && (
        <p className="caption" style={{ overflowWrap: 'anywhere' }}>
          마지막 PR: <a href={prUrl} target="_blank" rel="noopener noreferrer">PR 열기 (새 탭에서 열림)</a>
        </p>
      )}

      {dialogOpen && info && (
        <PrDialog
          projectId={projectId}
          info={info}
          onClose={() => setDialogOpen(false)}
          onCreated={setPrUrl}
        />
      )}

      {gate.upstreamChanged.length > 0 && (
        <Notice tone="warn" title="앞 문서가 바뀐 문서가 있습니다">
          <p className="notice-body">내보내기는 막지 않지만, 아래 문서는 다시 확인하는 것이 좋습니다.</p>
          <ul className="caption">
            {gate.upstreamChanged.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}
