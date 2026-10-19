import { TextArea } from '@/components/ui';

// 값은 그대로 주고받는다 (trim 하지 않음). 저장 규칙은 서버가 정한다.
export function DesignDocInput({
  value,
  onChange,
  label = '디자인 문서 (DESIGN.md, 선택)',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div>
      <TextArea
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      <p className="caption">
        가진 디자인 문서가 없으면{' '}
        <a href="https://getdesign.md/" target="_blank" rel="noopener noreferrer">
          getdesign.md
        </a>
        에서 만들 앱에 가장 가까운 것 하나를 골라 그 DESIGN.md를 복사해 붙여 넣으세요. 화면 정의서를 만들기 전까지 넣으면 됩니다.
      </p>
    </div>
  );
}
