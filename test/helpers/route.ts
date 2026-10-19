// route handler 테스트용 도우미.
export function ctx<P extends Record<string, string>>(params: P): { params: Promise<P> } {
  return { params: Promise.resolve(params) };
}

// 같은 출처(127.0.0.1)에서 온 것처럼 Host·Origin 헤더를 단다. signal은 연결 끊김 흉내용이다.
export function jsonReq(method: string, url: string, body?: unknown, signal?: AbortSignal): Request {
  const headers: Record<string, string> = { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
}

// 테스트에서 data 필드를 바로 꺼내 쓰므로 any를 허용한다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SseEvent { event: string; data: any }

// SSE 본문을 한 이벤트씩 읽는다. 스트림이 끝나기 전에 일부만 필요할 때 쓴다.
export async function* sseEvents(res: Response): AsyncGenerator<SseEvent> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = '';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (event) yield { event, data: JSON.parse(data) };
    }
  }
}

// SSE 응답 전체를 읽어 이벤트 목록으로 돌려준다.
export async function readSse(res: Response): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  for await (const ev of sseEvents(res)) out.push(ev);
  return out;
}
