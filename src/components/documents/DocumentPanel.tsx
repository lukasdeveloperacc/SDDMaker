'use client';

import { useState, type ReactNode } from 'react';
import type { ProjectDetail, RepoContext } from '@/lib/contract';
import { docApiPath } from '@/lib/contract';
import { api, ApiRequestError } from '@/lib/api';
import { useAgentRun } from '@/lib/use-agent-run';
import { useAgentChoice } from '@/components/AgentChoice';
import { DocActions } from '@/components/DocActions';
import { RunStatus } from '@/components/RunStatus';
import { Button, Notice, TextArea } from '@/components/ui';
import { MarkdownEditor } from '@/components/documents/MarkdownEditor';

// FE-4·FE-6 패널이 받는 props (FE-7 페이지가 넘긴다, plan §4.6)
export interface PanelProps {
  projectId: number;
  detail: ProjectDetail;
  path: string;
  refresh: () => Promise<void>;
  onNavigate: (stageKey: string) => void;
}

interface ErrorInfo {
  message: string;
  items?: string[];
}

// 입력 중인 편집기 값. base는 편집을 시작할 때의 저장 본문이다.
// 저장 본문이 base와 달라지면(되돌리기·승인 등) 편집 값을 버리고 저장 본문을 보여 준다.
interface Local {
  path: string;
  feedback: string;
  writing: boolean;
  edit: { base: string; text: string } | null;
  error: ErrorInfo | null;
}

function localFor(state: Local, path: string): Local {
  if (state.path === path) return state;
  return { path, feedback: '', writing: false, edit: null, error: null };
}

function toErrorInfo(e: unknown): ErrorInfo {
  if (e instanceof ApiRequestError) return { message: e.message, items: e.items };
  return { message: '요청을 처리하지 못했습니다.' };
}

// 문서 안의 상대 링크(requirements/a.md, ../0-PRODUCT.md#x)를 프로젝트 문서 경로로 푼다.
// 외부 주소·루트 경로·앵커는 null이며 브라우저에 맡긴다.
export function docLinkPath(from: string, href: string): string | null {
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return null;
  const parts = from.split('/').slice(0, -1);
  for (const seg of href.split(/[?#]/)[0].split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

const OMISSION: Record<string, string> = {
  not_found: '기준 저장소에 같은 경로의 파일이 없습니다.',
  instruction_file: '지침 파일은 보안상 비교 내용에서 제외했습니다.',
  symlink: '기준 경로가 심볼릭 링크여서 읽지 않았습니다.',
  non_text: '텍스트 파일이 아니어서 읽지 않았습니다.',
  file_limit: '파일 수 또는 개별 파일 크기 제한으로 읽지 않았습니다.',
  total_limit: '전체 크기 제한으로 읽지 않았습니다.',
  redacted: '민감 정보가 감지되어 원본 내용을 표시하지 않습니다.',
};

function OriginalView({ baseline, item }: { baseline: string; item: RepoContext['originals'][number] }) {
  return (
    <div className="stack">
      <p className="caption">기준 커밋 {baseline}</p>
      {item.originalText === null ? (
        <p className="caption">{OMISSION[item.omissionReason ?? 'not_found']}</p>
      ) : (
        <pre className="run-stream editor-original">{item.originalText}</pre>
      )}
    </div>
  );
}

export function DocumentPanel({ projectId, detail, path, refresh, onNavigate }: PanelProps) {
  const [state, setState] = useState<Local>({ path: '', feedback: '', writing: false, edit: null, error: null });
  const agent = useAgentChoice();
  const [saving, setSaving] = useState(false);
  const [missingLink, setMissingLink] = useState<string | null>(null);
  const run = useAgentRun();

  const doc = detail.documents.find((d) => d.path === path);
  if (!doc) {
    return <Notice tone="error">문서를 찾지 못했습니다.</Notice>;
  }

  const L = localFor(state, path);
  const update = (patch: Partial<Local>) =>
    setState((prev) => ({ ...localFor(prev, path), ...patch, path }));

  const value = L.edit && L.edit.base === doc.content ? L.edit.text : doc.content;
  const locked = saving || run.running || doc.running || detail.running?.kind === 'batch' || (detail.running?.kind === 'requirements' && !detail.running.shared);
  const canSave = !locked && doc.status !== 'approved' && value.trim() !== '' && value !== doc.content;

  // 저장 본문을 PUT으로 보내고 상세를 다시 읽는다.
  const persist = async (content: string): Promise<boolean> => {
    setSaving(true);
    try {
      await api('PUT', docApiPath(projectId, path), { content });
    } catch (e) {
      update({ error: toErrorInfo(e) });
      return false;
    } finally {
      setSaving(false);
    }
    await refresh();
    return true;
  };

  const save = async () => {
    update({ error: null });
    if (await persist(value)) update({ edit: null, writing: false });
  };

  const generate = async (feedback?: string) => {
    update({ error: null });
    // 피드백 재생성은 현재 본문(직접 수정 포함)을 넘겨야 하므로 먼저 저장한다.
    if (feedback !== undefined && value !== doc.content) {
      if (!(await persist(value))) return;
    }
    const body = feedback === undefined ? { agent } : { agent, feedback };
    const res = await run.start(docApiPath(projectId, path, 'generate'), body);
    if (res.ok) {
      update({ edit: null, writing: false, feedback: '' });
      await refresh();
    }
  };

  // 비어 있는 요구사항 문서를 한 번에 만든다 (요구사항끼리는 입력이 겹치지 않는다). 끝나는 대로 초안이 생기므로 진행 중에도 목록을 다시 읽는다.
  const emptyRequirements = detail.documents.filter((d) => d.kind === 'requirement' && d.status === 'empty' && !d.missingFromList).length;
  const generateAll = async () => {
    update({ error: null });
    try {
      const res = await run.start(`/api/projects/${projectId}/requirements/generate`, { agent });
      if (res.ok) {
        const { failed } = JSON.parse(res.text) as { failed: { path: string; message: string }[] };
        if (failed.length > 0) update({ error: { message: '일부 문서를 만들지 못했습니다. 비어 있는 문서에서 다시 생성하세요.', items: failed.map((f) => `${f.path}: ${f.message}`) } });
      }
    } finally {
      await refresh();
    }
  };

  // 본문 안의 문서 링크는 404 대신 같은 프로젝트의 그 문서로 이동한다.
  const openLink = (href: string): boolean => {
    const target = docLinkPath(doc.path, href);
    if (target === null) return false;
    if (detail.documents.some((d) => d.path === target)) onNavigate(target);
    else setMissingLink(target);
    return true;
  };

  // 저장소 원본은 본문과 같은 탭 줄의 마지막 탭이다.
  const repo = detail.repoContext;
  const original = repo?.originals.find((item) => item.path === `docs/${doc.path}`);
  const originalView = repo && original ? <OriginalView baseline={repo.baselineCommit} item={original} /> : null;
  const extra = originalView ? { label: '저장소 원본', content: originalView } : undefined;

  // 서버는 연결이 끊겨도 생성을 이어 가므로 취소는 서버에도 알린다.
  const cancellable = { ...run, cancel: () => { run.cancel(); void api('DELETE', `/api/projects/${projectId}/run`).catch(() => {}); } };
  const next = detail.documents[detail.documents.findIndex((d) => d.path === path) + 1];
  const runArea = (
    <>
      {doc.running && !run.running && (
        <div className="row">
          <p className="caption">이 문서를 생성하고 있습니다.</p>
          <Button variant="utility" onClick={() => void api('DELETE', `/api/projects/${projectId}/run`).catch(() => {})}>취소</Button>
        </div>
      )}
      <RunStatus run={cancellable} agent={agent} />
    </>
  );

  let body: ReactNode;
  if (doc.status === 'approved') {
    body = (
      <div className="stack">
        <MarkdownEditor label={`${doc.path} 본문`} value={doc.content} readOnly onLink={openLink} extra={extra} />
        <div>
          <Button variant="primary" disabled={locked} onClick={() => onNavigate(next ? next.path : 'export')}>
            다음 단계로
          </Button>
        </div>
      </div>
    );
  } else if (doc.status === 'empty' && !L.writing) {
    body = (
      <div className="stack">
        {!doc.generate.ok && <p className="caption">{doc.generate.reason}</p>}
        <div className="row">
          <Button variant="primary" disabled={locked || !doc.generate.ok} onClick={() => void generate()}>
            생성
          </Button>
          <Button variant="utility" disabled={locked} onClick={() => update({ writing: true })}>
            직접 쓰기
          </Button>
          {doc.kind === 'requirement' && emptyRequirements > 1 && (
            <Button variant="secondary" disabled={locked || detail.running !== null || !doc.generate.ok} onClick={() => void generateAll()}>
              남은 요구사항 {emptyRequirements}개 한 번에 만들기
            </Button>
          )}
        </div>
        {runArea}
        {originalView && (
          <section className="stack" aria-label="저장소 원본">
            <h3 className="h4">저장소 원본</h3>
            {originalView}
          </section>
        )}
      </div>
    );
  } else {
    // 직접 쓰기(empty) 또는 draft: 편집기
    body = (
      <div className="stack">
        <MarkdownEditor
          label={`${doc.path} 본문`}
          value={value}
          onChange={(v) => update({ edit: { base: doc.content, text: v } })}
          readOnly={locked}
          onLink={openLink}
          extra={extra}
        />
        <div className="row">
          <Button variant="secondary" disabled={!canSave} onClick={() => void save()}>
            저장
          </Button>
        </div>
        {doc.status === 'draft' && (
          <div className="stack">
            <TextArea
              label="피드백"
              value={L.feedback}
              disabled={locked}
              onChange={(e) => update({ feedback: e.target.value })}
              rows={3}
            />
            {!doc.generate.ok && <p className="caption">{doc.generate.reason}</p>}
            <div className="row">
              <Button
                variant="primary"
                disabled={locked || !doc.generate.ok || L.feedback.trim() === ''}
                onClick={() => void generate(L.feedback.trim())}
              >
                피드백으로 재생성
              </Button>
            </div>
          </div>
        )}
        {runArea}
      </div>
    );
  }

  return (
    <section className="stack">
      <h2 className="h3">{doc.path}</h2>
      <DocActions
        projectId={projectId}
        doc={doc}
        disabled={locked}
        refresh={refresh}
      />
      {doc.upstreamChanged && <Notice tone="warn" title="앞 문서 변경을 확인하세요">이 문서를 직접 살펴본 뒤 확인을 누르면 내용과 초안/승인 상태를 유지하며 표시만 지웁니다.</Notice>}
      {missingLink && <Notice tone="warn">이 프로젝트에 없는 문서입니다: {missingLink}</Notice>}
      {L.error && (
        <Notice tone="error" title="저장하지 못했습니다">
          <p className="notice-body">{L.error.message}</p>
          {L.error.items && (
            <ul className="caption">
              {L.error.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      {body}
    </section>
  );
}
