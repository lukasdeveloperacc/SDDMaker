import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Markdown } from '@/components/Markdown';

type Tab = 'markdown' | 'preview' | 'extra';

// 입력과 미리 보기(와 있으면 보조 탭 하나)를 탭으로 나눠 한 번에 한 쪽만 보인다. 처음 탭은 마운트할 때 본문과 readOnly로 한 번만 정한다.
export function MarkdownEditor({
  value,
  onChange,
  readOnly,
  label,
  onLink,
  extra,
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  label: string;
  onLink?: (href: string) => boolean;
  extra?: { label: string; content: ReactNode };
}) {
  const groupName = useId();
  const keys: Tab[] = extra ? ['markdown', 'preview', 'extra'] : ['markdown', 'preview'];
  const names: Record<Tab, string> = { markdown: '마크다운', preview: '미리 보기', extra: extra?.label ?? '' };
  const [picked, setTab] = useState<Tab>(() => (value.trim() === '' && !readOnly ? 'markdown' : 'preview'));
  const tab = keys.includes(picked) ? picked : 'preview'; // 보조 탭이 사라지면 미리 보기로

  function tabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const at = keys.indexOf(tab);
    const moves: Record<string, Tab> = {
      ArrowLeft: keys[(at + keys.length - 1) % keys.length],
      ArrowRight: keys[(at + 1) % keys.length],
      Home: keys[0],
      End: keys[keys.length - 1],
    };
    const next = moves[event.key];
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(`${groupName}-${next}-tab`)?.focus();
  }

  return (
    <div>
      <div className="editor-tabs" role="tablist" aria-label={`${label} 보기 방식`}>
        {keys.map((key) => (
          <button key={key} type="button" role="tab" id={`${groupName}-${key}-tab`}
            aria-selected={tab === key} aria-controls={`${groupName}-panel`} tabIndex={tab === key ? 0 : -1}
            onKeyDown={tabKeyDown} onClick={() => setTab(key)}>
            {names[key]}
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
            onChange={(e) => onChange?.(e.target.value)}
          />
        ) : tab === 'preview' ? (
          <div className="editor-preview">
            <Markdown source={value} onLink={onLink} />
          </div>
        ) : (
          extra?.content
        )}
      </div>
    </div>
  );
}
