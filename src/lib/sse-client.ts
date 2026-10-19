export interface SseMessage {
  event: string;
  // 이벤트마다 모양이 달라 호출하는 쪽에서 좁힌다 (plan §4.5).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

// 빈 줄로 끝나는 블록만 이벤트로 본다. 끝나지 않은 마지막 블록은 버린다 (SSE 규격).
export async function readSse(res: Response, onMessage: (m: SseMessage) => void): Promise<void> {
  if (!res.body) throw new Error('응답 본문이 없습니다.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    // 청크가 \r\n 중간에서 잘릴 수 있으므로 합친 뒤에 정규화한다.
    buffer = buffer.replace(/\r\n/g, '\n');

    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      const msg = parseBlock(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (msg) onMessage(msg);
      end = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
}

function parseBlock(block: string): SseMessage | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: JSON.parse(data.join('\n')) };
}
