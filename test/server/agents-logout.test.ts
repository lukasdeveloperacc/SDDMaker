import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/agents/[agent]/logout/route';
import { claudeAdapter } from '@/server/agents/claude';
import { codexAdapter } from '@/server/agents/codex';
import { runLogout } from '@/server/agents/exec';
import { claudeHome, codexHome, dataDir } from '@/server/env';
import { acquireLogin, isLoginRunning, releaseLogin } from '@/server/runtime';
import { ctx, jsonReq } from '../helpers/route';

afterEach(() => vi.restoreAllMocks());
beforeEach(() => { process.env.FAKE_AUTH = 'logged_out'; });

const logoutRequest = (agent: string, signal?: AbortSignal) => POST(
  jsonReq('POST', `http://127.0.0.1:3000/api/agents/${agent}/logout`, undefined, signal), ctx({ agent }),
);

describe('POST /api/agents/:agent/logout', () => {
  it.each(['claude', 'codex'] as const)('%s는 공식 명령을 전용 저장소에서 실행하고 잠금을 푼다', async (agent) => {
    const record = path.join(dataDir(), `logout-${agent}.json`);
    const home = agent === 'claude' ? claudeHome() : codexHome();
    const config = path.join(home, 'keep-config');
    fs.writeFileSync(config, 'keep');
    process.env.CLAUDE_CONFIG_DIR = '/host/claude-home';
    process.env.CODEX_HOME = '/host/codex-home';
    process.env.FAKE_LOGOUT_FILE = record;
    process.env.FAKE_AUTH = 'logged_in';
    expect((await (agent === 'claude' ? claudeAdapter : codexAdapter).status()).loggedIn).toBe(true);
    expect((await logoutRequest(agent)).status).toBe(204);
    const invocation = JSON.parse(fs.readFileSync(record, 'utf8'));
    expect(invocation.args).toEqual(agent === 'claude' ? ['auth', 'logout'] : ['logout']);
    expect(invocation[agent === 'claude' ? 'claudeHome' : 'codexHome']).toBe(home);
    expect(fs.readFileSync(config, 'utf8')).toBe('keep');
    expect(isLoginRunning(agent)).toBe(false);
  });

  it.each(['claude', 'codex'] as const)('%s 실패 내용은 노출하지 않고 재시도할 수 있다', async (agent) => {
    process.env.FAKE_LOGOUT = 'fail';
    const res = await logoutRequest(agent);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'agent_failed', message: '연결을 해제하지 못했습니다. 다시 시도하세요' });
    expect(isLoginRunning(agent)).toBe(false);
    process.env.FAKE_LOGOUT = 'ok';
    expect((await logoutRequest(agent)).status).toBe(204);
  });

  it('로그인이 진행 중이면 거절하고 기존 프로세스를 취소하지 않는다', async () => {
    const controller = acquireLogin('claude')!;
    const logout = vi.spyOn(claudeAdapter, 'logout');
    try {
      const res = await logoutRequest('claude');
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('login_running');
      expect(logout).not.toHaveBeenCalled();
      expect(controller.signal.aborted).toBe(false);
      expect(isLoginRunning('claude')).toBe(true);
    } finally {
      releaseLogin('claude', controller);
    }
  });

  it('연결 해제 중 중복 요청을 거절하고 완료 후 잠금을 푼다', async () => {
    let finish!: () => void;
    vi.spyOn(codexAdapter, 'logout').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pending = logoutRequest('codex');
    await vi.waitFor(() => expect(isLoginRunning('codex')).toBe(true));
    expect((await logoutRequest('codex')).status).toBe(409);
    finish();
    expect((await pending).status).toBe(204);
    expect(isLoginRunning('codex')).toBe(false);
  });

  it('실행 파일이 없으면 오류를 반환하고 잠금을 푼다', async () => {
    process.env.CODEX_CLI = '/nonexistent/codex';
    const res = await logoutRequest('codex');
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('cli_not_found');
    expect(isLoginRunning('codex')).toBe(false);
  });

  it('취소된 요청은 CLI를 실행하지 않고 잠금을 푼다', async () => {
    const controller = new AbortController();
    controller.abort();
    process.env.FAKE_LOGOUT_FILE = path.join(dataDir(), 'cancelled-logout.json');
    expect((await logoutRequest('claude', controller.signal)).status).toBe(500);
    expect(fs.existsSync(process.env.FAKE_LOGOUT_FILE)).toBe(false);
    expect(isLoginRunning('claude')).toBe(false);
  });

  it('응답 없는 연결 해제 명령은 15초 후 프로세스를 정리한다', async () => {
    const pidFile = path.join(dataDir(), 'logout-timeout.pid');
    process.env.FAKE_PID_FILE = pidFile;
    process.env.FAKE_LOGOUT = 'hang';
    vi.useFakeTimers();
    try {
      const pending = runLogout('codex', ['logout'], new AbortController().signal).catch((error) => error);
      await vi.waitFor(() => expect(fs.existsSync(pidFile)).toBe(true));
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await pending).toMatchObject({ code: 'agent_failed', message: '연결 해제 시간이 초과되었습니다' });
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('잘못된 에이전트는 400', async () => {
    const res = await logoutRequest('nope');
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_input');
  });

  it('종료 코드가 0이어도 연결이 남으면 성공으로 처리하지 않고 잠금을 푼다', async () => {
    process.env.FAKE_AUTH = 'logged_in';
    const res = await logoutRequest('codex');
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('agent_failed');
    expect(isLoginRunning('codex')).toBe(false);
  });

  it('해제 후 상태 확인에 실패해도 잠금을 푼다', async () => {
    vi.spyOn(claudeAdapter, 'status').mockRejectedValue(new Error('private status details'));
    const res = await logoutRequest('claude');
    expect(res.status).toBe(500);
    expect((await res.json()).message).not.toContain('private');
    expect(isLoginRunning('claude')).toBe(false);
  });
});
