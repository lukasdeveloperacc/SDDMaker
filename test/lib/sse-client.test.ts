import { describe, expect, it } from 'vitest';
import { readSse, type SseMessage } from '@/lib/sse-client';

const TEXT =
  'event: delta\ndata: {"text":"안녕"}\n\n' +
  'event: delta\r\ndata: {"text":"하세요"}\r\n\r\n' +
  'event: done\ndata: {"text":"끝"}\n\n';

// 바이트 단위로 쪼갠 청크를 가진 Response를 만든다.
function chunkedResponse(text: string, size: number): Response {
  const bytes = new TextEncoder().encode(text);
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

async function collect(res: Response): Promise<SseMessage[]> {
  const out: SseMessage[] = [];
  await readSse(res, (m) => out.push(m));
  return out;
}

const EXPECTED: SseMessage[] = [
  { event: 'delta', data: { text: '안녕' } },
  { event: 'delta', data: { text: '하세요' } },
  { event: 'done', data: { text: '끝' } },
];

describe('readSse', () => {
  it('한 번에 온 스트림에서 이벤트 3개를 순서대로 읽는다', async () => {
    expect(await collect(chunkedResponse(TEXT, TEXT.length))).toEqual(EXPECTED);
  });

  it('어느 위치에서 잘린 청크든 같은 이벤트를 읽는다 (1바이트 단위 포함)', async () => {
    for (const size of [1, 2, 3, 5, 7, 16]) {
      expect(await collect(chunkedResponse(TEXT, size))).toEqual(EXPECTED);
    }
  });

  it('빈 줄로 끝나지 않은 마지막 블록은 이벤트로 치지 않는다', async () => {
    const res = chunkedResponse('event: done\ndata: {"text":"x"}\n\nevent: delta\ndata: {"t', 4);
    expect(await collect(res)).toEqual([{ event: 'done', data: { text: 'x' } }]);
  });
});
