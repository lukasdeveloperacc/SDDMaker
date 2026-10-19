import fs from 'node:fs';
import type { Annotation, InterviewMessage } from '@/lib/contract';
import { docRulesFile } from './env';

// 문서 규칙은 호출할 때마다 파일에서 읽는다 (사본을 두지 않는다).
export function readDocRules(): string {
  return fs.readFileSync(docRulesFile(), 'utf8');
}

const PRODUCT_RULE = `- \`0-PRODUCT.md\`: 기능마다 \`[기능 이름](requirements/<기능>.md)\` 링크를 넣는다. <기능>은 영문 소문자·숫자·\`-\`만 쓰고, \`agents\`·\`claude\`는 쓰지 않는다.`;
const FLOW_RULE = `- \`4-USERFLOW.md\`: 화면마다 \`[화면 이름](screens/<화면>.html)\` 링크를 넣는다. 화면 이름은 영문 소문자·숫자·\`-\`만 쓴다. 화면이 없는 앱이면 링크를 넣지 않는다.`;
const SCREEN_RULES = [
  '- 스크립트와 외부 파일을 넣지 않는다. 글꼴·이미지도 외부에서 불러오지 않는다 (대체 글꼴 목록만 쓴다).',
  '- 색·글꼴·간격은 디자인 문서의 토큰을 쓴다.',
  '- 컴포넌트마다 파일 안에서 유일한 `data-component="<이름>"`을 붙인다 (영문 소문자·숫자·`-`).',
  '- `<html data-frame="…">`로 화면 크기를 밝힌다. 모바일 화면이면 `mobile`, 웹 페이지면 `page`. 앞 문서의 대상 기기·플랫폼을 보고 정한다.',
  '- 다른 화면으로 가는 버튼·링크는 `<a href="<화면>.html">`로 쓴다.',
  '- 모르는 값은 지어내지 않고 `[가격]`처럼 자리표시로 둔다. lorem ipsum과 지어낸 수치를 쓰지 않는다.',
  '- 실제 요소를 쓴다 (누르는 것은 `<button>`·`<a href>`, 입력은 `<input>`과 `<label>`). 아이콘만 있는 버튼에는 `aria-label`을 붙인다. 글자 대비는 4.5:1 이상.',
  '- 디자인 문서에 없는 장식(배경 그라데이션, 이모지 아이콘, 왼쪽 굵은 테두리 카드)을 넣지 않는다.',
];

function docInstruction(i: { path: string; screenNames: string[] }): string[] {
  if (i.path === '0-PRODUCT.md') return [PRODUCT_RULE];
  if (i.path === '4-USERFLOW.md') return [FLOW_RULE];
  if (i.path.startsWith('requirements/')) {
    return [`대상 기능: ${i.path.slice('requirements/'.length, -'.md'.length)}`];
  }
  if (i.path.startsWith('screens/')) {
    return [
      `대상 화면: ${i.path.slice('screens/'.length, -'.html'.length)}`,
      '',
      '## 프로젝트 화면 이름',
      ...(i.screenNames.length > 0 ? i.screenNames.map((n) => `- ${n}`) : ['(없음)']),
      '',
      '## 화면 파일 규칙',
      'docs/AGENTS.md의 "화면 정의서: screens/" 규칙을 전부 지킨다.',
      ...SCREEN_RULES,
      '- 출력은 ```html 블록 하나만 쓴다.',
    ];
  }
  return [];
}

export function buildDocumentPrompt(i: {
  path: string; idea: string; summary: string | null; designMd: string | null;
  inputDocs: { path: string; content: string }[]; screenNames: string[]; screenFiles: string[];
  current?: string; feedback?: string;
}): string {
  const isChange = i.path === 'changes/001-mvp.md';
  const out: string[] = [
    `대상 문서: ${i.path}`,
    '',
    ...docInstruction(i),
    '',
    '## 출력 규칙',
    '- 문서 본문만 출력한다 (서두·맺음말 없음).',
    '- 구현 전 상태이므로 `예정`을 표시한다.',
    ...(i.designMd === null || i.designMd.trim() === ''
      ? ['- 디자인 문서가 없으면 2-DESIGN.md를 링크하지 않는다.']
      : []),
    '',
    '## 문서 규칙 (AGENTS.md)',
    readDocRules().trimEnd(),
    '',
    '## 아이디어',
    i.idea,
  ];
  if (i.summary) out.push('', '## 인터뷰 요약', i.summary);
  if (i.designMd && i.designMd.trim() !== '') out.push('', '## 디자인 문서', i.designMd);
  out.push('', '## 승인된 앞 문서');
  if (i.inputDocs.length === 0) out.push('(없음)');
  for (const d of i.inputDocs) out.push('', `### ${d.path}`, d.content);
  if (isChange) out.push('', '## 화면 파일 목록', ...(i.screenFiles.length ? i.screenFiles.map((f) => `- ${f}`) : ['(없음)']));
  if (i.current !== undefined) out.push('', '## 현재 본문', i.current);
  if (i.feedback !== undefined) out.push('', '## 피드백', i.feedback);
  return out.join('\n') + '\n';
}

function label(a: Annotation): string {
  if ('component' in a.target) {
    const t = a.target;
    const text = [...t.text].slice(0, 40).join('');
    return `컴포넌트 \`${t.component}\` (${t.tag}, "${text}")`;
  }
  const { box, components } = a.target.drawing;
  const pct = (v: number) => Math.round(v * 100);
  const near = components.length ? components.map((c) => `\`${c}\``).join(', ') : '없음';
  return `그림 — 영역 x ${pct(box.x1)}%–${pct(box.x2)}%, y ${pct(box.y1)}%–${pct(box.y2)}% / 겹치는 컴포넌트: ${near}`;
}

// screens.md#요청-템플릿과 같은 줄 구조로 조립한다.
export function buildAnnotationPrompt(i: {
  path: string; annotations: Annotation[]; html: string;
  refs: { path: string; content: string }[]; designMd: string | null;
}): string {
  const items = i.annotations.flatMap((a, idx) => [
    `${idx + 1}. [${a.kind === 'change' ? '수정' : '질문'}] ${label(a)}`,
    `   ${a.note}`,
  ]);
  const refs = [...i.refs.map((r) => ({ path: r.path, content: r.content }))];
  if (i.designMd && i.designMd.trim() !== '') refs.push({ path: '2-DESIGN.md', content: i.designMd });
  return [
    `대상 화면: ${i.path}`,
    '',
    '## 요청',
    ...items,
    '',
    '## 응답 형식',
    '- [수정] 요청마다 바뀐 컴포넌트의 HTML 전체를 ```html 블록 하나로 준다. 블록의 최상위 요소는 원래와 같은 data-component를 가진다.',
    '- [질문]에는 블록 밖에 글로 답한다.',
    '- 화면 파일 규칙을 지킨다 (스크립트 없음, 외부 파일 없음, 디자인 문서 토큰).',
    '',
    '## 현재 HTML',
    i.html,
    '',
    '## 참고 문서',
    ...refs.flatMap((r) => ['', `### ${r.path}`, r.content]),
  ].join('\n') + '\n';
}

export function buildInterviewStartPrompt(idea: string): string {
  return [
    '[SDDMaker 인터뷰]',
    '',
    `아이디어: ${idea}`,
    '',
    '- 한 번에 질문 하나만 한다.',
    '- 충분하다고 판단하면 요약을 만들자고 제안한다.',
  ].join('\n');
}

export function buildInterviewAnswerPrompt(answer: string): string {
  return [
    '[SDDMaker 인터뷰]',
    '',
    `사용자 답변: ${answer}`,
    '',
    '- 한 번에 질문 하나만 한다.',
    '- 충분하다고 판단하면 요약을 만들자고 제안한다.',
  ].join('\n');
}

export function buildInterviewSummaryPrompt(): string {
  return [
    '[SDDMaker 인터뷰 요약]',
    '',
    '지금까지 대화 전체를 마크다운 요약으로 만든다. 요약 본문만 출력한다.',
  ].join('\n');
}

export function buildInterviewRebuildPrompt(
  idea: string,
  messages: InterviewMessage[],
  next: { kind: 'answer' } | { kind: 'summary' },
): string {
  const header = next.kind === 'summary' ? '[SDDMaker 인터뷰 요약]' : '[SDDMaker 인터뷰]';
  const history = messages.map((m) => `${m.role === 'agent' ? '에이전트' : '사용자'}: ${m.content}`);
  const todo =
    next.kind === 'summary'
      ? '지금까지 대화 전체를 마크다운 요약으로 만든다. 요약 본문만 출력한다.'
      : '위 대화를 이어서 한 번에 질문 하나만 한다. 충분하다고 판단하면 요약을 만들자고 제안한다.';
  return [header, '', `아이디어: ${idea}`, '', '지금까지 대화 기록:', ...history, '', `다음 할 일: ${todo}`].join('\n');
}
