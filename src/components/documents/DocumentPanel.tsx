'use client';

import { useState, type ReactNode } from 'react';
import type { AgentName, ProjectDetail } from '@/lib/contract';
import { docApiPath } from '@/lib/contract';
import { api, ApiRequestError } from '@/lib/api';
import { useAgentRun } from '@/lib/use-agent-run';
import { AgentPicker } from '@/components/AgentPicker';
import { DocActions } from '@/components/DocActions';
import { RunStatus } from '@/components/RunStatus';
import { Markdown } from '@/components/Markdown';
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
  agent: AgentName;
  feedback: string;
  writing: boolean;
  edit: { base: string; text: string } | null;
  error: ErrorInfo | null;
}

function localFor(state: Local, path: string): Local {
  if (state.path === path) return state;
  return { path, agent: 'claude', feedback: '', writing: false, edit: null, error: null };
}

function toErrorInfo(e: unknown): ErrorInfo {
  if (e instanceof ApiRequestError) return { message: e.message, items: e.items };
  return { message: '요청을 처리하지 못했습니다.' };
}

export function DocumentPanel({ projectId, detail, path, refresh, onNavigate }: PanelProps) {
  const [state, setState] = useState<Local>({ path: '', agent: 'claude', feedback: '', writing: false, edit: null, error: null });
  const [saving, setSaving] = useState(false);
  const run = useAgentRun();

  const doc = detail.documents.find((d) => d.path === path);
  if (!doc) {
    return <Notice tone="error">문서를 찾지 못했습니다.</Notice>;
  }

  const L = localFor(state, path);
  const update = (patch: Partial<Local>) =>
    setState((prev) => ({ ...localFor(prev, path), ...patch, path }));

  const value = L.edit && L.edit.base === doc.content ? L.edit.text : doc.content;
  const locked = saving || run.running || doc.running;
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
    const body = feedback === undefined ? { agent: L.agent } : { agent: L.agent, feedback };
    const res = await run.start(docApiPath(projectId, path, 'generate'), body);
    if (res.ok) {
      update({ edit: null, writing: false, feedback: '' });
      await refresh();
    }
  };

  const next = detail.documents[detail.documents.findIndex((d) => d.path === path) + 1];
  const agentPicker = (
    <AgentPicker value={L.agent} onChange={(a) => update({ agent: a })} disabled={locked} />
  );
  const runArea = (
    <>
      {doc.running && !run.running && <p className="caption">이 문서를 다른 실행이 생성하고 있습니다.</p>}
      <RunStatus run={run} agent={L.agent} />
    </>
  );

  let body: ReactNode;
  if (doc.status === 'approved') {
    body = (
      <div className="stack">
        <div className="card">
          <Markdown source={doc.content} />
        </div>
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
        {agentPicker}
        {!doc.generate.ok && <p className="caption">{doc.generate.reason}</p>}
        <div className="row">
          <Button variant="primary" disabled={locked || !doc.generate.ok} onClick={() => void generate()}>
            생성
          </Button>
          <Button variant="utility" disabled={locked} onClick={() => update({ writing: true })}>
            직접 쓰기
          </Button>
        </div>
        {runArea}
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
        />
        <div className="row">
          <Button variant="secondary" disabled={!canSave} onClick={() => void save()}>
            저장
          </Button>
        </div>
        {doc.status === 'draft' && (
          <div className="stack">
            {agentPicker}
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
        disabled={saving || run.running}
        refresh={refresh}
      />
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
