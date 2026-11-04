'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProjectDetail } from '@/lib/contract';
import { useAgentChoice } from '@/components/AgentChoice';
import { Button, Notice } from '@/components/ui';
import { useAgentRun } from '@/lib/use-agent-run';

const AUTO_KEY = 'sddmaker:auto-sync';

// "앞 문서 변경됨"이 붙은 요구사항·화면 정의서를 검사하고 필요하면 현재 본문 기준으로 갱신한다.
// 기본 문서가 모두 승인돼 있으면 자동으로 실행한다. 고칠 곳이 없는 문서는 승인 상태 그대로 표시만 지우고,
// 다시 쓴 문서는 초안이 되므로 검토 후 다시 승인한다. 진행은 단계 목록의 생성 중 배지로 본다.
export function SyncPanel({ projectId, detail, refresh }: { projectId: number; detail: ProjectDetail; refresh: () => Promise<void> }) {
  const agent = useAgentChoice();
  const run = useAgentRun();
  const [summary, setSummary] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  // null: 아직 저장된 설정을 읽기 전 (읽기 전에는 자동 실행하지 않는다)
  const [auto, setAuto] = useState<boolean | null>(null);
  const tried = useRef(new Set<string>());

  useEffect(() => {
    try {
      setAuto(localStorage.getItem(AUTO_KEY) !== 'off');
    } catch {
      setAuto(true);
    }
  }, []);

  const targets = detail.documents.filter(
    (d) => (d.kind === 'requirement' || d.kind === 'screen') && d.upstreamChanged && d.content.trim() !== '' && !d.missingFromList,
  );
  const baseApproved = detail.documents.filter((d) => d.kind === 'base').every((d) => d.status === 'approved');
  const idle = !run.running && detail.running === null;
  const signature = targets.map((d) => d.path).join(',');

  const start = async () => {
    setFailed([]);
    setSummary(null);
    try {
      const res = await run.start(`/api/projects/${projectId}/sync`, { agent });
      if (res.ok) {
        const out = JSON.parse(res.text) as { done: string[]; unchanged: string[]; failed: { path: string; message: string }[] };
        setSummary(`${out.done.length}개 갱신 · ${out.unchanged.length}개는 고칠 곳이 없어 표시만 지웠습니다.`);
        setFailed(out.failed.map((f) => `${f.path}: ${f.message}`));
      }
    } finally {
      await refresh();
    }
  };

  // 문서마다 자동 시도는 한 번뿐이다 (실패한 문서를 계속 되풀이하지 않는다. 다시 하려면 버튼).
  useEffect(() => {
    if (auto !== true || !idle || !baseApproved || !targets.some((d) => !tried.current.has(d.path))) return;
    for (const d of targets) tried.current.add(d.path);
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start는 매 렌더 새로 만들어지고, 위 조건이 중복 실행을 막는다
  }, [auto, idle, baseApproved, signature]);

  if (targets.length === 0 && !run.running && failed.length === 0 && summary === null) return null;

  return (
    <section className="stack batch-side" aria-label="앞 문서 변경 반영">
      <div className="row">
        <Button variant="secondary" disabled={!idle || !baseApproved || targets.length === 0} onClick={() => void start()}>
          앞 문서 변경 반영 · {targets.length}개
        </Button>
        {run.running && <Button variant="utility" onClick={run.cancel}>취소</Button>}
      </div>
      <p className="caption">
        {run.running
          ? `앞 문서 변경을 검사하고 반영하는 중 · ${run.elapsedSec}초`
          : !baseApproved && targets.length > 0
            ? '기본 문서를 모두 승인하면 반영할 수 있습니다.'
            : targets.length > 0
              ? '표시된 문서를 검사해, 어긋난 곳만 고쳐 초안으로 돌립니다. 고칠 곳이 없으면 표시만 지웁니다.'
              : null}
      </p>
      {summary && <p className="caption">{summary} 다시 쓴 문서는 검토 후 다시 승인하세요.</p>}
      <label className="caption">
        <input
          type="checkbox"
          checked={auto === true}
          onChange={(e) => {
            setAuto(e.target.checked);
            try {
              localStorage.setItem(AUTO_KEY, e.target.checked ? 'on' : 'off');
            } catch {
              // 저장할 수 없으면 이번 화면에서만 적용한다
            }
          }}
        />{' '}
        앞 문서가 바뀌면 자동으로 반영
      </label>
      {run.error && <Notice tone="error" title="반영하지 못했습니다">{run.error.message}</Notice>}
      {failed.length > 0 && (
        <Notice tone="warn" title="일부 문서는 반영하지 못했습니다">
          <ul className="caption">{failed.map((f) => <li key={f}>{f}</li>)}</ul>
        </Notice>
      )}
    </section>
  );
}
