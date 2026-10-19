'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentName, Annotation, Box, PromptPreviewResponse } from '@/lib/contract';
import { docApiPath } from '@/lib/contract';
import { api, ApiRequestError } from '@/lib/api';
import { applyBlocks, type MergeResult } from '@/lib/screens/html';
import { truncateLabel } from '@/lib/screens/geometry';
import { toPayload, useAnnotations, type StoredAnnotation } from '@/lib/screens/annotations-store';
import { useAgentRun } from '@/lib/use-agent-run';
import { AgentPicker } from '@/components/AgentPicker';
import { RunStatus } from '@/components/RunStatus';
import { Button, Modal, Notice, TextArea } from '@/components/ui';

type Pt = { x: number; y: number };
export interface PickInfo { component: string; tag: string; text: string; parents: string[] }
export interface DrawInfo { points: Pt[]; box: Box; components: string[] }
export type Highlight = { component?: string; drawingIndex?: number } | null;

export interface AnnotationPanelProps {
  projectId: number;
  path: string;
  disabled: boolean;
  pick: PickInfo | null;
  draw: DrawInfo | null;
  onClearPick: () => void;
  onHighlight: (h: Highlight) => void;
  onSent: () => Promise<void>;
  html: string;
}

const REASON_TEXT: Record<MergeResult['warnings'][number]['reason'], string> = {
  not_found: '현재 화면에 없는 컴포넌트라 적용하지 않았습니다',
  multiple_roots: '최상위 요소가 둘 이상이라 적용하지 않았습니다',
  no_component: 'data-component가 없어 적용하지 않았습니다',
  duplicate: '같은 이름이 여러 개라 적용하지 않았습니다',
  nested: '다른 컴포넌트 안에 있어 바깥 것만 적용했습니다',
};

function findComponent(html: string, name: string): Element | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('[data-component]')).find((el) => el.getAttribute('data-component') === name) ?? null;
}

function targetLabel(a: StoredAnnotation): string {
  if ('drawing' in a.target) return `그림 · ${a.target.drawing.components.join(', ') || '겹치는 컴포넌트 없음'}`;
  return `${a.target.tag} · ${a.target.component}${a.target.text ? ` · ${a.target.text}` : ''}`;
}

export function AnnotationPanel({
  projectId,
  path,
  disabled,
  pick,
  draw,
  onClearPick,
  onHighlight,
  onSent,
  html,
}: AnnotationPanelProps) {
  const [annotations, setAnnotations] = useAnnotations(projectId, path);
  const run = useAgentRun();
  const [agent, setAgent] = useState<AgentName>('claude');
  const [kind, setKind] = useState<Annotation['kind']>('change');
  const [note, setNote] = useState('');
  const [up, setUp] = useState(0); // 상위 컴포넌트로 몇 번 올라갔는지
  const [editing, setEditing] = useState<{ index: number; kind: Annotation['kind']; note: string } | null>(null);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'warn' | 'error'; text: string; items?: string[] } | null>(null);
  const [result, setResult] = useState<{ text: string; warnings: MergeResult['warnings'] } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUp(0);
  }, [pick]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // 팝업에 보여 줄 대상. 상위 컴포넌트는 이름만 오므로 태그·글은 현재 HTML에서 읽는다.
  const target = useMemo(() => {
    if (!pick) return null;
    if (up === 0) return { component: pick.component, tag: pick.tag, text: pick.text };
    const name = pick.parents[up - 1];
    const el = findComponent(html, name);
    return { component: name, tag: el?.localName ?? 'div', text: truncateLabel(el?.textContent ?? '') };
  }, [pick, up, html]);

  const drawingIndexOf = (index: number) =>
    annotations.slice(0, index).filter((a) => 'drawing' in a.target).length;

  function highlightOf(index: number): Highlight {
    const a = annotations[index];
    if ('drawing' in a.target) return { drawingIndex: drawingIndexOf(index) };
    return { component: a.target.component };
  }

  function add() {
    const trimmed = note.trim();
    if (!trimmed) return;
    if (pick && target) {
      setAnnotations([...annotations, { kind, target, note: trimmed }]);
    } else if (draw) {
      setAnnotations([
        ...annotations,
        { kind, target: { drawing: { box: draw.box, components: draw.components } }, note: trimmed, points: draw.points },
      ]);
    } else {
      return;
    }
    setNote('');
    setKind('change');
    onClearPick();
  }

  function saveEdit() {
    if (!editing || !editing.note.trim()) return;
    const next = annotations.map((a, i) => (i === editing.index ? { ...a, kind: editing.kind, note: editing.note.trim() } : a));
    setAnnotations(next);
    setEditing(null);
  }

  async function showPreview() {
    setMsg(null);
    setBusy(true);
    try {
      const r = await api<PromptPreviewResponse>('POST', docApiPath(projectId, path, 'annotations/preview'), {
        annotations: toPayload(annotations),
      });
      setPromptText(r.prompt);
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof ApiRequestError ? e.message : '요청을 처리하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  }

  function flashApplied(names: string[]) {
    if (names.length === 0) return;
    onHighlight({ component: names[0] });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onHighlight(null), 2000);
  }

  async function send() {
    setMsg(null);
    setResult(null);
    const hasChange = annotations.some((a) => a.kind === 'change');
    const r = await run.start(docApiPath(projectId, path, 'annotations'), { agent, annotations: toPayload(annotations) });
    if (!r.ok) return;

    const merged = applyBlocks(html, r.text);
    setResult({ text: merged.text, warnings: merged.warnings });

    if (merged.applied.length > 0) {
      setBusy(true);
      try {
        await api('PUT', docApiPath(projectId, path), { content: merged.html, keepUndo: true });
      } catch (e) {
        setMsg({
          tone: 'error',
          text: e instanceof ApiRequestError ? e.message : '저장하지 못했습니다. 주석 목록은 그대로 두었습니다.',
        });
        return;
      } finally {
        setBusy(false);
      }
      flashApplied(merged.applied);
      setAnnotations([]);
      await onSent();
    } else if (hasChange) {
      setMsg({ tone: 'warn', text: '적용할 블록이 없습니다. 저장하지 않았고 주석 목록은 그대로 두었습니다.' });
    }
  }

  const locked = disabled || run.running || busy;

  return (
    <div className="stack">
      <h3 className="title">주석 목록 ({annotations.length})</h3>

      {disabled && <Notice tone="info">승인된 화면은 주석을 쓸 수 없습니다. 승인을 취소하면 다시 쓸 수 있습니다.</Notice>}

      {annotations.length === 0 && <p className="caption">미리보기에서 컴포넌트를 고르거나 그림을 그리면 여기에 쌓입니다.</p>}

      <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {annotations.map((a, i) => (
          <li key={i} className="card">
            {editing?.index === i ? (
              <div className="stack">
                <div className="row">
                  <Button variant="utility" aria-pressed={editing.kind === 'change'} onClick={() => setEditing({ ...editing, kind: 'change' })}>
                    수정
                  </Button>
                  <Button variant="utility" aria-pressed={editing.kind === 'question'} onClick={() => setEditing({ ...editing, kind: 'question' })}>
                    질문
                  </Button>
                </div>
                <TextArea label="설명" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
                <div className="row">
                  <Button variant="utility" onClick={() => setEditing(null)}>
                    취소
                  </Button>
                  <Button variant="primary" disabled={!editing.note.trim()} onClick={saveEdit}>
                    저장
                  </Button>
                </div>
              </div>
            ) : (
              <div className="stack">
                <button
                  type="button"
                  className="btn btn-utility"
                  style={{ textAlign: 'left', whiteSpace: 'normal', width: '100%' }}
                  onClick={() => onHighlight(highlightOf(i))}
                >
                  <span className="caption">{a.kind === 'change' ? '수정' : '질문'} · {targetLabel(a)}</span>
                </button>
                <p>{a.note}</p>
                <div className="row">
                  <Button variant="utility" disabled={disabled} onClick={() => setEditing({ index: i, kind: a.kind, note: a.note })}>
                    수정
                  </Button>
                  <Button
                    variant="utility"
                    disabled={disabled}
                    onClick={() => setAnnotations(annotations.filter((_, j) => j !== i))}
                  >
                    삭제
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="row">
        <Button variant="utility" disabled={locked || annotations.length === 0} onClick={() => void showPreview()}>
          보내기 전 미리보기
        </Button>
      </div>

      <div className="stack">
        <AgentPicker value={agent} onChange={setAgent} disabled={locked} />
        <Button variant="primary" disabled={locked || annotations.length === 0} onClick={() => void send()}>
          보내기
        </Button>
        <RunStatus run={run} agent={agent} />
      </div>

      {msg && (
        <Notice tone={msg.tone === 'error' ? 'error' : 'warn'}>
          <p className="notice-body">{msg.text}</p>
        </Notice>
      )}

      {result && (
        <Notice tone="info" title="에이전트 응답">
          {result.text && <p className="notice-body" style={{ whiteSpace: 'pre-wrap' }}>{result.text}</p>}
          {result.warnings.length > 0 && (
            <ul className="caption">
              {result.warnings.map((w, i) => (
                <li key={i}>
                  {w.name ? `${w.name}: ` : ''}
                  {REASON_TEXT[w.reason]}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      <Modal open={pick !== null || draw !== null} title="주석 추가" onClose={onClearPick}>
        <div className="stack">
          {pick && target && (
            <p className="caption">
              {target.tag} · {target.component}
              {target.text ? ` · ${target.text}` : ''}
            </p>
          )}
          {draw && <p className="caption">그린 영역 · {draw.components.length > 0 ? draw.components.join(', ') : '겹치는 컴포넌트 없음'}</p>}
          {pick && up < pick.parents.length && (
            <Button variant="utility" onClick={() => setUp(up + 1)}>
              상위 컴포넌트로
            </Button>
          )}
          <div className="row">
            <Button variant="utility" aria-pressed={kind === 'change'} onClick={() => setKind('change')}>
              수정
            </Button>
            <Button variant="utility" aria-pressed={kind === 'question'} onClick={() => setKind('question')}>
              질문
            </Button>
          </div>
          <TextArea
            label="설명"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add();
            }}
          />
          <div className="row">
            <Button variant="utility" onClick={onClearPick}>
              취소
            </Button>
            <Button variant="primary" disabled={!note.trim()} onClick={add}>
              추가 (⌘/Ctrl+Enter)
            </Button>
          </div>
        </div>
      </Modal>

      <Modal wide open={promptText !== null} title="보내기 전 미리보기" onClose={() => setPromptText(null)}>
        <pre className="prompt-preview">{promptText}</pre>
        <div className="row">
          <Button variant="utility" onClick={() => setPromptText(null)}>
            닫기
          </Button>
        </div>
      </Modal>
    </div>
  );
}
