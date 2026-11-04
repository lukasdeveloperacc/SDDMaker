import { describe, expect, it } from 'vitest';
import { createProject, updateDocument } from '@/server/db';
import { acquireRun } from '@/server/runtime';
import { GET } from '@/app/api/projects/[id]/events/route';
import { ctx, sseEvents } from '../helpers/route';

const open = (id: number, signal: AbortSignal) =>
  GET(new Request(`http://127.0.0.1:3000/api/projects/${id}/events`, { headers: { host: '127.0.0.1:3000' }, signal }), ctx({ id: String(id) }));

async function next(it: AsyncGenerator<{ event: string }>, ms = 2000) {
  return Promise.race([it.next(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('event timeout')), ms))]);
}

describe('프로젝트 이벤트 스트림', () => {
  it('연결하면 ready, 문서·실행 상태가 바뀔 때마다 change를 보낸다', async () => {
    const p = createProject({ name: 'p', idea: 'i', designMd: null });
    const ac = new AbortController();
    const events = sseEvents(await open(p.id, ac.signal));
    expect((await next(events)).value.event).toBe('ready');

    updateDocument(p.id, '0-PRODUCT.md', { content: 'x', status: 'draft' });
    expect((await next(events)).value.event).toBe('change');

    const handle = acquireRun(p.id, 'document', '0-PRODUCT.md')!;
    expect((await next(events)).value.event).toBe('change');
    handle.release();
    expect((await next(events)).value.event).toBe('change');
    ac.abort();
  });

  it('다른 프로젝트의 변경은 보내지 않고, 없는 프로젝트는 404', async () => {
    const a = createProject({ name: 'a', idea: 'i', designMd: null });
    const b = createProject({ name: 'b', idea: 'i', designMd: null });
    const ac = new AbortController();
    const events = sseEvents(await open(a.id, ac.signal));
    await next(events);
    updateDocument(b.id, '0-PRODUCT.md', { content: 'x', status: 'draft' });
    await expect(next(events, 150)).rejects.toThrow('event timeout');
    ac.abort();
    expect((await open(9999, new AbortController().signal)).status).toBe(404);
  });
});
