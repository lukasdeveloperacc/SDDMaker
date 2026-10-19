import { Markdown } from '@/components/Markdown';

// 왼쪽 입력, 오른쪽 미리보기. 좁은 화면에서는 CSS가 위아래로 쌓는다.
export function MarkdownEditor({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  label: string;
}) {
  return (
    <div className="editor-split">
      <textarea
        className="editor-input"
        aria-label={label}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="editor-preview">
        <p className="eyebrow">미리보기</p>
        <Markdown source={value} />
      </div>
    </div>
  );
}
