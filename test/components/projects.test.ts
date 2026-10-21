import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildProjectBody,
  checkProjectInput,
  createErrorView,
  errorsAfterRepoChange,
} from '@/components/projects/CreateProjectForm';
import { canConfirmDelete } from '@/components/projects/DeleteProjectDialog';
import { api, ApiRequestError } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('저장소가 blank가 아니면 이름과 아이디어는 선택이다', () => {
    expect(checkProjectInput('', '', 'owner/repo')).toBeNull();
    expect(checkProjectInput('  ', ' ', ' owner/repo ')).toBeNull();
  });

  it('저장소가 공백뿐이면 기존 규칙을 그대로 적용한다', () => {
    expect(checkProjectInput('', 'x', '   ')).toEqual({ name: '프로젝트 이름을 입력하세요.' });
    expect(checkProjectInput('a', '', '')).toEqual({ idea: '아이디어를 입력하세요.' });
  });
});

describe('buildProjectBody', () => {
  it('저장소가 없으면 기존 본문과 같고 repo 키가 없다', () => {
    const body = buildProjectBody(' SDD ', ' 아이디어 ', '# 디자인\n', '  ');
    expect(body).toEqual({ name: 'SDD', idea: '아이디어', designMd: '# 디자인\n' });
    expect(Object.keys(body)).not.toContain('repo');
  });

  it('저장소가 있으면 trim해서 repo를 넣고, 비어 있는 이름과 아이디어도 보낸다', () => {
    expect(buildProjectBody(' ', '', '', ' owner/repo ')).toEqual({
      name: '',
      idea: '',
      designMd: '',
      repo: 'owner/repo',
    });
  });
});

describe('createErrorView', () => {
  it('저장소 입력 오류는 저장소 칸 아래에 붙인다', () => {
    expect(createErrorView('invalid_input', '형식 오류', true).target).toBe('repo');
    expect(createErrorView('repo_not_found', '', true).target).toBe('repo');
  });

  it('저장소 없이 제출된 invalid_input은 저장소 칸이 아니라 일반 알림에 보인다', () => {
    expect(createErrorView('invalid_input', '이름을 입력하세요.', false)).toEqual({
      target: 'notice',
      message: '이름을 입력하세요.',
    });
  });

  it('저장소를 넣으면 이름·아이디어 오류를 지우고, 비우면 그대로 둔다', () => {
    const errors = { name: '프로젝트 이름을 입력하세요.', idea: '아이디어를 입력하세요.' };
    expect(errorsAfterRepoChange(errors, 'owner/repo')).toEqual({ name: undefined, idea: undefined });
    expect(errorsAfterRepoChange(errors, '   ')).toEqual(errors);
  });

  it('GitHub 미연결은 알림과 연결 화면 링크를 준다', () => {
    expect(createErrorView('github_not_connected', '', false)).toMatchObject({ target: 'notice', link: true });
  });

  it('gh 미설치는 정해진 안내 문구를 준다', () => {
    expect(createErrorView('gh_not_found', '', true).message).toBe(
      'gh가 설치되어 있지 않습니다. 설치하거나 GH_CLI로 경로를 지정하세요. 저장소 없이 만들 수 있습니다.',
    );
  });

  it('클론 실패는 알림과 다시 시도를 준다', () => {
    expect(createErrorView('clone_failed', '', true)).toMatchObject({ target: 'notice', retry: true });
  });

  it('그 밖의 오류는 서버 메시지를 그대로 쓰고, 메시지가 없으면 기본 문구를 쓴다', () => {
    expect(createErrorView('agent_failed', '서버 메시지', false)).toEqual({ target: 'notice', message: '서버 메시지' });
    expect(createErrorView('unknown', '', false).message).toBe('프로젝트를 만들지 못했습니다.');
  });
});

describe('프로젝트 생성 요청 (fetch 가짜)', () => {
  it('저장소 요청을 보내고 clone_failed 응답을 다시 시도 화면으로 바꾼다', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'clone_failed', message: '복제 실패' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const body = buildProjectBody('', '', '', 'owner/repo');
    const err = await api('POST', '/api/projects', body).catch((e: unknown) => e);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: '', idea: '', designMd: '', repo: 'owner/repo' }) }),
    );
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(createErrorView((err as ApiRequestError).code, (err as ApiRequestError).message, true)).toMatchObject({
      target: 'notice',
      retry: true,
    });
  });

  it('성공 응답은 프로젝트를 돌려준다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ project: { id: 7, repo: 'owner/repo' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const res = await api<{ project: { id: number; repo: string } }>('POST', '/api/projects', buildProjectBody('', '', '', 'owner/repo'));
    expect(res.project).toEqual({ id: 7, repo: 'owner/repo' });
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
