'use client';

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { DesignDocInput } from '@/components/DesignDocInput';
import { Button, Card, Notice, TextArea, TextInput } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import type { ProjectResponse } from '@/lib/contract';

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' };

export interface ProjectInputErrors {
  name?: string;
  idea?: string;
}

// 공백만 입력하면 화면에서 막는다. 서버도 같은 규칙으로 400을 돌려준다.
export function checkProjectInput(name: string, idea: string): ProjectInputErrors | null {
  const errors: ProjectInputErrors = {};
  if (name.trim() === '') errors.name = '프로젝트 이름을 입력하세요.';
  if (idea.trim() === '') errors.idea = '아이디어를 입력하세요.';
  return errors.name || errors.idea ? errors : null;
}

export function CreateProjectForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [designMd, setDesignMd] = useState('');
  const [errors, setErrors] = useState<ProjectInputErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const found = checkProjectInput(name, idea);
    setErrors(found ?? {});
    setServerError(null);
    if (found) return;

    setBusy(true);
    try {
      // designMd는 trim 없이 보낸다. 서버가 빈 값이면 NULL로 둔다.
      const res = await api<ProjectResponse>('POST', '/api/projects', {
        name: name.trim(),
        idea: idea.trim(),
        designMd,
      });
      router.push(`/projects/${res.project.id}`);
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : '프로젝트를 만들지 못했습니다.');
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate style={stack}>
        <h2 className="title">새 프로젝트</h2>
        {serverError && <Notice tone="error" title="오류">{serverError}</Notice>}
        <TextInput
          label="프로젝트 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TextArea
          label="아이디어"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          error={errors.idea}
        />
        <DesignDocInput value={designMd} onChange={setDesignMd} />
        <div style={row}>
          <Button type="submit" disabled={busy}>
            {busy ? '만드는 중…' : '만들기'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            취소
          </Button>
        </div>
      </form>
    </Card>
  );
}
