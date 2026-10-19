import type { ProjectDetail } from '@/lib/contract';
import { Button, Notice } from '@/components/ui';

export function ExportPanel({ projectId, detail }: { projectId: number; detail: ProjectDetail }) {
  const gate = detail.exportGate;
  return (
    <div className="stack">
      <h2 className="h3">내보내기</h2>
      <p className="caption">승인된 문서 세트를 docs/ 폴더 구조의 zip으로 받습니다.</p>

      {gate.ok ? (
        <div>
          <a className="btn btn-primary" href={`/api/projects/${projectId}/export`} download>
            zip 다운로드
          </a>
        </div>
      ) : (
        <div className="stack">
          <div>
            <Button variant="primary" disabled>
              zip 다운로드
            </Button>
          </div>
          <Notice tone="warn" title="아직 내보낼 수 없습니다">
            <p className="notice-body">승인되지 않았거나 목록에서 빠진 문서를 먼저 처리해 주세요.</p>
            <ul className="caption">
              {gate.blocking.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {gate.upstreamChanged.length > 0 && (
        <Notice tone="warn" title="앞 문서가 바뀐 문서가 있습니다">
          <p className="notice-body">내보내기는 막지 않지만, 아래 문서는 다시 확인하는 것이 좋습니다.</p>
          <ul className="caption">
            {gate.upstreamChanged.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}
