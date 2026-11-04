import { describe, expect, it } from 'vitest';
import { OPTIONS_HEADER } from '@/lib/agent-options';
import { claudeAdapter } from '@/server/agents/claude';
import { codexAdapter } from '@/server/agents/codex';
import { withAgentOptions } from '@/server/agents/options';
import { runAgentSse } from '@/server/run-agent-sse';
import { acquireRun } from '@/server/runtime';
import { readSse } from '../helpers/route';

const signal = () => new AbortController().signal;
const reqWith = (header: unknown) =>
  new Request('http://127.0.0.1:3000/api/x', {
    method: 'POST',
    headers: { [OPTIONS_HEADER]: typeof header === 'string' ? header : JSON.stringify(header) },
  });
const CHOSEN = { claude: { model: 'opus', effort: 'high' }, codex: { model: 'gpt-6.1-sol', effort: 'low' } };

describe('모델·추론 강도 → CLI 인자', () => {
  it('claude는 --model, --effort를 받고 codex 값은 받지 않는다', async () => {
    process.env.FAKE_MODE = 'args';
    const res = await withAgentOptions(reqWith(CHOSEN), 'claude', () => claudeAdapter.run({ prompt: 'x', signal: signal() }));
    const args = JSON.parse(res.text) as string[];
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
    expect(args).not.toContain('gpt-6.1-sol');
  });

  it('codex는 -m, model_reasoning_effort를 resume보다 앞에 받는다', async () => {
    process.env.FAKE_MODE = 'args';
    const res = await withAgentOptions(reqWith(CHOSEN), 'codex', () =>
      codexAdapter.run({ prompt: 'x', sessionId: 'thread-9', signal: signal() }));
    const args = JSON.parse(res.text) as string[];
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-6.1-sol');
    expect(args).toContain('model_reasoning_effort="low"');
    expect(args.indexOf('-m')).toBeLessThan(args.indexOf('resume'));
    expect(args.slice(-3)).toEqual(['resume', 'thread-9', '-']);
  });

  it.each([
    ['헤더 없음', undefined],
    ['JSON이 아님', 'not json'],
    ['허용되지 않는 값', { claude: { model: '--dangerously-skip-permissions', effort: 'turbo' } }],
  ])('%s이면 인자를 붙이지 않는다', async (_name, header) => {
    process.env.FAKE_MODE = 'args';
    const req = header === undefined ? new Request('http://127.0.0.1:3000/api/x') : reqWith(header);
    const res = await withAgentOptions(req, 'claude', () => claudeAdapter.run({ prompt: 'x', signal: signal() }));
    const args = JSON.parse(res.text) as string[];
    expect(args).not.toContain('--model');
    expect(args).not.toContain('--effort');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('runAgentSse가 요청 헤더의 값을 실행 안으로 전달한다', async () => {
    process.env.FAKE_MODE = 'args';
    const handle = acquireRun(901, 'interview', null)!;
    const res = runAgentSse({
      req: reqWith(CHOSEN),
      handle,
      agent: 'claude',
      execute: async () => (await claudeAdapter.run({ prompt: 'x', signal: signal() })).text,
    });
    const done = (await readSse(res)).find((e) => e.event === 'done');
    const args = JSON.parse(done!.data.text) as string[];
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
  });
});
