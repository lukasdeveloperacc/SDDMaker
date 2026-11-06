'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiRequestError } from '@/lib/api';
import type { ProjectDetail } from '@/lib/contract';
import { projectTokensCss } from '@/lib/design-tokens';
import { previewDocument } from '@/lib/screens/html';
import { useAgentRun } from '@/lib/use-agent-run';
import { useAgentChoice } from '@/components/AgentChoice';
import { RunStatus } from '@/components/RunStatus';
import { Button, Notice, TextArea } from '@/components/ui';

interface Props {
  projectId: number;
  detail: ProjectDetail;
  refresh: () => Promise<void>;
  onNavigate: (key: string) => void;
}

// 디자인 문서만 다룬다. 화면(기준 화면 포함)은 화면 정의서 단계에서 만든다.
// 편집기의 내용이 "작업본"이다: 생성은 작업본을 반영해 작업본을 바꾸기만 하고, 저장해야 프로젝트에 반영된다.
export function DesignPanel({ projectId, detail, refresh, onNavigate }: Props) {
  const saved = detail.project.designMd ?? '';
  const agent = useAgentChoice();
  const run = useAgentRun();
  const sysRun = useAgentRun();
  const [text, setText] = useState(saved);
  const [sysFeedback, setSysFeedback] = useState('');
  const savedHtml = detail.project.designHtml ?? '';
  const tokens = useMemo(() => projectTokensCss(saved, savedHtml || null), [saved, savedHtml]);
  // 미리보기 사본은 브라우저에서만 만든다 (DOMParser).
  const [srcDoc, setSrcDoc] = useState('');
  useEffect(() => setSrcDoc(savedHtml ? previewDocument(savedHtml) : ''), [savedHtml]);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const screens = detail.documents.filter((d) => d.kind === 'screen' && !d.missingFromList);
  const nextScreen = (screens.find((d) => d.status !== 'approved') ?? screens[0])?.path;
  const reqs = detail.documents.filter((d) => d.kind === 'requirement' && !d.missingFromList);
  const repo = detail.project.repo !== null;
  const noScreens = repo && screens.length === 0; // 저장소 프로젝트도 USERFLOW에 화면 링크가 있으면 화면(프로토타입)을 만든다
  const ready = repo || reqs.every((d) => d.status === 'approved'); // 서버 조건과 같다 (저장소 프로젝트는 코드에서 만든다)
  const hasText = text.trim() !== '';
  const dirty = text !== saved;
  const locked = run.running || sysRun.running || busy || detail.running !== null;

  async function generate() {
    setError(null);
    const note = feedback.trim();
    const r = await run.start(`/api/projects/${projectId}/design/generate`, {
      agent,
      base: text,
      ...(note ? { feedback: note } : {}),
    });
    if (!r.ok) return;
    if (!r.text.trim()) {
      setError('생성 결과가 비어 있습니다. 다시 생성해 주세요.');
      return;
    }
    setText(r.text);
    setFeedback('');
  }

  async function generateSystem() {
    setError(null);
    const note = sysFeedback.trim();
    const r = await sysRun.start(`/api/projects/${projectId}/design/system`, { agent, ...(note ? { feedback: note } : {}) });
    await refresh();
    if (r.ok) setSysFeedback('');
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('PUT', `/api/projects/${projectId}/design`, { designMd: text });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : '요청을 처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <header className="stack">
        <h2 className="title">디자인 문서</h2>
        <p className="caption">
          {noScreens
            ? '저장소의 코드를 읽어 디자인 문서를 만듭니다. 만들거나 붙여 넣어 저장하세요. 화면(프로토타입)은 4-USERFLOW.md에 화면 링크가 있을 때 만들 수 있습니다.'
            : '문서를 만들거나 붙여 넣어 저장하세요. 저장한 문서는 모든 화면이 따르는 기준입니다. 저장한 뒤 디자인 시스템 페이지를 만들면 화면이 그 견본을 가져다 씁니다.'}
        </p>
      </header>

      {error && (
        <Notice tone="error" title="처리하지 못했습니다">
          <p className="notice-body">{error}</p>
        </Notice>
      )}

      <TextArea
        label="디자인 문서 (DESIGN.md)"
        className="editor-input"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={locked}
      />
      <p className="caption">
        {hasText ? (
          '생성하면 지금 내용을 반영해 다시 만듭니다. 토큰 값과 원칙은 그대로 두고 이 제품에 필요한 것만 덧붙입니다.'
        ) : (
          <>
            가진 문서가 없으면{' '}
            <a href="https://getdesign.md/" target="_blank" rel="noopener noreferrer">
              getdesign.md
            </a>
            에서 가까운 것을 붙여 넣거나, 아래 버튼으로 새로 만드세요.
          </>
        )}
      </p>

      {hasText && (
        <TextArea label="피드백 (선택)" value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={locked} />
      )}

      <RunStatus run={run} agent={agent} />

      <div className="row">
        <Button variant="primary" disabled={locked || !ready} onClick={() => void generate()}>
          {hasText ? '이 문서를 반영해 다시 생성' : '디자인 문서 생성'}
        </Button>
        <Button variant="secondary" disabled={locked || !dirty || !hasText} onClick={() => void save()}>
          저장
        </Button>
        <Button variant="utility" disabled={locked || !dirty} onClick={() => setText(saved)}>
          변경 버리기
        </Button>
        {dirty && <span className="caption">저장 안 한 변경이 있습니다. 화면 생성에는 저장된 문서가 쓰입니다.</span>}
      </div>
      {!ready && (
        <p className="caption">요구사항 문서를 모두 승인하면 생성할 수 있습니다. 붙여 넣은 문서는 지금도 저장할 수 있습니다.</p>
      )}

      {saved.trim() !== '' && (
        <section className="stack" aria-label="디자인 시스템 페이지">
          <h3 className="title">디자인 시스템 페이지</h3>
          <p className="caption">
            저장된 디자인 문서를 색·글꼴·컴포넌트 견본으로 그린 페이지입니다. 화면 정의서는 이 견본을 그대로 가져다 씁니다.
            {dirty && ' 저장 안 한 변경은 반영되지 않습니다.'}
          </p>
          {tokens && (
            <details>
              <summary className="caption">토큰 CSS · {tokens.split('\n').filter((l) => l.trimStart().startsWith('--')).length}개 (내보내기의 2-DESIGN.tokens.css)</summary>
              <pre className="caption" style={{ overflow: 'auto', maxHeight: 320 }}>{tokens}</pre>
            </details>
          )}
          {srcDoc && (
            <iframe
              title="디자인 시스템 페이지"
              sandbox=""
              srcDoc={srcDoc}
              style={{ display: 'block', width: '100%', height: 900, border: '1px solid var(--color-border, #ddd)', borderRadius: 8, background: '#fff' }}
            />
          )}
          {savedHtml && (
            <TextArea label="페이지 피드백 (선택)" value={sysFeedback} onChange={(e) => setSysFeedback(e.target.value)} disabled={locked} />
          )}
          <RunStatus run={sysRun} agent={agent} />
          {!sysRun.running && detail.running?.kind === 'design' && <p className="caption">디자인 작업을 하고 있습니다…</p>}
          <div className="row">
            <Button variant="primary" disabled={locked} onClick={() => void generateSystem()}>
              {savedHtml ? (sysFeedback.trim() ? '피드백 반영해 다시 생성' : '다시 생성') : '디자인 시스템 페이지 생성'}
            </Button>
          </div>
        </section>
      )}

      {noScreens || screens.length === 0 ? null : saved.trim() === '' ? (
        <Notice tone="info">
          <p className="notice-body">디자인 문서를 저장하면 화면 정의서를 만들 수 있습니다.</p>
        </Notice>
      ) : (
        <div>
          <Button variant="secondary" disabled={locked} onClick={() => nextScreen && onNavigate(nextScreen)}>
            화면 정의서로 이동
          </Button>
        </div>
      )}
    </div>
  );
}
