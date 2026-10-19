'use client';

import { useMemo, useState } from 'react';
import type { AgentName } from '@/lib/contract';
import { docApiPath } from '@/lib/contract';
import { api, ApiRequestError } from '@/lib/api';
import { extractHtml, missingScreenLinks, sanitizeHtml, screenLinkTarget } from '@/lib/screens/html';
import { truncateLabel } from '@/lib/screens/geometry';
import { useAnnotations } from '@/lib/screens/annotations-store';
import { useAgentRun } from '@/lib/use-agent-run';
import { AgentPicker } from '@/components/AgentPicker';
import { DocActions } from '@/components/DocActions';
import { RunStatus } from '@/components/RunStatus';
import { ScreenPreview } from '@/components/screens/ScreenPreview';
import type { PanelProps } from '@/components/documents/DocumentPanel';
import { AnnotationPanel, type DrawInfo, type Highlight, type PickInfo } from '@/components/screens/AnnotationPanel';
import { Button, Modal, Notice, TextArea } from '@/components/ui';

export interface ScreenPanelProps extends PanelProps {
  trail: string[];
  onLinkNavigate: (path: string) => void;
  onBack: () => void;
}

type Mode = 'off' | 'select' | 'draw';

type Msg = { tone: 'warn' | 'error'; text: string; items?: string[] };

const REASON_KO: Record<string, string> = {
  design_required: '프로젝트 디자인 문서가 없습니다.',
};

function nameOf(path: string): string {
  return path.replace(/^screens\//, '').replace(/\.html$/, '');
}

function errorOf(e: unknown): Msg {
  if (e instanceof ApiRequestError) return { tone: 'error', text: e.message, items: e.items };
  return { tone: 'error', text: '요청을 처리하지 못했습니다.' };
}

export function ScreenPanel({
  projectId,
  detail,
  path,
  refresh,
  trail,
  onLinkNavigate,
  onBack,
}: ScreenPanelProps) {
  const doc = detail.documents.find((d) => d.path === path);
  const screenPaths = useMemo(
    () => detail.documents.filter((d) => d.kind === 'screen').map((d) => d.path),
    [detail],
  );

  const [agent, setAgent] = useState<AgentName>('claude');
  const run = useAgentRun();
  const [annotations] = useAnnotations(projectId, path);
  const [width, setWidth] = useState<1280 | 390>(1280);
  const [mode, setMode] = useState<Mode>('off');
  const [pick, setPick] = useState<PickInfo | null>(null);
  const [draw, setDraw] = useState<DrawInfo | null>(null);
  const [highlight, setHighlight] = useState<Highlight>(null);
  const [loadInfo, setLoadInfo] = useState<{
    frame: 'mobile' | 'page';
    duplicates: string[];
    unique: string[];
    missing: string[];
  } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [designMd, setDesignMd] = useState('');
  // 전체 HTML 편집 창의 내용. null이면 편집 중이 아니다. 닫아도 남아 있으면 "저장 안 한 변경"이다.
  const [draft, setDraft] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  if (!doc) return <Notice tone="error">문서를 찾지 못했습니다.</Notice>;

  const approved = doc.status === 'approved';
  const locked = run.running || busy || doc.running;
  const dirty = draft !== null && draft !== doc.content;
  const drawings = annotations.flatMap((a) => ('drawing' in a.target && a.points ? [{ points: a.points }] : []));
  const docUrl = docApiPath(projectId, path);

  function changeMode(next: Mode) {
    setMode(next);
    setPick(null);
    setDraw(null);
    setHighlight(null);
  }

  // 키보드용: 미리보기 클릭과 같은 주석 팝업을 연다
  function pickByName(name: string) {
    if (!loadInfo || !name) return;
    const parsed = new DOMParser().parseFromString(doc!.content, 'text/html');
    const el = Array.from(parsed.querySelectorAll('[data-component]')).find(
      (e) => e.getAttribute('data-component') === name,
    );
    if (!el) return;
    const duplicates = new Set(loadInfo.duplicates);
    const parents: string[] = [];
    let p = el.parentElement?.closest('[data-component]') ?? null;
    while (p) {
      const n = p.getAttribute('data-component') ?? '';
      if (n && !duplicates.has(n)) parents.push(n);
      p = p.parentElement?.closest('[data-component]') ?? null;
    }
    setPick({ component: name, tag: el.localName, text: truncateLabel(el.textContent ?? ''), parents });
  }

  function onLink(href: string | null) {
    const target = screenLinkTarget(href);
    if (!target) return;
    if (!screenPaths.includes(target)) {
      setMsg({ tone: 'warn', text: `없는 화면입니다: ${target}` });
      return;
    }
    onLinkNavigate(target);
  }

  // 저장하지 않은 편집이 있으면 먼저 정리해 저장한다. 실패하면 false.
  async function saveDraft(): Promise<boolean> {
    if (!dirty || draft === null) return true;
    setBusy(true);
    setMsg(null);
    try {
      await api('PUT', docUrl, { content: sanitizeHtml(draft) });
      setDraft(null);
      await refresh();
      return true;
    } catch (e) {
      setMsg(errorOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (await saveDraft()) setEditOpen(false);
  }

  async function generate(feedbackText?: string) {
    setMsg(null);
    if (!(await saveDraft())) return;
    const body = feedbackText ? { agent, feedback: feedbackText } : { agent };
    const r = await run.start(docApiPath(projectId, path, 'generate'), body);
    if (!r.ok) return;

    const clean = sanitizeHtml(extractHtml(r.text));
    if (!clean) {
      setMsg({ tone: 'error', text: '생성 결과에 화면 HTML이 없습니다. 다시 생성해 주세요.' });
      return;
    }
    setBusy(true);
    try {
      // generatedBy는 이 저장에만 보낸다 (화면 재생성이 "앞 문서 변경됨"을 지우게)
      await api('PUT', docUrl, { content: clean, keepUndo: true, generatedBy: agent });
      setFeedback('');
      await refresh();
    } catch (e) {
      setMsg(errorOf(e));
    } finally {
      setBusy(false);
    }
  }

  const gate = doc.generate;
  async function saveDesign() {
    setBusy(true);
    setMsg(null);
    try {
      await api('PUT', `/api/projects/${projectId}/design`, { designMd });
      await refresh();
    } catch (error) {
      setMsg(errorOf(error));
    } finally {
      setBusy(false);
    }
  }
  const gateNotice = !gate.ok && (
    <Notice tone="warn">
      {gate.code === 'design_required' ? (
        <p className="notice-body">
          {REASON_KO.design_required}
        </p>
      ) : (
        <p className="notice-body">{gate.reason}</p>
      )}
      {!gate.ok && gate.items && gate.items.length > 0 && (
        <ul className="caption">
          {gate.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </Notice>
  );

  const generatorBlock = (
    <div className="stack">
      <AgentPicker value={agent} onChange={setAgent} disabled={locked} />
      <RunStatus run={run} agent={agent} />
    </div>
  );

  return (
    <div className="stack">
      <header className="stack">
        <h2 className="title">{nameOf(path)}</h2>
        <p className="caption">{path}</p>
        {trail.length > 0 && (
          <div className="row">
            <p className="caption">지나온 화면: {trail.map(nameOf).join(' › ')}</p>
            <Button variant="utility" onClick={onBack}>
              뒤로
            </Button>
          </div>
        )}
      </header>

      <DocActions projectId={projectId} doc={doc} disabled={run.running || busy} refresh={refresh} />

      {msg && (
        <Notice tone={msg.tone} title={msg.tone === 'error' ? '처리하지 못했습니다' : undefined}>
          <p className="notice-body">{msg.text}</p>
          {msg.items && msg.items.length > 0 && (
            <ul className="caption">
              {msg.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {doc.status === 'empty' && (
        <div className="stack">
          {gateNotice}
          {!gate.ok && gate.code === 'design_required' && (
            <form className="stack" onSubmit={(event) => { event.preventDefault(); void saveDesign(); }}>
              <TextArea label="디자인 문서" value={designMd} onChange={(event) => setDesignMd(event.target.value)} disabled={locked} />
              <div><Button type="submit" variant="secondary" disabled={locked || !designMd.trim()}>저장</Button></div>
            </form>
          )}
          {generatorBlock}
          <Button variant="primary" disabled={locked || !gate.ok} onClick={() => void generate()}>
            화면 생성
          </Button>
        </div>
      )}

      {doc.status !== 'empty' && (
        <div className="stack">
          <div className="row">
            {loadInfo?.frame === 'page' && (
              <>
                <Button variant="utility" aria-pressed={width === 1280} onClick={() => setWidth(1280)}>
                  데스크톱 1280
                </Button>
                <Button variant="utility" aria-pressed={width === 390} onClick={() => setWidth(390)}>
                  휴대폰 390
                </Button>
              </>
            )}
            <Button variant="utility" disabled={approved} aria-pressed={mode === 'select'} onClick={() => changeMode(mode === 'select' ? 'off' : 'select')}>
              선택
            </Button>
            <Button variant="utility" disabled={approved} aria-pressed={mode === 'draw'} onClick={() => changeMode(mode === 'draw' ? 'off' : 'draw')}>
              그리기
            </Button>
            {!approved && loadInfo && loadInfo.unique.length > 0 && (
              <select
                aria-label="컴포넌트를 이름으로 고르기"
                value=""
                disabled={locked}
                onChange={(e) => pickByName(e.target.value)}
              >
                <option value="">컴포넌트 이름으로 고르기</option>
                {loadInfo.unique.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
            <Button variant="utility" disabled={approved || locked} onClick={() => {
              if (draft === null) setDraft(doc.content);
              setEditOpen(true);
            }}>
              전체 HTML 편집
            </Button>
            {dirty && <span className="caption">저장 안 한 변경이 있습니다</span>}
          </div>

          {loadInfo && loadInfo.missing.length > 0 && (
            <Notice tone="warn" title="없는 화면으로 가는 링크">
              <ul className="caption">
                {loadInfo.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <p className="caption">승인은 막지 않습니다.</p>
            </Notice>
          )}
          {loadInfo && loadInfo.duplicates.length > 0 && (
            <Notice tone="warn" title="이름이 겹치는 컴포넌트">
              <ul className="caption">
                {loadInfo.duplicates.map((n) => (
                  <li key={n}>{n} (선택·교체 대상에서 뺌)</li>
                ))}
              </ul>
            </Notice>
          )}
          {loadInfo && loadInfo.unique.length === 0 && loadInfo.duplicates.length === 0 && (
            <Notice tone="warn">
              <p className="notice-body">고를 컴포넌트가 없습니다. 전체 재생성으로 고치세요.</p>
            </Notice>
          )}

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 390px', minWidth: 0 }}>
              <ScreenPreview
                html={doc.content}
                width={width}
                mode={approved ? 'off' : mode}
                highlight={highlight}
                drawings={drawings}
                onLink={onLink}
                onPick={(p) => setPick(p)}
                onDraw={(d) => setDraw(d)}
                onLoad={({ frame, components, doc: iframeDoc }) =>
                  setLoadInfo({
                    frame,
                    duplicates: components.duplicates,
                    unique: components.unique,
                    missing: missingScreenLinks(iframeDoc, screenPaths),
                  })
                }
              />
            </div>
            <div style={{ flex: '0 1 320px', minWidth: 260 }}>
              <AnnotationPanel
                projectId={projectId}
                path={path}
                disabled={approved}
                pick={pick}
                draw={draw}
                onClearPick={() => {
                  setPick(null);
                  setDraw(null);
                }}
                onHighlight={setHighlight}
                onSent={refresh}
                html={doc.content}
              />
            </div>
          </div>

          {doc.status === 'draft' && (
            <div className="stack">
              <h3 className="title">피드백</h3>
              {gateNotice}
              <TextArea label="피드백" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              {generatorBlock}
              <Button
                variant="primary"
                disabled={locked || !gate.ok || !feedback.trim()}
                onClick={() => void generate(feedback.trim())}
              >
                피드백 반영해 다시 생성
              </Button>
            </div>
          )}
        </div>
      )}

      <Modal wide open={editOpen} title="전체 HTML 편집" onClose={() => setEditOpen(false)}>
        <div className="stack">
          <TextArea
            label="화면 HTML"
            className="editor-input"
            spellCheck={false}
            value={draft ?? ''}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className="caption">저장할 때 스크립트·외부 삽입 요소·on* 속성·스크립트 링크를 지웁니다.</p>
          <div className="row">
            <Button variant="utility" onClick={() => setEditOpen(false)}>
              닫기
            </Button>
            <Button variant="utility" disabled={draft === null} onClick={() => setDraft(null)}>
              변경 버리기
            </Button>
            <Button variant="primary" disabled={locked || !dirty} onClick={() => void saveEdit()}>
              저장
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
