'use client';

import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DesignDocInput } from '@/components/DesignDocInput';
import { Button, Card, Notice, TextArea, TextInput } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import type { ProjectResponse } from '@/lib/contract';

const stack: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0, border: 0, margin: 0, padding: 0 };
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' };

export interface ProjectInputErrors {
  name?: string;
  idea?: string;
  repo?: string;
}

// 저장소를 넣으면 이름과 아이디어는 선택이다(이름이 비면 저장소 이름을 쓴다). 형식 검사는 서버가 한다.
export function checkProjectInput(name: string, idea: string, repo = ''): ProjectInputErrors | null {
  const errors: ProjectInputErrors = {};
  if (repo.trim() === '') {
    if (name.trim() === '') errors.name = '프로젝트 이름을 입력하세요.';
    if (idea.trim() === '') errors.idea = '아이디어를 입력하세요.';
  }
  return errors.name || errors.idea ? errors : null;
}

// 저장소를 넣으면 이름·아이디어는 선택이므로 그 오류를 지운다.
export function errorsAfterRepoChange(errors: ProjectInputErrors, repo: string): ProjectInputErrors {
  if (repo.trim() === '') return errors;
  return { ...errors, name: undefined, idea: undefined };
}

// 저장소가 비어 있으면 repo 키를 보내지 않는다. 기존 요청 본문과 같다.
export function buildProjectBody(name: string, idea: string, designMd: string, repo: string) {
  const body: { name: string; idea: string; designMd: string; repo?: string } = {
    name: name.trim(),
    idea: idea.trim(),
    designMd,
  };
  if (repo.trim() !== '') body.repo = repo.trim();
  return body;
}

export interface CreateErrorView {
  // repo: 저장소 입력칸 아래 오류. notice: 화면 위 알림.
  target: 'repo' | 'notice';
  message: string;
  link?: boolean; // GitHub 연결 화면 링크
  retry?: boolean; // 다시 시도 라벨
}

export function createErrorView(code: string, message: string, repoSubmitted: boolean): CreateErrorView {
  switch (code) {
    case 'invalid_input':
      if (!repoSubmitted) return { target: 'notice', message: message || '프로젝트를 만들지 못했습니다.' };
      return { target: 'repo', message: message || '저장소 주소 형식을 확인하세요.' };
    case 'repo_not_found':
      return { target: 'repo', message: '저장소를 찾을 수 없습니다. 주소를 확인하고, 연결한 GitHub 계정으로 볼 수 있는지 확인하세요.' };
    case 'github_not_connected':
      return { target: 'notice', message: 'GitHub에 연결되어 있지 않습니다. 연결 화면에서 GitHub에 로그인하세요.', link: true };
    case 'gh_not_found':
      return { target: 'notice', message: 'gh가 설치되어 있지 않습니다. 설치하거나 GH_CLI로 경로를 지정하세요. 저장소 없이 만들 수 있습니다.' };
    case 'clone_failed':
      return { target: 'notice', message: '저장소를 받지 못했습니다. 네트워크를 확인하고 다시 시도하세요.', retry: true };
    default:
      return { target: 'notice', message: message || '프로젝트를 만들지 못했습니다.' };
  }
}

export function CreateProjectForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [repo, setRepo] = useState('');
  const [name, setName] = useState('');
  const [idea, setIdea] = useState('');
  const [designMd, setDesignMd] = useState('');
  const [errors, setErrors] = useState<ProjectInputErrors>({});
  const [errorView, setErrorView] = useState<CreateErrorView | null>(null);
  const [busy, setBusy] = useState(false);

  const hasRepo = repo.trim() !== '';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const found = checkProjectInput(name, idea, repo);
    setErrors(found ?? {});
    setErrorView(null);
    if (found) return;

    setBusy(true);
    try {
      // designMd는 trim 없이 보낸다. 서버가 빈 값이면 NULL로 둔다.
      const res = await api<ProjectResponse>('POST', '/api/projects', buildProjectBody(name, idea, designMd, repo));
      router.push(`/projects/${res.project.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const view = createErrorView(err.code, err.message, hasRepo);
        if (view.target === 'repo') setErrors({ repo: view.message });
        else setErrorView(view);
      } else {
        setErrorView({ target: 'notice', message: '프로젝트를 만들지 못했습니다.' });
      }
      setBusy(false);
    }
  }

  const submitLabel = busy ? (hasRepo ? '저장소를 받는 중…' : '만드는 중…') : errorView?.retry ? '다시 시도' : '만들기';

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={busy} style={stack}>
          <h2 className="title">새 프로젝트</h2>
          {errorView && (
            <Notice tone="error" title="오류">
              {errorView.message}
              {errorView.link && (
                <>
                  {' '}
                  <Link href="/settings/agents">연결 화면으로 이동</Link>
                </>
              )}
            </Notice>
          )}
          <TextInput
            label="GitHub 저장소 (선택)"
            value={repo}
            onChange={(e) => {
              setRepo(e.target.value);
              setErrors((prev) => errorsAfterRepoChange(prev, e.target.value));
            }}
            placeholder="owner/repo 또는 https://github.com/owner/repo"
            error={errors.repo}
          />
          <TextInput
            label={hasRepo ? '프로젝트 이름 (선택)' : '프로젝트 이름'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={hasRepo ? '비우면 저장소 이름을 씁니다' : undefined}
            error={errors.name}
          />
          <TextArea
            label={hasRepo ? '아이디어 (선택)' : '아이디어'}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            error={errors.idea}
          />
          <DesignDocInput value={designMd} onChange={setDesignMd} />
          <div style={row}>
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={onCancel}>
              취소
            </Button>
          </div>
        </fieldset>
      </form>
    </Card>
  );
}
