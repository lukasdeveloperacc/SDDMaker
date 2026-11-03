// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportPanel } from '@/components/documents/ExportPanel';
import { NO_PUSH_TEXT, prErrorView } from '@/components/documents/PrDialog';
import { ApiRequestError } from '@/lib/api';
import type { PrInfoResponse, ProjectDetail } from '@/lib/contract';

const info = (over: Partial<PrInfoResponse> = {}): PrInfoResponse => ({
  repo: 'octo/app',
  defaultBranch: 'main',
  canPush: true,
  files: ['docs/0-PRODUCT.md', 'docs/changes/001-baseline.md'],
  overwrites: [],
  baselineCommit: 'base123',
  remoteCommit: 'base123',
  reviewToken: 'token1',
  ...over,
});

function detail(repo: string | null, gateOk = true): ProjectDetail {
  return {
    project: { id: 7, name: 'p', idea: 'i', designMd: null, createdAt: '', repo },
    batch: null,
    repoContext: repo ? { baselineCommit: 'base123', originals: [{ path: 'docs/AGENTS.md', originalText: null, omissionReason: 'instruction_file' }] } : null,
    interview: null,
    documents: [],
    running: null,
    exportGate: { ok: gateOk, blocking: gateOk ? [] : ['0-PRODUCT.md'], upstreamChanged: [] },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function errorBody(code: string, message: string) {
  return { code, message };
}

let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom에는 showModal/close가 없어 open 속성만 바꾼다.
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (!proto.showModal) {
    proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(d: ProjectDetail) {
  await act(async () => root.render(createElement(ExportPanel, { projectId: 7, detail: d })));
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);
}

function dialogButton(label: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('dialog button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
    await Promise.resolve();
  });
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe('prErrorView', () => {
  it('push 권한 없음은 안내 문구와 비활성 표시, 연결 문제는 설정 링크를 붙인다', () => {
    expect(prErrorView(new ApiRequestError(409, 'no_push_permission', 'x'))).toMatchObject({ message: NO_PUSH_TEXT, noPush: true, connect: false });
    expect(prErrorView(new ApiRequestError(409, 'github_not_connected', '로그인 필요')).connect).toBe(true);
    expect(prErrorView(new ApiRequestError(409, 'gh_not_found', 'gh 없음')).connect).toBe(true);
  });

  it('그 밖의 오류는 서버 메시지를 그대로 쓴다', () => {
    expect(prErrorView(new ApiRequestError(502, 'pr_failed', '다시 시도하세요'))).toMatchObject({ message: '다시 시도하세요', noPush: false, connect: false });
    expect(prErrorView(new ApiRequestError(409, 'repo_stale', 'stale')).stale).toBe(true);
    expect(prErrorView(new Error('x')).message).toBe('요청을 처리하지 못했습니다.');
  });
});

describe('ExportPanel PR', () => {
  it('저장소 프로젝트는 내보내기 조건이 맞으면 권한을 확인하고 PR 올리기를 켠다', async () => {
    fetchMock.mockResolvedValueOnce(json(200, info()));
    await render(detail('octo/app'));
    await flush();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/7/pr');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    expect(button('PR 올리기')?.disabled).toBe(false);
    expect(host.querySelector('a[href="/api/projects/7/export"]')).not.toBeNull();
  });

  it('push 권한이 없으면 버튼을 끄고 이유와 zip 안내를 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(json(200, info({ canPush: false })));
    await render(detail('octo/app'));
    await flush();
    expect(button('PR 올리기')?.disabled).toBe(true);
    expect(host.textContent).toContain(NO_PUSH_TEXT);
  });

  it('gh가 없으면 설정 화면 링크가 있는 안내를 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(json(409, errorBody('gh_not_found', 'gh가 설치되어 있지 않습니다.')));
    await render(detail('octo/app'));
    await flush();
    expect(host.querySelector('a[href="/settings/agents"]')).not.toBeNull();
    expect(button('PR 올리기')?.disabled).toBe(true);
  });

  it('repo_stale GET shows preserved-draft recovery, keeps ZIP available, and does not retry the stale preview', async () => {
    fetchMock.mockResolvedValueOnce(json(409, errorBody('repo_stale', 'old baseline')));
    await render(detail('octo/app'));
    await flush();
    expect(host.textContent).toContain('현재 프로젝트의 초안은 보존되어 있습니다');
    expect(host.querySelector('a[href="/"]')?.textContent).toBe('새 프로젝트 만들기');
    expect(host.querySelector('a[href="/api/projects/7/export"]')).not.toBeNull();
    expect(button('다시 시도')).toBeUndefined();
  });

  it('내보내기 조건이 막혀 있으면 권한을 확인하지 않는다', async () => {
    await render(detail('octo/app', false));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button('PR 올리기')?.disabled).toBe(true);
  });

  it('저장소가 없는 프로젝트는 zip만 보이고 PR 요청을 하지 않는다', async () => {
    await render(detail(null));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button('PR 올리기')).toBeUndefined();
    expect(host.querySelector('a[href="/api/projects/7/export"]')).not.toBeNull();
  });

  it('확인 창에서 덮어쓸 파일을 보여 주고 PR을 올린 뒤 링크를 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(json(200, info({ overwrites: ['docs/0-PRODUCT.md'] })));
    await render(detail('octo/app'));
    await flush();
    await click(button('PR 올리기')!);
    expect(host.querySelector('dialog')?.textContent).toContain('docs/0-PRODUCT.md');
    expect(host.querySelector('dialog')?.textContent).toContain('base123');
    expect(host.querySelector('dialog')?.textContent).toContain('docs/AGENTS.md');
    expect(host.querySelector('dialog')?.textContent).not.toContain('덮어쓸 파일 없음');
    expect(dialogButton('PR 올리기')?.disabled).toBe(true);
    await click(host.querySelector<HTMLInputElement>('dialog input[type="checkbox"]')!);

    fetchMock.mockResolvedValueOnce(json(201, { url: 'https://github.com/octo/app/pull/1' }));
    await click(dialogButton('PR 올리기')!);
    await flush();
    expect(fetchMock.mock.calls[1][0]).toBe('/api/projects/7/pr');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ reviewToken: 'token1', confirmOverwrites: true });
    expect(host.querySelector('a[href="https://github.com/octo/app/pull/1"]')).not.toBeNull();
    // 성공 후에도 미리보기의 올릴 파일 목록은 남아 있고 닫기가 주 동작이다.
    expect(dialogButton('닫기')?.className).toContain('btn-primary');
    expect(dialogButton('새 브랜치로 PR 다시 올리기')?.className).toContain('btn-secondary');
    expect(host.querySelector('dialog')?.textContent).toContain('docs/0-PRODUCT.md');
  });

  it('덮어쓸 파일이 없으면 그 문구를 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(json(200, info()));
    await render(detail('octo/app'));
    await flush();
    await click(button('PR 올리기')!);
    expect(host.querySelector('dialog')?.textContent).toContain('덮어쓸 파일 없음');
  });

  it('PR 생성이 실패하면 메시지와 다시 시도 버튼을 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(json(200, info()));
    await render(detail('octo/app'));
    await flush();
    await click(button('PR 올리기')!);
    fetchMock.mockResolvedValueOnce(json(502, errorBody('pr_failed', 'push에 실패했습니다.')));
    await click(dialogButton('PR 올리기')!);
    await flush();
    expect(host.querySelector('dialog')?.textContent).toContain('push에 실패했습니다.');
    expect(dialogButton('다시 시도')?.disabled).toBe(false);
  });

  it('review_changed forces a fresh preview before the dialog can be reopened', async () => {
    fetchMock.mockResolvedValueOnce(json(200, info({ reviewToken: 'old-token' })));
    await render(detail('octo/app'));
    await flush();
    await click(button('PR 올리기')!);
    fetchMock.mockResolvedValueOnce(json(409, errorBody('review_changed', 'stale review')));
    await click(dialogButton('PR 올리기')!);
    await flush();
    expect(host.querySelector('dialog')?.textContent).toContain('최신 미리보기를 다시 확인');
    fetchMock.mockResolvedValueOnce(json(200, info({ reviewToken: 'new-token' })));
    await click(dialogButton('최신 미리보기 다시 확인')!);
    await flush();
    expect(fetchMock.mock.calls[2][0]).toBe('/api/projects/7/pr');
    await click(button('PR 올리기')!);
    fetchMock.mockResolvedValueOnce(json(201, { url: 'https://github.com/octo/app/pull/2' }));
    await click(dialogButton('PR 올리기')!);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ reviewToken: 'new-token', confirmOverwrites: false });
  });

  it('disables PR creation when the refreshed preview reports a stale baseline', async () => {
    fetchMock.mockResolvedValueOnce(json(200, info()));
    await render(detail('octo/app'));
    await flush();
    await click(button('PR 올리기')!);
    fetchMock.mockResolvedValueOnce(json(409, errorBody('review_changed', 'stale review')));
    await click(dialogButton('PR 올리기')!);
    await flush();
    fetchMock.mockResolvedValueOnce(json(409, errorBody('repo_stale', 'stale baseline')));
    await click(dialogButton('최신 미리보기 다시 확인')!);
    await flush();
    expect(button('PR 올리기')?.disabled).toBe(true);
    expect(host.textContent).toContain('새 프로젝트 만들기');
  });

  it('권한이 없다고 응답하면 확인 버튼을 끈다', async () => {
    fetchMock.mockResolvedValueOnce(json(200, info()));
    await render(detail('octo/app'));
    await flush();
    await click(button('PR 올리기')!);
    fetchMock.mockResolvedValueOnce(json(409, errorBody('no_push_permission', 'x')));
    await click(dialogButton('PR 올리기')!);
    await flush();
    expect(host.querySelector('dialog')?.textContent).toContain(NO_PUSH_TEXT);
    expect(dialogButton('PR 올리기')?.disabled).toBe(true);
  });
});
