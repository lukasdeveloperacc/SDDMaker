'use client';

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Button, Modal, Notice, TextInput } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' };

// 입력한 이름이 프로젝트 이름과 정확히 같을 때만 삭제할 수 있다 (공백 정리 없음).
export function canConfirmDelete(projectName: string, typed: string): boolean {
  return typed === projectName;
}

export function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: { id: number; name: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = canConfirmDelete(project.name, typed) && !busy;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!enabled) return;
    setBusy(true);
    setError(null);
    try {
      await api<void>('DELETE', `/api/projects/${project.id}`);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : '프로젝트를 삭제하지 못했습니다.');
      setBusy(false);
    }
  }

  return (
    <Modal open title="프로젝트 삭제" onClose={onClose}>
      <form onSubmit={submit} noValidate style={stack}>
        <p>
          <strong>{project.name}</strong> 프로젝트와 인터뷰·문서를 모두 지웁니다. 실행 중인 에이전트가 있으면 먼저 멈춥니다.
          <br />
          되돌릴 수 없습니다. 계속하려면 프로젝트 이름을 똑같이 입력하세요.
        </p>
        {error && <Notice tone="error" title="오류">{error}</Notice>}
        <TextInput
          label="프로젝트 이름 입력"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          disabled={busy}
        />
        <div style={row}>
          <Button type="submit" variant="primary" disabled={!enabled}>
            {busy ? '삭제하는 중…' : '삭제'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </form>
    </Modal>
  );
}
