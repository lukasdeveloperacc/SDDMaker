'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { docApiPath } from '@/lib/contract';
import { api } from '@/lib/api';
import { missingScreenLinks, screenLinkTarget } from '@/lib/screens/html';
import { useAgentRun } from '@/lib/use-agent-run';
import { useAgentChoice } from '@/components/AgentChoice';
import { DocActions } from '@/components/DocActions';
import { RunStatus } from '@/components/RunStatus';
import { DESIGN_KEY } from '@/components/StageNav';
import { ScreenPreview } from '@/components/screens/ScreenPreview';
import { LivePanel } from '@/components/screens/LivePanel';
import type { PanelProps } from '@/components/documents/DocumentPanel';
import { Button, Notice, TextArea } from '@/components/ui';

export interface ScreenPanelProps extends PanelProps {
  trail: string[];
  onLinkNavigate: (path: string) => void;
  onBack: () => void;
}


type Msg = { tone: 'warn' | 'error'; text: string; items?: string[] };

const REASON_KO: Record<string, string> = {
  design_required: '프로젝트 디자인 문서가 없습니다.',
};

function nameOf(path: string): string {
  return path.replace(/^screens\//, '').replace(/\.html$/, '');
}

export function ScreenPanel({
  projectId,
  detail,
  path,
  refresh,
  onNavigate,
  trail,
  onLinkNavigate,
  onBack,
}: ScreenPanelProps) {
  const doc = detail.documents.find((d) => d.path === path);
  const screenPaths = useMemo(
    () => detail.documents.filter((d) => d.kind === 'screen').map((d) => d.path),
    [detail],
  );

  const agent = useAgentChoice();
  const run = useAgentRun();
  const [width, setWidth] = useState<1280 | 390>(1280);
  const [loadInfo, setLoadInfo] = useState<{
    frame: 'mobile' | 'page';
    missing: string[];
  } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [msg, setMsg] = useState<Msg | null>(null);
  const previewBox = useRef<HTMLDivElement>(null);

  // 링크를 눌러 이 화면으로 왔으면 흐름을 따라가기 좋게 화면을 가운데로 맞춘다.
  useEffect(() => {
    if (trail.length > 0) previewBox.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // 화면이 바뀔 때만 (이 패널은 화면마다 새로 만들어진다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!doc) return <Notice tone="error">문서를 찾지 못했습니다.</Notice>;

  const locked = run.running || doc.running;

  function onLink(href: string | null) {
    const target = screenLinkTarget(href);
    if (!target) return;
    if (!screenPaths.includes(target)) {
      setMsg({ tone: 'warn', text: `없는 화면입니다: ${target}` });
      return;
    }
    onLinkNavigate(target);
  }

  async function generate(feedbackText?: string) {
    setMsg(null);
    const body = feedbackText ? { agent, feedback: feedbackText } : { agent };
    // 서버가 끝나는 대로 저장한다 (화면을 떠나도, 다른 화면과 동시에 만들어도 이어진다).
    const r = await run.start(docApiPath(projectId, path, 'generate'), body);
    if (!r.ok) return;
    setFeedback('');
    await refresh();
  }

  const gate = doc.generate;
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
      {doc.running && !run.running && (
        <div className="row">
          <p className="caption">이 화면을 생성하고 있습니다.</p>
          <Button variant="utility" onClick={() => void api('DELETE', `/api/projects/${projectId}/run`).catch(() => {})}>취소</Button>
        </div>
      )}
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

      <DocActions projectId={projectId} doc={doc} disabled={run.running} refresh={refresh} />
      {doc.status !== 'empty' && <LivePanel projectId={projectId} name={nameOf(path)} refresh={refresh} />}

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
            <div>
              <Button variant="secondary" onClick={() => onNavigate(DESIGN_KEY)}>
                디자인 문서 만들기
              </Button>
            </div>
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

          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div ref={previewBox} style={{ flex: '1 1 390px', minWidth: 0 }}>
              <ScreenPreview
                html={doc.content}
                width={width}
                mode="off"
                highlight={null}
                drawings={[]}
                onLink={onLink}
                onPick={() => {}}
                onDraw={() => {}}
                onLoad={({ frame, doc: iframeDoc }) =>
                  setLoadInfo({
                    frame,
                    missing: missingScreenLinks(iframeDoc, screenPaths),
                  })
                }
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

    </div>
  );
}
