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

  it('저장소 프로젝트는 데스크톱·모바일 모두 화면 정의서 그룹을 숨긴다', () => {
    const html = render('octo/app');
    expect(html).not.toContain('화면 정의서');
    expect(html).not.toContain('screens/a.md');
  });

  it('저장소가 없는 프로젝트는 화면 정의서 그룹을 그대로 보여 준다', () => {
    const html = render(null);
    expect(html).toContain('화면 정의서');
    expect(html).toContain('screens/a.md');
  });
});
