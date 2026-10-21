'use client';

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import Link from 'next/link';
import { Button, Modal, Notice } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import type { PrCreateResponse, PrInfoResponse } from '@/lib/contract';

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' };
const pathList: CSSProperties = {
  margin: 0,
  padding: 'var(--space-xs) var(--space-sm)',
  maxHeight: '160px',
  overflowY: 'auto',
  border: '1px solid var(--color-hairline)',
  borderRadius: 'var(--radius-md)',
  listStyle: 'none',
  fontSize: '14px',
  overflowWrap: 'anywhere',
};

export const NO_PUSH_TEXT = '이 저장소에 push 권한이 없어 PR을 올릴 수 없습니다. zip을 내려받아 직접 올리세요.';

export type PrError = { message: string; noPush: boolean; connect: boolean };

// 오류 코드별 화면 처리. 연결 문제는 설정 화면 링크를 함께 보여 준다.
export function prErrorView(err: unknown): PrError {
  if (!(err instanceof ApiRequestError)) return { message: '요청을 처리하지 못했습니다.', noPush: false, connect: false };
  if (err.code === 'no_push_permission') return { message: NO_PUSH_TEXT, noPush: true, connect: false };
  const connect = err.code === 'github_not_connected' || err.code === 'gh_not_found';
  return { message: err.message, noPush: false, connect };
}

export function PrDialog({
  projectId,
  info,
  onClose,
  onCreated,
}: {
  projectId: number;
  info: PrInfoResponse;
  onClose: () => void;
  onCreated: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PrError | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const blocked = busy || error?.noPush === true;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<PrCreateResponse>('POST', `/api/projects/${projectId}/pr`);
      setUrl(res.url);
      onCreated(res.url);
    } catch (err) {
      setError(prErrorView(err));
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = busy ? 'PR을 올리는 중…' : error && !error.noPush ? '다시 시도' : 'PR 올리기';

  return (
    <Modal open title="PR 올리기" onClose={onClose}>
      <form onSubmit={submit} noValidate style={stack}>
        <p>
          승인한 문서를 새 브랜치에 올리고 기본 브랜치로 PR을 만듭니다.
        </p>
        <dl style={{ ...stack, gap: 'var(--space-xs)' }}>
          <div>
            <dt className="caption">대상 저장소</dt>
            <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{info.repo}</dd>
          </div>
          <div>
            <dt className="caption">기본 브랜치</dt>
            <dd style={{ margin: 0 }}>{info.defaultBranch}</dd>
          </div>
          <div>
            <dt className="caption">올릴 파일</dt>
            <dd style={{ margin: 0 }}>{info.files.length}개</dd>
          </div>
        </dl>

        {!url && (
          <section style={stack} aria-labelledby="pr-overwrite-title">
            <h3 id="pr-overwrite-title" className="h4" style={{ margin: 0 }}>덮어쓸 파일</h3>
            {info.overwrites.length === 0 ? (
              <p style={{ margin: 0 }}>덮어쓸 파일 없음</p>
            ) : (
              <ul style={pathList}>
                {info.overwrites.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {url && (
          <Notice tone="info" title="PR을 만들었습니다">
            <p className="notice-body" style={{ overflowWrap: 'anywhere', margin: 0 }}>
              <a href={url} target="_blank" rel="noopener noreferrer">PR 열기 (새 탭에서 열림)</a>
            </p>
          </Notice>
        )}

        {error && (
          <Notice tone={error.noPush ? 'warn' : 'error'} title={error.noPush ? '주의' : '오류'}>
            <p className="notice-body" style={{ margin: 0 }}>{error.message}</p>
            {error.connect && (
              <p className="notice-body" style={{ margin: 0 }}>
                <Link href="/settings/agents">연결에서 GitHub 확인</Link>
              </p>
            )}
          </Notice>
        )}

        {url ? (
          <div style={row}>
            <Button type="button" variant="primary" onClick={onClose}>
              닫기
            </Button>
            <Button type="submit" variant="secondary" disabled={busy}>
              {busy ? 'PR을 올리는 중…' : '새 브랜치로 PR 다시 올리기'}
            </Button>
          </div>
        ) : (
          <div style={row}>
            <Button type="submit" variant="primary" disabled={blocked}>
              {submitLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              취소
            </Button>
          </div>
        )}
      </form>
    </Modal>
  );
}
