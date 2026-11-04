import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StageNav, defaultStageKey, isInterviewDone } from '@/components/StageNav';
import { interviewPhase } from '@/components/InterviewPanel';
import type { DocumentView, Interview, ProjectDetail } from '@/lib/contract';

function doc(path: string, over: Partial<DocumentView> = {}): DocumentView {
  return {
    path,
    kind: 'base',
    stage: 1,
    name: path,
    content: '',
    status: 'empty',
    agent: null,
    updatedAt: '',
    upstreamChanged: false,
    missingFromList: false,
    canUndo: false,
    running: false,
    generate: { ok: true },
    approve: { ok: true },
    links: null,
    ...over,
  } as DocumentView;
}

function iv(over: Partial<Interview>): Interview {
  return { status: 'active', agent: 'claude', hasSession: true, summary: null, messages: [], ...over };
}

function detail(interview: Interview | null, documents: DocumentView[]): ProjectDetail {
  return {
    project: { id: 1, name: 'p', idea: 'i', designMd: null, createdAt: '', repo: null },
    batch: null,
    repoContext: null,
    interview,
    documents,
    running: null,
    exportGate: { ok: false, blocking: [], upstreamChanged: [] },
  };
}

describe('defaultStageKey', () => {
  it('인터뷰가 끝나지 않았으면 인터뷰', () => {
    expect(defaultStageKey(detail(null, [doc('0-PRODUCT.md')]))).toBe('interview');
    expect(defaultStageKey(detail(iv({ status: 'summarized' }), []))).toBe('interview');
  });

  it('인터뷰를 승인하거나 건너뛰면 아직 승인 안 된 첫 문서', () => {
    const docs = [doc('0-PRODUCT.md', { status: 'approved' }), doc('1-SYSTEM-ARCHITECTURE.md')];
    expect(defaultStageKey(detail(iv({ status: 'approved' }), docs))).toBe('1-SYSTEM-ARCHITECTURE.md');
    expect(defaultStageKey(detail(iv({ status: 'skipped' }), docs))).toBe('1-SYSTEM-ARCHITECTURE.md');
  });

  it('목록에서 빠진 문서는 막지 않는다', () => {
    const docs = [doc('0-PRODUCT.md', { status: 'approved' }), doc('requirements/x.md', { kind: 'requirement', missingFromList: true })];
    expect(defaultStageKey(detail(iv({ status: 'approved' }), docs))).toBe('export');
  });
});

describe('isInterviewDone', () => {
  it('승인과 건너뜀만 끝난 것', () => {
    expect(isInterviewDone(null)).toBe(false);
    expect(isInterviewDone(iv({ status: 'approved' }))).toBe(true);
    expect(isInterviewDone(iv({ status: 'skipped' }))).toBe(true);
    expect(isInterviewDone(iv({ status: 'active' }))).toBe(false);
  });
});

describe('interviewPhase', () => {
  it('인터뷰가 없거나 세션 없는 active면 시작 화면', () => {
    expect(interviewPhase(null)).toBe('start');
    expect(interviewPhase(iv({ hasSession: false }))).toBe('start');
  });

  it('세션 있는 active면 대화, 나머지는 상태대로', () => {
    expect(interviewPhase(iv({ hasSession: true }))).toBe('chat');
    expect(interviewPhase(iv({ status: 'summarized' }))).toBe('summary');
    expect(interviewPhase(iv({ status: 'approved' }))).toBe('approved');
    expect(interviewPhase(iv({ status: 'skipped' }))).toBe('skipped');
  });
});

describe('StageNav 화면 정의서', () => {
  const render = (repo: string | null) => {
    const d = detail(iv({ status: 'approved' }), [doc('0-PRODUCT.md', { status: 'approved' }), doc('screens/a.md', { kind: 'screen', name: 'screens/a.md' })]);
    d.project.repo = repo;
    return renderToStaticMarkup(createElement(StageNav, { detail: d, selected: 'export', onSelect: () => {} }));
  };

  it('저장소 프로젝트도 화면 정의서 그룹을 보여 준다 (화면 링크가 있으면 프로토타입을 만든다)', () => {
    const html = render('octo/app');
    expect(html).toContain('화면 정의서');
    expect(html).toContain('screens/a.md');
  });

  it('저장소가 없는 프로젝트는 화면 정의서 그룹을 그대로 보여 준다', () => {
    const html = render(null);
    expect(html).toContain('화면 정의서');
    expect(html).toContain('screens/a.md');
  });
});

describe('디자인 단계', () => {
  const screen = (over: Partial<DocumentView> = {}) => doc('screens/home.html', { kind: 'screen', name: 'home', ...over });
  const withDesign = (docs: DocumentView[], designMd: string | null = null, repo: string | null = null) => {
    const d = detail(iv({ status: 'approved' }), docs);
    d.project.designMd = designMd;
    d.project.repo = repo;
    return d;
  };
  const nav = (d: ProjectDetail) => renderToStaticMarkup(createElement(StageNav, { detail: d, selected: 'export', onSelect: () => {} }));

  it('디자인 문서가 없으면 첫 화면 대신 디자인 단계를 열고, 있으면 화면을 연다', () => {
    const docs = [doc('0-PRODUCT.md', { status: 'approved' }), screen()];
    expect(defaultStageKey(withDesign(docs))).toBe('design');
    expect(defaultStageKey(withDesign(docs, '# 이미 붙여 넣은 문서'))).toBe('screens/home.html');
  });

  it('화면을 만드는 동안(초안)에는 그 화면에 머문다', () => {
    const docs = [doc('0-PRODUCT.md', { status: 'approved' }), screen({ status: 'draft', content: '<html></html>' })];
    expect(defaultStageKey(withDesign(docs, '# 문서'))).toBe('screens/home.html');
  });

  it('화면을 승인하면 다른 단계처럼 아직 승인 안 된 다음 화면으로 넘어간다', () => {
    const docs = [
      doc('0-PRODUCT.md', { status: 'approved' }),
      screen({ status: 'approved', content: '<html></html>' }),
      doc('screens/next.html', { kind: 'screen', name: 'next' }),
    ];
    expect(defaultStageKey(withDesign(docs, '# 문서'))).toBe('screens/next.html');
  });

  it('앞 문서가 남아 있으면 그 문서가 먼저다', () => {
    const docs = [doc('0-PRODUCT.md'), screen()];
    expect(defaultStageKey(withDesign(docs))).toBe('0-PRODUCT.md');
  });

  it('화면 목록이 있으면 단계 목록에 디자인 문서가 있음·없음과 함께 나온다', () => {
    const docs = [doc('0-PRODUCT.md', { status: 'approved' }), screen()];
    expect(nav(withDesign(docs))).toMatch(/디자인 문서<\/span>.*없음/);
    expect(nav(withDesign(docs, '# 문서'))).toMatch(/디자인 문서<\/span>.*있음/);
  });

  it('화면 목록이 없으면 숨기지만, 저장소 프로젝트는 화면이 없어도 보인다', () => {
    expect(nav(withDesign([doc('0-PRODUCT.md', { status: 'approved' })]))).not.toContain('디자인 문서');
    expect(nav(withDesign([doc('0-PRODUCT.md', { status: 'approved' })], null, 'octo/app'))).toContain('디자인 문서');
  });
});
