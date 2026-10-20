import type { ReactNode } from 'react';
import Link from 'next/link';
import { AgentUsage } from '@/components/AgentUsage';
import './globals.css';
import '@xterm/xterm/css/xterm.css';

export const metadata = { title: 'SDDMaker' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="nav-bar">
          <Link href="/" className="brand">SDDMaker</Link>
          <AgentUsage />
          <nav aria-label="주 메뉴">
            <Link href="/">프로젝트</Link>
            <Link href="/settings/agents">에이전트 연결</Link>
          </nav>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
