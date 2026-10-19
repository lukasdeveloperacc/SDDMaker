import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as startPOST } from '@/app/api/projects/[id]/interview/route';
import { POST as msgPOST } from '@/app/api/projects/[id]/interview/messages/route';
import { POST as sumPOST, PUT as sumPUT } from '@/app/api/projects/[id]/interview/summary/route';
import { POST as approvePOST } from '@/app/api/projects/[id]/interview/approve/route';
import { POST as unapprovePOST } from '@/app/api/projects/[id]/interview/unapprove/route';
import { POST as skipPOST } from '@/app/api/projects/[id]/interview/skip/route';
import { claudeAdapter } from '@/server/agents/claude';
import { RunTimeoutError, AgentError } from '@/server/agents/exec';
import { runTurn } from '@/server/interview-turn';
import { createProject, getInterview, listDocuments, listMessages, updateDocument } from '@/server/db';
import { projectDetail } from '@/server/documents';
import { getRun } from '@/server/runtime';
import { dataDir } from '@/server/env';
import { ctx, jsonReq, readSse, sseEvents } from '../helpers/route';

const URL_BASE = 'http://127.0.0.1:3000/api/projects';

afterEach(() => {
  vi.restoreAllMocks();
});

function newProject(): number {
  return createProject({ name: '테스트', idea: '할 일 관리 앱', designMd: null }).id;
}
const P = (id: number) => ctx({ id: String(id) });
const sid = (id: number) => getInterview(id)?.sessionId ?? null;
const userCount = (id: number) => listMessages(getInterview(id)!.id).filter((m) => m.role === 'user').length;
const msgCount = (id: number) => listMessages(getInterview(id)!.id).length;

async function waitUnlocked(id: number) {
  for (let i = 0; i < 500 && getRun(id); i++) await new Promise((r) => setTimeout(r, 20));
}

async function start(id: number, agent: 'claude' | 'codex' = 'claude') {
  const res = await startPOST(jsonReq('POST', `${URL_BASE}/${id}/interview`, { agent }), P(id));
  return readSse(res);
}
async function answer(id: number, content?: string) {
  const body = content === undefined ? undefined : { content };
  const res = await msgPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/messages`, body), P(id));
  return { status: res.status, events: res.status === 200 ? await readSse(res) : await res.json() };
}

describe('인터뷰 시작', () => {
  it('첫 질문이 done으로 오고 세션과 메시지 1개가 저장된다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    const events = await start(id);
    expect(events[events.length - 1].event).toBe('done');
    expect(events[events.length - 1].data.text).toMatch(/^질문: /);
    const d = projectDetail(id)!;
    expect(d.interview!.hasSession).toBe(true);
    expect(d.interview!.messages).toHaveLength(1);
    expect(d.interview!.messages[0].role).toBe('agent');
    expect(d.interview!.agent).toBe('claude');
  });

  it('로그인이 안 돼 있으면 error not_logged_in이고 인터뷰 행이 생기지 않는다', async () => {
    process.env.FAKE_AUTH = 'logged_out';
    const id = newProject();
    const events = await start(id);
    expect(events[0]).toEqual({ event: 'error', data: expect.objectContaining({ code: 'not_logged_in' }) });
    expect(getInterview(id)).toBeUndefined();
  });

  it('첫 질문이 실패하면 세션 없는 active가 남고, 다시 시작하면 성공한다', async () => {
    const id = newProject();
    process.env.FAKE_MODE = 'fail';
    const failed = await start(id);
    expect(failed[failed.length - 1].event).toBe('error');
    expect(getInterview(id)).toMatchObject({ status: 'active', sessionId: null });

    process.env.FAKE_MODE = 'ok';
    const ok = await start(id);
    expect(ok[ok.length - 1].event).toBe('done');
    expect(sid(id)).not.toBeNull();
  });

  it('건너뛴 뒤에는 시작할 수 없다 (409)', async () => {
    const id = newProject();
    await skipPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/skip`), P(id));
    const res = await startPOST(jsonReq('POST', `${URL_BASE}/${id}/interview`, { agent: 'claude' }), P(id));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('invalid_state');
  });

  it('잘못된 에이전트와 없는 프로젝트를 거른다', async () => {
    const id = newProject();
    const bad = await startPOST(jsonReq('POST', `${URL_BASE}/${id}/interview`, { agent: 'nope' }), P(id));
    expect(bad.status).toBe(400);
    const missing = await startPOST(jsonReq('POST', `${URL_BASE}/abc/interview`, { agent: 'claude' }), P(0));
    expect(missing.status).toBe(404);
  });
});

describe('답변과 다시 시도', () => {
  it('답변은 같은 세션으로 이어하기 실행되고 메시지가 3개가 된다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    const session = sid(id);
    process.env.FAKE_MODE = 'args';
    const r = await answer(id, '웹 앱입니다');
    expect(r.status).toBe(200);
    const args = JSON.parse(r.events[r.events.length - 1].data.text) as string[];
    expect(args[args.indexOf('--resume') + 1]).toBe(session);
    expect(msgCount(id)).toBe(3);
    expect(sid(id)).toBe(session);
  });

  it('실패하면 user 메시지 1개만 남고, content 없이 다시 시도하면 같은 답변에 agent 답이 붙는다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    process.env.FAKE_MODE = 'fail';
    const failed = await answer(id, '웹 앱입니다');
    expect(failed.events[failed.events.length - 1].event).toBe('error');
    expect(userCount(id)).toBe(1);

    process.env.FAKE_MODE = 'ok';
    const retry = await answer(id);
    expect(retry.status).toBe(200);
    expect(retry.events[retry.events.length - 1].event).toBe('done');
    expect(userCount(id)).toBe(1);
    const msgs = listMessages(getInterview(id)!.id);
    expect(msgs.map((m) => m.role)).toEqual(['agent', 'user', 'agent']);
  });

  it('마지막이 agent인데 content 없이 요청하면 409', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    const r = await answer(id);
    expect(r.status).toBe(409);
    expect(r.events.code).toBe('invalid_state');
  });

  it('마지막이 실패한 user 메시지인데 새 content를 보내면 409', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    process.env.FAKE_MODE = 'fail';
    await answer(id, '첫 답변');
    const r = await answer(id, '두 번째 답변');
    expect(r.status).toBe(409);
    expect(userCount(id)).toBe(1);
  });

  it('공백만 있는 content는 400', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    const r = await answer(id, '   ');
    expect(r.status).toBe(400);
  });

  it('이어하기가 실패하면 DB 기록으로 새 세션을 만들어 성공하고 세션 ID가 바뀐다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    const before = sid(id);
    process.env.FAKE_MODE = 'resume_fail';
    const r = await answer(id, '웹 앱입니다');
    expect(r.events[r.events.length - 1].event).toBe('done');
    expect(sid(id)).not.toBeNull();
    expect(sid(id)).not.toBe(before);
  });

  it('재시작 뒤에도 메시지와 세션이 남아 다음 답변이 이어하기로 간다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    const session = sid(id);
    // DB 연결을 닫고 다시 열게 한다 (앱 재시작 흉내).
    globalThis.__sddmakerDb?.db.close();
    globalThis.__sddmakerDb = undefined;
    expect(projectDetail(id)!.interview!.messages).toHaveLength(1);
    process.env.FAKE_MODE = 'args';
    const r = await answer(id, '다시 열었습니다');
    const args = JSON.parse(r.events[r.events.length - 1].data.text) as string[];
    expect(args[args.indexOf('--resume') + 1]).toBe(session);
  });

  it('CLI 성공 직후 연결이 끊기면 agent 메시지와 세션 ID를 저장하지 않는다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    const before = msgCount(id);
    const session = sid(id);

    let reached!: () => void;
    const reachedP = new Promise<void>((r) => { reached = r; });
    const original = claudeAdapter.run.bind(claudeAdapter);
    vi.spyOn(claudeAdapter, 'run').mockImplementation(async (i) => {
      const r = await original(i);
      reached();
      await new Promise((r2) => setTimeout(r2, 200)); // 저장 직전 지연
      return r;
    });

    const ac = new AbortController();
    const res = await msgPOST(
      jsonReq('POST', `${URL_BASE}/${id}/interview/messages`, { content: '끊길 답변' }, ac.signal),
      P(id),
    );
    const seen: string[] = [];
    const reading = (async () => {
      for await (const ev of sseEvents(res)) seen.push(ev.event);
    })();
    await reachedP;
    ac.abort();
    await reading;
    await waitUnlocked(id);

    expect(seen).not.toContain('done');
    expect(msgCount(id)).toBe(before + 1); // 사용자 답변만 남는다
    expect(listMessages(getInterview(id)!.id).at(-1)!.role).toBe('user');
    expect(sid(id)).toBe(session);
  });
});

describe('요약·승인·되돌리기', () => {
  it('요약 생성 → summarized, 그 뒤 답변은 409', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    const res = await sumPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/summary`), P(id));
    const events = await readSse(res);
    expect(events[events.length - 1]).toEqual({ event: 'done', data: { text: '# 인터뷰 요약\n\n- 요약 내용' } });
    expect(getInterview(id)).toMatchObject({ status: 'summarized', summary: '# 인터뷰 요약\n\n- 요약 내용' });

    const r = await answer(id, '더 말합니다');
    expect(r.status).toBe(409);
  });

  it('PUT 요약 → approve → 0-PRODUCT 생성 게이트가 열린다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    await readSse(await sumPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/summary`), P(id)));

    const put = await sumPUT(jsonReq('PUT', `${URL_BASE}/${id}/interview/summary`, { summary: '고친 요약' }), P(id));
    expect(put.status).toBe(200);
    const ap = await approvePOST(jsonReq('POST', `${URL_BASE}/${id}/interview/approve`), P(id));
    expect(ap.status).toBe(200);
    expect((await ap.json()).interview.status).toBe('approved');

    const doc = projectDetail(id)!.documents.find((d) => d.path === '0-PRODUCT.md')!;
    expect(doc.generate.ok).toBe(true);
  });

  it('승인 취소 → summarized이고 본문 있는 문서가 flagged된다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    await readSse(await sumPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/summary`), P(id)));
    await approvePOST(jsonReq('POST', `${URL_BASE}/${id}/interview/approve`), P(id));
    updateDocument(id, '0-PRODUCT.md', { content: '# 제품', status: 'draft' });

    const res = await unapprovePOST(jsonReq('POST', `${URL_BASE}/${id}/interview/unapprove`), P(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.interview.status).toBe('summarized');
    expect(body.flagged).toEqual(['0-PRODUCT.md']);
    expect(listDocuments(id).find((d) => d.path === '0-PRODUCT.md')!.upstreamChanged).toBe(true);
  });

  it('요약이 없으면 승인은 409', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    const res = await approvePOST(jsonReq('POST', `${URL_BASE}/${id}/interview/approve`), P(id));
    expect(res.status).toBe(409);
  });
});

describe('건너뛰기와 실행 중 상태', () => {
  it('시작 전 건너뛰기는 skipped이고 0-PRODUCT 생성 게이트가 열린다', async () => {
    const id = newProject();
    const res = await skipPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/skip`), P(id));
    expect(res.status).toBe(200);
    expect(getInterview(id)).toMatchObject({ status: 'skipped', agent: null });
    const doc = projectDetail(id)!.documents.find((d) => d.path === '0-PRODUCT.md')!;
    expect(doc.generate.ok).toBe(true);
  });

  it('진행 중 건너뛰기는 대화를 지우지 않고 skipped가 된다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    await skipPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/skip`), P(id));
    expect(getInterview(id)!.status).toBe('skipped');
    expect(msgCount(id)).toBe(1);
  });

  it('승인된 뒤 건너뛰기는 409', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    await start(id);
    await readSse(await sumPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/summary`), P(id)));
    await approvePOST(jsonReq('POST', `${URL_BASE}/${id}/interview/approve`), P(id));
    const res = await skipPOST(jsonReq('POST', `${URL_BASE}/${id}/interview/skip`), P(id));
    expect(res.status).toBe(409);
  });

  it('인터뷰 실행 중에는 모든 문서의 생성이 busy다', async () => {
    const pidFile = path.join(dataDir(), 'pid-interview-busy');
    process.env.FAKE_MODE = 'slow';
    process.env.FAKE_PID_FILE = pidFile;
    const id = newProject();
    const ac = new AbortController();
    const res = await startPOST(
      jsonReq('POST', `${URL_BASE}/${id}/interview`, { agent: 'claude' }, ac.signal),
      P(id),
    );
    const it1 = sseEvents(res)[Symbol.asyncIterator]();
    await it1.next(); // 첫 조각이 오면 실행 중
    const d = projectDetail(id)!;
    expect(d.running).toEqual({ kind: 'interview', path: null });
    expect(d.documents.every((x) => x.generate.ok === false && x.generate.code === 'busy')).toBe(true);
    ac.abort();
    while (!(await it1.next()).done);
    await waitUnlocked(id);
    // 자식 프로세스가 실제로 사라졌는지 확인한다 (최대 2초 대기).
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    let gone = false;
    for (let i = 0; i < 100 && !gone; i++) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 20));
      } catch {
        gone = true;
      }
    }
    expect(gone).toBe(true);
  });
});

describe('상태 확인 중 취소', () => {
  it('상태 확인 중 연결이 끊기면 인터뷰 행을 만들지 않는다', async () => {
    process.env.FAKE_MODE = 'ok';
    const id = newProject();
    const original = claudeAdapter.status.bind(claudeAdapter);
    let reached!: () => void;
    const reachedP = new Promise<void>((r) => { reached = r; });
    vi.spyOn(claudeAdapter, 'status').mockImplementation(async () => {
      reached();
      await new Promise((r) => setTimeout(r, 200));
      return original();
    });
    const ac = new AbortController();
    const res = await startPOST(
      jsonReq('POST', `${URL_BASE}/${id}/interview`, { agent: 'claude' }, ac.signal),
      P(id),
    );
    const reading = readSse(res);
    await reachedP;
    ac.abort();
    const events = await reading;
    expect(events.map((e) => e.event)).not.toContain('done');
    // 스트림은 끊길 때 닫히지만, 상태 확인 지연이 끝나 실행이 풀릴 때까지 기다린다.
    await waitUnlocked(id);
    expect(getInterview(id)).toBeUndefined();
  });
});

describe('runTurn 재시도 규칙', () => {
  it('시간 초과는 세션이 있어도 다시 실행하지 않는다', async () => {
    const spy = vi.spyOn(claudeAdapter, 'run').mockRejectedValue(new RunTimeoutError());
    await expect(
      runTurn({ agent: 'claude', prompt: 'x', sessionId: 's1', rebuildPrompt: () => 'r', signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(RunTimeoutError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('이어하기가 agent_failed로 실패하면 새 세션으로 한 번 다시 실행한다', async () => {
    const original = claudeAdapter.run.bind(claudeAdapter);
    const spy = vi
      .spyOn(claudeAdapter, 'run')
      .mockRejectedValueOnce(new AgentError('agent_failed', 'resume failed'))
      .mockImplementation(original);
    process.env.FAKE_MODE = 'ok';
    const r = await runTurn({ agent: 'claude', prompt: 'x', sessionId: 's1', rebuildPrompt: () => '대상 문서: 0-PRODUCT.md', signal: new AbortController().signal });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0].sessionId).toBeNull();
    expect(r.sessionId).not.toBe('s1');
  });
});
