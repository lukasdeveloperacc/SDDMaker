import { describe, expect, it } from 'vitest';
import { checkProjectInput } from '@/components/projects/CreateProjectForm';
import { canConfirmDelete } from '@/components/projects/DeleteProjectDialog';

describe('checkProjectInput', () => {
  it('이름이나 아이디어가 비었거나 공백만이면 오류를 돌려준다', () => {
    expect(checkProjectInput('', 'x')).toEqual({ name: '프로젝트 이름을 입력하세요.' });
    expect(checkProjectInput('  ', 'x')).toEqual({ name: '프로젝트 이름을 입력하세요.' });
    expect(checkProjectInput('a', ' \n ')).toEqual({ idea: '아이디어를 입력하세요.' });
    expect(checkProjectInput('', '')).toEqual({
      name: '프로젝트 이름을 입력하세요.',
      idea: '아이디어를 입력하세요.',
    });
  });

  it('둘 다 채워져 있으면 null', () => {
    expect(checkProjectInput('SDD', '문서 만들기')).toBeNull();
  });
});

describe('canConfirmDelete', () => {
  it('이름이 정확히 같을 때만 true', () => {
    expect(canConfirmDelete('SDD', 'SDD')).toBe(true);
    expect(canConfirmDelete('SDD', 'sdd')).toBe(false);
    expect(canConfirmDelete('SDD', 'SDD ')).toBe(false);
    expect(canConfirmDelete('SDD', '')).toBe(false);
  });
});
