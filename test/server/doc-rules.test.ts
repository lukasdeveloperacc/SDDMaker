import { describe, expect, it } from 'vitest';
import type { DocumentRecord } from '@/lib/contract';
import {
  buildDocumentViews,
  computeMissing,
  exportGate,
  extractLinks,
  inputDocsFor,
  kindOf,
  laterWithContent,
  nameOf,
  screenFiles,
  stageOf,
  stripFence,
} from '@/server/doc-rules';

function rec(path: string, o: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    projectId: 1, path, content: '', previousContent: null, status: 'empty',
    upstreamChanged: false, agent: null, updatedAt: '2026-01-01T00:00:00.000Z', ...o,
  };
}

const PRODUCT = '# 제품\n\n- [프로젝트](requirements/project.md)\n';
const FLOW = '# 흐름\n\n- [홈](screens/home.html)\n';

// 0-PRODUCT·1·3·4 승인 + 요구사항 project 승인 + 화면 home 행 (나머지 empty).
function approvedChain(extra: DocumentRecord[] = []): DocumentRecord[] {
  return [
    rec('0-PRODUCT.md', { status: 'approved', content: PRODUCT }),
    rec('1-SYSTEM-ARCHITECTURE.md', { status: 'approved', content: '# 아키텍처' }),
    rec('3-DATABASE.md', { status: 'approved', content: '# DB' }),
    rec('4-USERFLOW.md', { status: 'approved', content: FLOW }),
    rec('requirements/project.md', { status: 'approved', content: '# project' }),
    rec('screens/home.html', { content: '<html></html>' }),
    rec('changes/001-mvp.md'),
    ...extra,
  ];
}

function view(docs: DocumentRecord[], path: string, o: Partial<Parameters<typeof buildDocumentViews>[0]> = {}) {
  const v = buildDocumentViews({ docs, interviewStatus: 'approved', hasDesign: false, running: null, ...o });
  const found = v.find((d) => d.path === path);
  if (!found) throw new Error(`no view ${path}`);
  return found;
}

describe('경로 규칙', () => {
  it('단계·종류·이름을 정한다', () => {
    expect(stageOf('0-PRODUCT.md')).toBe(1);
    expect(stageOf('requirements/project.md')).toBe(5);
    expect(stageOf('screens/home.html')).toBe(6);
    expect(stageOf('changes/001-mvp.md')).toBe(7);
    expect(kindOf('3-DATABASE.md')).toBe('base');
    expect(nameOf('requirements/project.md')).toBe('project');
    expect(nameOf('screens/home.html')).toBe('home');
    expect(nameOf('changes/001-mvp.md')).toBe('changes/001-mvp.md');
  });
});

describe('extractLinks', () => {
  it('일반 링크와 ./·#앵커를 처리하고 중복은 하나로 친다', () => {
    const md = '[a](requirements/project.md) [b](./requirements/b.md#x) [a2](requirements/project.md)';
    expect(extractLinks(md, 'requirements')).toEqual({ names: ['project', 'b'], invalid: [] });
  });

  it('코드 블록과 인라인 코드 안의 링크는 세지 않는다', () => {
    const md = '```\n[a](requirements/x.md)\n```\n\n`[b](requirements/y.md)`';
    expect(extractLinks(md, 'requirements')).toEqual({ names: [], invalid: [] });
  });

  it('예약 이름과 규칙 위반 이름은 invalid', () => {
    const md = '[a](requirements/Agents.md) [b](requirements/claude.md) [c](requirements/foo_bar.md)';
    expect(extractLinks(md, 'requirements')).toEqual({ names: [], invalid: ['Agents', 'claude', 'foo_bar'] });
  });

  it('요구사항 추출은 외부 링크와 화면 링크를 무시한다', () => {
    const md = '[x](https://example.com/requirements/a.md) [s](screens/home.html)';
    expect(extractLinks(md, 'requirements')).toEqual({ names: [], invalid: [] });
  });

  it('화면 추출도 같은 방식이고 요구사항 링크는 무시한다', () => {
    const md = '[h](screens/home.html) [r](requirements/a.md)';
    expect(extractLinks(md, 'screens')).toEqual({ names: ['home'], invalid: [] });
  });
});

describe('stripFence', () => {
  it('markdown 울타리 하나를 벗긴다', () => {
    expect(stripFence('```markdown\n# a\n```')).toBe('# a');
  });

  it('앞뒤 공백을 허용한다', () => {
    expect(stripFence('  \n```md\n# a\n```\n  ')).toBe('# a');
  });

  it('울타리가 본문 중간에만 있으면 그대로 둔다', () => {
    const text = '# a\n\n```\ncode\n```\n';
    expect(stripFence(text)).toBe('# a\n\n```\ncode\n```');
  });
});

describe('computeMissing', () => {
  it('승인된 0-PRODUCT에서 빠진 요구사항을 표시한다', () => {
    const docs = approvedChain([rec('requirements/old.md', { status: 'approved', content: 'x' })]);
    expect([...computeMissing(docs)]).toEqual(['requirements/old.md']);
  });

  it('기준 문서가 승인되지 않았으면 아무것도 빠지지 않는다', () => {
    const docs = [rec('0-PRODUCT.md', { content: PRODUCT }), rec('requirements/old.md', { content: 'x' })];
    expect(computeMissing(docs).size).toBe(0);
  });
});

describe('게이트 (§4.4)', () => {
  it('인터뷰가 active면 0-PRODUCT 생성은 precondition', () => {
    const docs = [rec('0-PRODUCT.md')];
    expect(view(docs, '0-PRODUCT.md', { interviewStatus: 'active' }).generate).toMatchObject({
      ok: false, code: 'precondition',
    });
  });

  it('인터뷰가 skipped면 0-PRODUCT 생성 가능', () => {
    expect(view([rec('0-PRODUCT.md')], '0-PRODUCT.md', { interviewStatus: 'skipped' }).generate).toEqual({ ok: true });
  });

  it('실행 중이면 모든 문서의 생성이 busy', () => {
    const docs = approvedChain();
    const v = view(docs, 'requirements/project.md', { running: { kind: 'document', path: '0-PRODUCT.md' } });
    expect(v.generate).toMatchObject({ ok: false, code: 'busy' });
  });

  it('승인된 문서 생성은 approved_locked', () => {
    expect(view(approvedChain(), '0-PRODUCT.md').generate).toMatchObject({ ok: false, code: 'approved_locked' });
  });

  it('요구사항 승인 전 화면 생성은 precondition이고, 디자인보다 먼저 본다', () => {
    const docs = approvedChain([]).map((d) =>
      d.path === 'requirements/project.md' ? { ...d, status: 'draft' as const } : d,
    );
    expect(view(docs, 'screens/home.html', { hasDesign: false }).generate).toMatchObject({ code: 'precondition' });
  });

  it('요구사항이 모두 승인돼 있고 디자인이 없으면 화면 생성은 design_required', () => {
    expect(view(approvedChain(), 'screens/home.html', { hasDesign: false }).generate).toMatchObject({
      ok: false, code: 'design_required',
    });
    expect(view(approvedChain(), 'screens/home.html', { hasDesign: true }).generate).toEqual({ ok: true });
  });

  it('새 프로젝트의 changes는 생성·승인 모두 precondition', () => {
    const docs = [rec('changes/001-mvp.md', { status: 'draft', content: '# 변경' })];
    const v = view(docs, 'changes/001-mvp.md', { interviewStatus: 'skipped' });
    expect(v.generate).toMatchObject({ ok: false, code: 'precondition' });
    expect(v.approve).toMatchObject({ ok: false, code: 'precondition' });
  });

  it('0-PRODUCT에 링크가 없으면 승인은 invalid_links', () => {
    const docs = [rec('0-PRODUCT.md', { status: 'draft', content: '# 제품 링크 없음' })];
    expect(view(docs, '0-PRODUCT.md').approve).toEqual({
      ok: false, code: 'invalid_links', reason: '요구사항 링크가 없습니다', items: [],
    });
  });

  it('0-PRODUCT에 규칙 위반 링크가 있으면 승인은 invalid_links와 항목', () => {
    const docs = [rec('0-PRODUCT.md', { status: 'draft', content: '[a](requirements/Agents.md)' })];
    expect(view(docs, '0-PRODUCT.md').approve).toMatchObject({ code: 'invalid_links', items: ['Agents'] });
  });

  it('승인 조건: 본문이 비면 invalid_state', () => {
    expect(view([rec('0-PRODUCT.md', { status: 'draft' })], '0-PRODUCT.md').approve).toMatchObject({
      code: 'invalid_state',
    });
  });

  it('승인 취소로 생긴 "앞 문서 변경됨"은 상태를 바꾸지 않는다', () => {
    const v = view(approvedChain(), '1-SYSTEM-ARCHITECTURE.md');
    expect(v.status).toBe('approved');
    expect(v.upstreamChanged).toBe(false);
  });

  it('previousContent가 있으면 canUndo', () => {
    expect(view([rec('0-PRODUCT.md', { previousContent: '예전' })], '0-PRODUCT.md').canUndo).toBe(true);
    expect(view([rec('0-PRODUCT.md')], '0-PRODUCT.md').canUndo).toBe(false);
  });

  it('목록에서 빠진 요구사항은 승인할 수 없다 (invalid_state)', () => {
    const docs = approvedChain([rec('requirements/old.md', { content: 'x', status: 'draft' })]);
    expect(view(docs, 'requirements/old.md').approve).toMatchObject({ ok: false, code: 'invalid_state' });
  });

  it('목록에서 빠진 요구사항은 missingFromList로 표시된다', () => {
    const docs = approvedChain([rec('requirements/old.md', { status: 'approved', content: 'x' })]);
    expect(view(docs, 'requirements/old.md').missingFromList).toBe(true);
    expect(view(docs, 'requirements/project.md').missingFromList).toBe(false);
  });
});

describe('laterWithContent', () => {
  it('뒤 단계 중 본문이 있는 문서만 고른다', () => {
    const docs = [
      rec('0-PRODUCT.md', { content: 'a' }),
      rec('1-SYSTEM-ARCHITECTURE.md', { content: 'b' }),
      rec('3-DATABASE.md'),
      rec('requirements/project.md', { content: 'c' }),
    ];
    expect(laterWithContent('0-PRODUCT.md', docs)).toEqual([
      '1-SYSTEM-ARCHITECTURE.md',
      'requirements/project.md',
    ]);
  });
});

describe('exportGate', () => {
  it('draft가 있으면 그 경로가 blocking', () => {
    const docs = [rec('0-PRODUCT.md', { status: 'draft', content: 'x' })];
    const g = exportGate(buildDocumentViews({ docs, interviewStatus: 'skipped', hasDesign: false, running: null }));
    expect(g.ok).toBe(false);
    expect(g.blocking).toContain('0-PRODUCT.md');
  });
});

describe('입력 문서', () => {
  it('요구사항 입력에는 다른 요구사항이 없다', () => {
    const docs = approvedChain([rec('requirements/other.md', { status: 'approved', content: 'o' })]);
    const paths = inputDocsFor('requirements/project.md', docs).map((d) => d.path);
    expect(paths.every((p) => kindOf(p) === 'base')).toBe(true);
    expect(paths).not.toContain('requirements/other.md');
  });

  it('변경 입력에는 화면 HTML이 없다', () => {
    const docs = approvedChain([rec('screens/home.html', { status: 'approved', content: '<html></html>' })]);
    const paths = inputDocsFor('changes/001-mvp.md', docs).map((d) => d.path);
    expect(paths).toContain('requirements/project.md');
    expect(paths.some((p) => p.startsWith('screens/'))).toBe(false);
  });
});

describe('screenFiles', () => {
  it('목록에서 빠진 화면은 뺀다', () => {
    const docs = approvedChain([rec('screens/old.html', { content: '<html></html>' })]);
    expect(screenFiles(docs)).toEqual(['screens/home.html']);
  });
});
