import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Annotation } from '@/lib/contract';
import {
  buildAnnotationPrompt,
  buildDocumentPrompt,
  buildInterviewAnswerPrompt,
  buildInterviewRebuildPrompt,
  buildInterviewStartPrompt,
  buildInterviewSummaryPrompt,
  readDocRules,
} from '@/server/prompts';

const REAL_RULES = fs.readFileSync(path.join(process.cwd(), 'docs', 'AGENTS.md'), 'utf8');

const base = {
  path: '0-PRODUCT.md',
  idea: '의료 행사 통역',
  summary: null,
  designMd: null,
  inputDocs: [],
  screenNames: [],
  screenFiles: [],
};

describe('문서 프롬프트', () => {
  it('첫 줄은 대상 문서이고, 문서 규칙 파일 내용이 그대로 들어간다', () => {
    const prompt = buildDocumentPrompt(base);
    expect(prompt.split('\n')[0]).toBe('대상 문서: 0-PRODUCT.md');
    expect(readDocRules()).toBe(REAL_RULES);
    expect(prompt).toContain(REAL_RULES.trimEnd());
  });

  it('출력 규칙에 본문만·예정 표시를 적는다', () => {
    const prompt = buildDocumentPrompt(base);
    expect(prompt).toContain('문서 본문만 출력한다');
    expect(prompt).toContain('`예정`을 표시한다');
  });

  it('디자인 문서가 없으면 2-DESIGN.md를 링크하지 않는다고 적고 디자인 절이 없다', () => {
    const prompt = buildDocumentPrompt(base);
    expect(prompt).toContain('2-DESIGN.md를 링크하지 않는다');
    expect(prompt).not.toContain('## 디자인 문서');
  });

  it('디자인 문서가 있으면 디자인 절이 들어간다', () => {
    const prompt = buildDocumentPrompt({ ...base, designMd: '# 토큰' });
    expect(prompt).toContain('## 디자인 문서\n# 토큰');
    expect(prompt).not.toContain('2-DESIGN.md를 링크하지 않는다');
  });

  it('피드백이면 현재 본문과 피드백을 넣는다', () => {
    const prompt = buildDocumentPrompt({ ...base, current: '현재 글', feedback: '더 짧게' });
    expect(prompt).toContain('## 현재 본문\n현재 글');
    expect(prompt).toContain('## 피드백\n더 짧게');
  });

  it('요구사항 프롬프트는 대상 기능 이름을 준다', () => {
    const prompt = buildDocumentPrompt({ ...base, path: 'requirements/project.md' });
    expect(prompt).toContain('대상 기능: project');
  });

  it('화면 프롬프트는 화면 이름 목록과 규칙을 준다', () => {
    const prompt = buildDocumentPrompt({
      ...base, path: 'screens/home.html', screenNames: ['home', 'detail'],
    });
    expect(prompt).toContain('대상 화면: home');
    expect(prompt).toContain('- detail');
    expect(prompt).toContain('```html 블록 하나');
  });

  it('변경 프롬프트는 화면 파일 목록을 주고 본문은 넣지 않는다', () => {
    const prompt = buildDocumentPrompt({
      ...base, path: 'changes/001-mvp.md', screenFiles: ['screens/home.html'],
    });
    expect(prompt).toContain('## 화면 파일 목록\n- screens/home.html');
  });
});

describe('주석 프롬프트', () => {
  it('screens.md 요청 템플릿과 같은 줄 구조로 조립한다', () => {
    const annotations: Annotation[] = [
      {
        kind: 'change',
        target: { component: 'filter-tabs', tag: 'button', text: '전체 229 · 제품명 229 · 의료용어 0' },
        note: '탭 간격을 넓혀 주세요',
      },
      {
        kind: 'question',
        target: { component: 'distribution-bar', tag: 'section', text: '분포 Train 4,981건 …' },
        note: '이 값은 무엇인가요?',
      },
      {
        kind: 'change',
        target: {
          drawing: { box: { x1: 0.52, y1: 0.4, x2: 0.71, y2: 0.48 }, components: ['filter-tabs', 'legend'] },
        },
        note: '여기 정렬을 맞춰 주세요',
      },
    ];
    const prompt = buildAnnotationPrompt({
      path: 'screens/home.html',
      annotations,
      html: '<html></html>',
      refs: [{ path: '0-PRODUCT.md', content: 'p' }],
      designMd: '# 토큰',
    });
    expect(prompt.split('\n').slice(0, 11)).toEqual([
      '대상 화면: screens/home.html',
      '',
      '## 요청',
      '1. [수정] 컴포넌트 `filter-tabs` (button, "전체 229 · 제품명 229 · 의료용어 0")',
      '   탭 간격을 넓혀 주세요',
      '2. [질문] 컴포넌트 `distribution-bar` (section, "분포 Train 4,981건 …")',
      '   이 값은 무엇인가요?',
      '3. [수정] 그림 — 영역 x 52%–71%, y 40%–48% / 겹치는 컴포넌트: `filter-tabs`, `legend`',
      '   여기 정렬을 맞춰 주세요',
      '',
      '## 응답 형식',
    ]);
    expect(prompt).toContain('## 현재 HTML\n<html></html>');
    expect(prompt).toContain('## 참고 문서\n\n### 0-PRODUCT.md\np\n\n### 2-DESIGN.md\n# 토큰');
  });

  it('겹치는 컴포넌트가 없으면 없음이라고 쓴다', () => {
    const prompt = buildAnnotationPrompt({
      path: 'screens/home.html',
      annotations: [{ kind: 'question', target: { drawing: { box: { x1: 0, y1: 0, x2: 0.1, y2: 0.1 }, components: [] } }, note: 'q' }],
      html: '', refs: [], designMd: null,
    });
    expect(prompt).toContain('겹치는 컴포넌트: 없음');
  });
});

describe('인터뷰 프롬프트', () => {
  it('시작·답변·요약 프롬프트의 첫 줄과 규칙', () => {
    expect(buildInterviewStartPrompt('아이디어').split('\n')[0]).toBe('[SDDMaker 인터뷰]');
    expect(buildInterviewStartPrompt('아이디어')).toContain('한 번에 질문 하나만');
    expect(buildInterviewAnswerPrompt('답').split('\n')[0]).toBe('[SDDMaker 인터뷰]');
    expect(buildInterviewSummaryPrompt().split('\n')[0]).toBe('[SDDMaker 인터뷰 요약]');
  });

  it('재구성 프롬프트는 대화 기록을 역할과 함께 넣는다', () => {
    const msgs = [
      { id: 1, role: 'agent' as const, content: '질문?', createdAt: 'x' },
      { id: 2, role: 'user' as const, content: '답', createdAt: 'x' },
    ];
    const prompt = buildInterviewRebuildPrompt('아이디어', msgs, { kind: 'answer' });
    expect(prompt).toContain('에이전트: 질문?');
    expect(prompt).toContain('사용자: 답');
    expect(buildInterviewRebuildPrompt('아이디어', msgs, { kind: 'summary' }).split('\n')[0]).toBe(
      '[SDDMaker 인터뷰 요약]',
    );
  });
});
