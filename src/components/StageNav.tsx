import type { CSSProperties, ReactNode } from 'react';
import type { DocumentView, Interview, ProjectDetail } from '@/lib/contract';
import { Badge } from '@/components/ui';

export const INTERVIEW_KEY = 'interview';
export const EXPORT_KEY = 'export';

// 인터뷰가 끝났는지(승인 또는 건너뜀). 끝나야 기본 문서를 만들 수 있다.
export function isInterviewDone(interview: Interview | null): boolean {
  return interview?.status === 'approved' || interview?.status === 'skipped';
}

// 처음 열었을 때 고를 단계: 아직 끝나지 않은 첫 단계. 목록에서 빠진 문서는 막지 않는다.
export function defaultStageKey(detail: ProjectDetail): string {
  if (!isInterviewDone(detail.interview)) return INTERVIEW_KEY;
  const open = detail.documents.find((d) => d.status !== 'approved' && !d.missingFromList);
  return open ? open.path : EXPORT_KEY;
}

const INTERVIEW_TEXT: Record<Interview['status'] | 'none', { text: string; tone: 'neutral' | 'success' | 'info' }> = {
  none: { text: '없음', tone: 'neutral' },
  active: { text: '진행 중', tone: 'info' },
  summarized: { text: '요약됨', tone: 'info' },
  approved: { text: '승인', tone: 'success' },
  skipped: { text: '건너뜀', tone: 'neutral' },
};

const STATUS_TEXT: Record<DocumentView['status'], { text: string; tone: 'neutral' | 'success' | 'info' }> = {
  empty: { text: '비어 있음', tone: 'neutral' },
  draft: { text: '초안', tone: 'info' },
  approved: { text: '승인', tone: 'success' },
};

function docLabel(d: DocumentView): string {
  return d.kind === 'requirement' || d.kind === 'screen' ? d.name : d.path;
}

function docBadges(d: DocumentView): ReactNode[] {
  const s = STATUS_TEXT[d.status];
  const out: ReactNode[] = [<Badge key="status" tone={s.tone}>{s.text}</Badge>];
  if (d.running) out.push(<Badge key="run" tone="info">실행 중</Badge>);
  if (d.upstreamChanged) out.push(<Badge key="up" tone="warn">앞 문서 변경됨</Badge>);
  if (d.missingFromList) out.push(<Badge key="miss" tone="warn">목록에서 빠짐</Badge>);
  return out;
}

const itemBase: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-xs)',
  width: '100%',
  paddingTop: 'var(--space-xs)',
  paddingRight: 'var(--space-sm)',
  paddingBottom: 'var(--space-xs)',
  paddingLeft: 'var(--space-sm)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 'var(--radius-md)',
  backgroundColor: 'transparent',
  color: 'var(--color-ink)',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 400,
  lineHeight: 1.5,
  textAlign: 'left',
  cursor: 'pointer',
};
// 선택됨: 파란 테두리·글자로 구분한다
const itemSelected: CSSProperties = {
  ...itemBase,
  backgroundColor: 'var(--color-surface)',
  borderColor: 'var(--color-primary)',
  color: 'var(--color-primary)',
  fontWeight: 600,
};

function Item({
  label,
  selected,
  onSelect,
  badges,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  badges: ReactNode[];
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'step' : undefined}
        style={selected ? itemSelected : itemBase}
      >
        <span>{label}</span>
        <span className="row" style={{ gap: 'var(--space-xxs)' }}>
          {badges}
        </span>
      </button>
    </li>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="stack" style={{ gap: 'var(--space-xxs)' }}>
      <p className="eyebrow caption" style={{ margin: '0 0 var(--space-xxs) var(--space-sm)' }}>
        {title}
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-xxs)' }}>
        {children}
      </ul>
    </div>
  );
}

export function StageNav({
  detail,
  selected,
  onSelect,
}: {
  detail: ProjectDetail;
  selected: string;
  onSelect: (k: string) => void;
}) {
  const iv = detail.interview;
  const ivKey: Interview['status'] | 'none' = iv ? iv.status : 'none';
  const docs = (kind: DocumentView['kind']) => detail.documents.filter((d) => d.kind === kind);
  const itemFor = (d: DocumentView) => (
    <Item
      key={d.path}
      label={docLabel(d)}
      selected={selected === d.path}
      onSelect={() => onSelect(d.path)}
      badges={docBadges(d)}
    />
  );
  const exportOk = detail.exportGate.ok;

  return (
    <nav aria-label="단계" className="stack">
      <Group title="인터뷰">
        <Item
          label="인터뷰"
          selected={selected === INTERVIEW_KEY}
          onSelect={() => onSelect(INTERVIEW_KEY)}
          badges={[
            <Badge key="iv" tone={INTERVIEW_TEXT[ivKey].tone}>
              {INTERVIEW_TEXT[ivKey].text}
            </Badge>,
          ]}
        />
      </Group>

      <Group title="기본 문서">{docs('base').map(itemFor)}</Group>

      <Group title="요구사항 문서">
        {docs('requirement').length > 0 ? (
          docs('requirement').map(itemFor)
        ) : (
          <li className="caption">0-PRODUCT.md를 승인하면 목록이 정해집니다.</li>
        )}
      </Group>

      <Group title="화면 정의서">
        {docs('screen').length > 0 ? (
          docs('screen').map(itemFor)
        ) : (
          <li className="caption">화면 목록이 정해지면 나타납니다.</li>
        )}
      </Group>

      <Group title="변경 기록">{docs('change').map(itemFor)}</Group>

      <Group title="내보내기">
        <Item
          label="내보내기"
          selected={selected === EXPORT_KEY}
          onSelect={() => onSelect(EXPORT_KEY)}
          badges={[
            exportOk ? (
              <Badge key="ex" tone="success">가능</Badge>
            ) : (
              <Badge key="ex" tone="warn">확인 필요</Badge>
            ),
          ]}
        />
      </Group>
    </nav>
  );
}
