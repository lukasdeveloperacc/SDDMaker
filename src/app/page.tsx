'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { CreateProjectForm } from '@/components/projects/CreateProjectForm';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { Badge, Button, Card, Notice } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import type { InterviewStatus, ProjectSummary, ProjectsResponse } from '@/lib/contract';

const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' };
const header: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' };
const itemRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-md)' };
const itemMain: CSSProperties = { flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-xxs)' };

const INTERVIEW_BADGE: Record<InterviewStatus | 'none', { text: string; tone: 'neutral' | 'success' | 'info' }> = {
  none: { text: '없음', tone: 'neutral' },
  active: { text: '진행 중', tone: 'info' },
  summarized: { text: '요약됨', tone: 'info' },
  approved: { text: '승인', tone: 'success' },
  skipped: { text: '건너뜀', tone: 'neutral' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function Page() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<ProjectsResponse>('GET', '/api/projects');
      setProjects(res.projects);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiRequestError ? err.message : '프로젝트 목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <div style={header}>
        <h1 className="h2">프로젝트</h1>
        {!showCreate && (
          <Button type="button" onClick={() => setShowCreate(true)}>
            새 프로젝트
          </Button>
        )}
      </div>

      {showCreate && (
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <CreateProjectForm onCancel={() => setShowCreate(false)} />
        </div>
      )}

      {loadError && (
        <div style={{ marginBottom: 'var(--space-md)' }}>
          <Notice tone="error" title="오류">
            {loadError}{' '}
            <Button type="button" variant="utility" onClick={() => void load()}>
              다시 시도
            </Button>
          </Notice>
        </div>
      )}

      {projects === null && !loadError && <p className="caption" role="status">불러오는 중…</p>}

      {projects !== null && projects.length === 0 && (
        <Card>
          <p>아직 프로젝트가 없습니다. &apos;새 프로젝트&apos;로 SDD 문서를 만들 앱을 등록하세요.</p>
        </Card>
      )}

      {projects !== null && projects.length > 0 && (
        <ul style={list}>
          {projects.map((p) => {
            const badge = INTERVIEW_BADGE[p.interviewStatus ?? 'none'];
            return (
              <li key={p.id}>
                <Card>
                  <div style={itemRow}>
                    <div style={itemMain}>
                      <Link href={`/projects/${p.id}`} className="title">
                        {p.name}
                      </Link>
                      <span className="caption">
                        생성 {formatDate(p.createdAt)} · 승인 문서 {p.approvedCount} / {p.totalCount}
                      </span>
                    </div>
                    <Badge tone={badge.tone}>인터뷰 {badge.text}</Badge>
                    <Button
                      type="button"
                      variant="utility"
                      aria-label={`${p.name} 프로젝트 삭제`}
                      onClick={() => setDeleting(p)}
                    >
                      삭제
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {deleting && (
        <DeleteProjectDialog
          key={deleting.id}
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
