'use client';

import { useState } from 'react';
import type { ApproveResponse, DocumentView } from '@/lib/contract';
import { docApiPath } from '@/lib/contract';
import { api, ApiRequestError } from '@/lib/api';
import { Badge, Button, Modal, Notice } from '@/components/ui';

interface Props {
  projectId: number;
  doc: DocumentView;
  disabled: boolean;
  refresh: () => Promise<void>;
  onApproved?: (r: ApproveResponse) => void;
}

interface ErrorInfo {
  message: string;
  items?: string[];
}

function toErrorInfo(e: unknown): ErrorInfo {
  if (e instanceof ApiRequestError) return { message: e.message, items: e.items };
  return { message: '요청을 처리하지 못했습니다.' };
}

function statusBadge(doc: DocumentView) {
  if (doc.running) return <Badge tone="info">실행 중</Badge>;
  if (doc.status === 'approved') return <Badge tone="success">승인됨</Badge>;
  if (doc.status === 'draft') return <Badge tone="info">초안</Badge>;
  return <Badge tone="neutral">비어 있음</Badge>;
}

export function DocActions({ projectId, doc, disabled, refresh, onApproved }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const locked = disabled || doc.running || busy !== null;

  async function run(action: string, fn: () => Promise<void>) {
    setBusy(action);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(toErrorInfo(e));
    } finally {
      setBusy(null);
    }
  }

  const undo = () =>
    run('undo', async () => {
      await api('POST', docApiPath(projectId, doc.path, 'undo'));
    });

  const approve = () =>
    run('approve', async () => {
      const r = await api<ApproveResponse>('POST', docApiPath(projectId, doc.path, 'approve'));
      onApproved?.(r);
    });

  const unapprove = () =>
    run('unapprove', async () => {
      await api('POST', docApiPath(projectId, doc.path, 'unapprove'));
    });

  const acknowledge = () =>
    run('acknowledge', async () => {
      await api('POST', docApiPath(projectId, doc.path, 'acknowledge'));
    });

  const remove = () =>
    run('delete', async () => {
      await api('DELETE', docApiPath(projectId, doc.path));
      setConfirmOpen(false);
    });

  const linkLabel = doc.path === '0-PRODUCT.md' ? 'requirements/*.md' : 'screens/*.html';

  return (
    <div className="stack">
      <div className="row">
        {statusBadge(doc)}
        {doc.upstreamChanged && <Badge tone="warn">앞 문서 변경됨</Badge>}
        {doc.missingFromList && <Badge tone="warn">목록에서 빠짐</Badge>}
      </div>

      {doc.status === 'draft' && doc.links && (
        <div className="stack">
          {doc.links.names.length > 0 && (
            <div>
              <p className="caption">승인하면 만들어질 문서 ({linkLabel})</p>
              <ul className="caption">
                {doc.links.names.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          {doc.links.invalid.length > 0 && (
            <Notice tone="warn" title="규칙에 맞지 않는 링크">
              <ul className="caption">
                {doc.links.invalid.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}

      {doc.status === 'draft' && !doc.approve.ok && (
        <Notice tone="warn">
          <p className="notice-body">{doc.approve.reason}</p>
          {doc.approve.items && doc.approve.items.length > 0 && (
            <ul className="caption">
              {doc.approve.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {error && (
        <Notice tone="error" title="처리하지 못했습니다">
          <p className="notice-body">{error.message}</p>
          {error.items && error.items.length > 0 && (
            <ul className="caption">
              {error.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      <div className="row">
        {doc.status === 'draft' && (
          <Button variant="utility" disabled={locked || !doc.canUndo} onClick={() => void undo()}>
            되돌리기
          </Button>
        )}
        {doc.status === 'draft' && (
          <Button variant="primary" disabled={locked || !doc.approve.ok} onClick={() => void approve()}>
            승인
          </Button>
        )}
        {doc.status === 'approved' && (
          <Button variant="secondary" disabled={locked} onClick={() => void unapprove()}>
            승인 취소
          </Button>
        )}
        {doc.status === 'approved' && doc.upstreamChanged && (
          <Button variant="utility" disabled={locked} onClick={() => void acknowledge()}>
            확인
          </Button>
        )}
        {doc.missingFromList && (
          <Button variant="utility" disabled={locked} onClick={() => setConfirmOpen(true)}>
            삭제
          </Button>
        )}
      </div>

      <Modal open={confirmOpen} title="문서를 삭제할까요?" onClose={() => setConfirmOpen(false)}>
        <p className="caption">목록에서 빠진 문서입니다. 삭제하면 본문도 함께 사라집니다.</p>
        <div className="row">
          <Button variant="utility" onClick={() => setConfirmOpen(false)}>
            취소
          </Button>
          <Button variant="secondary" disabled={locked} onClick={() => void remove()}>
            삭제
          </Button>
        </div>
      </Modal>
    </div>
  );
}
