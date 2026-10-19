import { describe, expect, it } from 'vitest';
import { acquireRun } from '@/server/runtime';
import { createInterview, createProject, insertEmptyDocuments, updateDocument } from '@/server/db';
import { documentView, projectDetail, projectSummaries } from '@/server/documents';

describe('프로젝트 상세 조립', () => {
  it('없는 프로젝트는 null', () => {
    expect(projectDetail(987654)).toBeNull();
  });

  it('인터뷰·문서·실행 상태·내보내기 게이트를 돌려준다', () => {
    const p = createProject({ name: 'a', idea: 'b', designMd: null });
    createInterview(p.id, 'claude', 'active');
    const d = projectDetail(p.id);
    expect(d?.interview).toMatchObject({ status: 'active', agent: 'claude', hasSession: false, messages: [] });
    expect(d?.documents).toHaveLength(5);
    expect(d?.running).toBeNull();
    expect(d?.exportGate.ok).toBe(false);
  });

  it('실행 중이면 running이 보이고 모든 생성이 busy', () => {
    const p = createProject({ name: 'c', idea: 'd', designMd: null });
    const handle = acquireRun(p.id, 'document', '0-PRODUCT.md');
    try {
      const d = projectDetail(p.id);
      expect(d?.running).toEqual({ kind: 'document', path: '0-PRODUCT.md' });
      expect(d?.documents.every((v) => v.generate.ok === false && v.generate.code === 'busy')).toBe(true);
    } finally {
      handle?.release();
    }
  });

  it('documentView는 하나를 고르고, 없는 경로는 null', () => {
    const p = createProject({ name: 'e', idea: 'f', designMd: null });
    expect(documentView(p.id, '0-PRODUCT.md')?.name).toBe('0-PRODUCT.md');
    expect(documentView(p.id, 'requirements/none.md')).toBeNull();
  });

  it('projectSummaries는 목록에서 빠진 문서를 세지 않는다', () => {
    const p = createProject({ name: 'g', idea: 'h', designMd: null });
    updateDocument(p.id, '0-PRODUCT.md', { status: 'approved', content: '[p](requirements/project.md)' });
    insertEmptyDocuments(p.id, ['requirements/project.md', 'requirements/old.md']);
    updateDocument(p.id, 'requirements/old.md', { status: 'approved', content: 'x' });
    const s = projectSummaries().find((x) => x.id === p.id);
    // 기본 4 + 변경 1 + 요구사항 project = 6 (old는 빠짐). 승인: 0-PRODUCT 1.
    expect(s).toMatchObject({ totalCount: 6, approvedCount: 1 });
  });
});
