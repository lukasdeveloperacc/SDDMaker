import { useId, useState, type KeyboardEvent } from 'react';
import { Markdown } from '@/components/Markdown';

type Tab = 'markdown' | 'preview';

// 입력과 미리 보기를 탭으로 나눠 한 번에 한 쪽만 보인다. 처음 탭은 마운트할 때 본문과 readOnly로 한 번만 정한다.
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
  const groupName = useId();
  const [tab, setTab] = useState<Tab>(() => (value.trim() === '' && !readOnly ? 'markdown' : 'preview'));

  function tabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: Tab = event.key === 'Home' ? 'markdown' : event.key === 'End' ? 'preview' : tab === 'markdown' ? 'preview' : 'markdown';
    setTab(next);
    document.getElementById(`${groupName}-${next}-tab`)?.focus();
  }

  return (
    <div>
      <div className="editor-tabs" role="tablist" aria-label={`${label} 보기 방식`}>
        {(['markdown', 'preview'] as const).map((key) => (
          <button key={key} type="button" role="tab" id={`${groupName}-${key}-tab`}
            aria-selected={tab === key} aria-controls={`${groupName}-panel`} tabIndex={tab === key ? 0 : -1}
            onKeyDown={tabKeyDown} onClick={() => setTab(key)}>
            {key === 'markdown' ? '마크다운' : '미리 보기'}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${groupName}-panel`} aria-labelledby={`${groupName}-${tab}-tab`}>
        {tab === 'markdown' ? (
          <textarea
            className="editor-input"
            aria-label={label}
            value={value}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <div className="editor-preview">
            <Markdown source={value} />
          </div>
        )}
      </div>
    </div>
  );
}
