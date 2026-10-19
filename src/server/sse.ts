// SSE 응답을 만든다. 신호: 요청이 끊기거나(reqSignal abort) 스트림이 cancel()되면 signal이 abort된다.
export function createSse(reqSignal: AbortSignal): {
  response: Response;
  send(event: string, data: unknown): void;
  close(): void;
  signal: AbortSignal;
} {
  const ac = new AbortController();
  const enc = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    try {
      controller.close();
    } catch {
      // 이미 cancel된 스트림은 닫을 필요가 없다
    }
  };
  const onClientGone = () => {
    ac.abort();
    finish();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
      ac.abort();
    },
  });

  if (reqSignal.aborted) onClientGone();
  else reqSignal.addEventListener('abort', onClientGone, { once: true });

  return {
    response: new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    }),
    send(event, data) {
      if (closed) return;
      try {
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch {
        closed = true;
      }
    },
    close() {
      reqSignal.removeEventListener('abort', onClientGone);
      finish();
    },
    signal: ac.signal,
  };
}
