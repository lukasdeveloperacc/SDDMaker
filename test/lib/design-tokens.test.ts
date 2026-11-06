import { describe, expect, it } from 'vitest';
import { designTokensCss, projectTokensCss } from '@/lib/design-tokens';

const DOC = `---
name: Clinic
description: 진료실 통역
colors:
  primary: "#2285E8"
  onPrimary: "#FFFFFF"
typography:
  body:
    fontFamily: [Pretendard, system-ui, sans-serif]
    fontSize: 15px
    fontWeight: 400
rounded:
  md: 12px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
---

# Overview
`;

describe('designTokensCss', () => {
  it('머리말 토큰을 :root 변수로 바꾸고 참조는 var()로 잇는다', () => {
    const css = designTokensCss(DOC);
    expect(css).toContain(':root {');
    expect(css).toContain('  --colors-primary: #2285E8;');
    expect(css).toContain('  --colors-on-primary: #FFFFFF;');
    expect(css).toContain('  --typography-body-font-family: Pretendard, system-ui, sans-serif;');
    expect(css).toContain('  --typography-body-font-weight: 400;');
    expect(css).toContain('  --rounded-md: 12px;');
    expect(css).toContain('  --components-button-primary-background-color: var(--colors-primary);');
    expect(css).not.toContain('Clinic');
  });

  it('머리말이 없거나 읽을 수 없으면 빈 문자열', () => {
    expect(designTokensCss(null)).toBe('');
    expect(designTokensCss('# 디자인\n\n본문')).toBe('');
    expect(designTokensCss('---\ncolors: [unclosed\n---\n')).toBe('');
  });

  it('선언이나 style을 벗어나는 값은 버린다', () => {
    const css = designTokensCss('---\ncolors:\n  bad: "red; } body { display:none"\n  tag: "</style><b>"\n  ok: "#000"\n---\n');
    expect(css).not.toContain('bad');
    expect(css).not.toContain('</style>');
    expect(css).toContain('--colors-ok: #000;');
  });

  it('머리말이 없으면 디자인 시스템 페이지의 첫 :root 블록을 쓴다', () => {
    const page = '<html><head><style>:root { --color-primary: #00754A; }\n.btn{color:var(--color-primary)}</style></head></html>';
    expect(projectTokensCss('# 머리말 없음', page)).toContain(':root { --color-primary: #00754A; }');
    expect(projectTokensCss(DOC, page)).toContain('--colors-primary: #2285E8;'); // 머리말이 우선
    expect(projectTokensCss('# 머리말 없음', '<html></html>')).toBe('');
  });
});
