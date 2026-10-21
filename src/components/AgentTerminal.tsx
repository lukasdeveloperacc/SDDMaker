'use client';

import { useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { LoginTarget } from '@/lib/contract';
import { api } from '@/lib/api';

const LABEL: Record<LoginTarget, string> = { claude: 'Claude Code', codex: 'Codex', github: 'GitHub' };

export function AgentTerminal({ agent, loginId, output, outputLength, running }: {
  agent: LoginTarget; loginId: string | null; output: string; outputLength: number; running: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const latest = useRef({ loginId, output, outputLength, running });
  latest.current = { loginId, output, outputLength, running };
  const written = useRef(0);
  const queue = useRef(Promise.resolve());
  const fitTerminal = useRef(() => {});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    const send = (body: Record<string, unknown>) => {
      const id = latest.current.loginId;
      if (!id || !latest.current.running || disposed) return;
      queue.current = queue.current.then(async () => {
        if (disposed || latest.current.loginId !== id || !latest.current.running) return;
        await api('PUT', `/api/agents/${agent}/login`, { loginId: id, ...body });
      }).catch((e) => {
        if (!disposed && latest.current.running) setError(e instanceof Error ? e.message : '터미널 연결이 끊겼습니다.');
      });
    };
    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/addon-web-links')]).then(([{ Terminal }, { FitAddon }, { WebLinksAddon }]) => {
      if (disposed || !host.current) return;
      const term = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', scrollback: 1000,
        theme: { background: '#31302e', foreground: '#f6f5f4', cursor: '#f6f5f4' }, allowProposedApi: false });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon((event, uri) => {
        event.preventDefault();
        if (/^https?:\/\//i.test(uri)) window.open(uri, '_blank', 'noopener,noreferrer');
      }));
      term.open(host.current);
      term.options.disableStdin = !latest.current.running || !latest.current.loginId;
      terminal.current = term;
      term.write(latest.current.output);
      written.current = latest.current.outputLength;
      const resize = () => {
        if (!host.current?.clientWidth) return;
        fit.fit();
        send({ cols: Math.max(2, Math.min(500, term.cols)), rows: Math.max(2, Math.min(200, term.rows)) });
      };
      const observer = new ResizeObserver(resize);
      fitTerminal.current = resize;
      observer.observe(host.current);
      const input = term.onData((data) => {
        for (let start = 0; start < data.length;) {
          let end = Math.min(start + 8192, data.length);
          if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
          send({ data: data.slice(start, end) });
          start = end;
        }
      });
      resize();
      term.focus();
      cleanup = () => { observer.disconnect(); input.dispose(); term.dispose(); terminal.current = null; fitTerminal.current = () => {}; };
    }).catch(() => { if (!disposed) setError('터미널을 열지 못했습니다. 다시 연결하세요.'); });
    return () => { disposed = true; cleanup(); };
  }, [agent]);

  useEffect(() => {
    if (!terminal.current) return;
    const count = outputLength - written.current;
    if (count > 0) terminal.current.write(output.slice(-count));
    written.current = outputLength;
  }, [output, outputLength]);

  useEffect(() => {
    if (terminal.current) terminal.current.options.disableStdin = !running || !loginId;
    if (loginId && running) fitTerminal.current();
  }, [running, loginId]);

  return <>
    <div ref={host} className="agent-terminal" role="group" aria-label={`${LABEL[agent]} 로그인 터미널`} />
    {error && <p role="alert">{error}</p>}
  </>;
}
