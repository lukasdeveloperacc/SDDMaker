import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorFields, log } from '@/lib/log';

afterEach(() => { process.env.LOG_LEVEL = 'silent'; vi.restoreAllMocks(); });

describe('구조화 로그', () => {
  it('한 줄 JSON으로 쓰고, 필드가 기본 키를 덮지 못하며, 경고 이상은 표준 오류로 보낸다', () => {
    process.env.LOG_LEVEL = 'info';
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    log('info', 'run_start', { projectId: 3, event: 'x', level: 'y' });
    log('warn', 'doc_failed', { ...errorFields(new Error('boom')) });
    log('debug', 'cli_start', {}); // 기본 수준(info)보다 낮아 버린다
    expect(JSON.parse(String(out.mock.calls[0][0]))).toEqual({ ts: expect.any(String), level: 'info', event: 'run_start', projectId: 3 });
    expect(JSON.parse(String(err.mock.calls[0][0]))).toMatchObject({ level: 'warn', event: 'doc_failed', error: 'boom', errorName: 'Error' });
    expect(out).toHaveBeenCalledTimes(1);
  });
});
