import type { ReactNode } from 'react';
import Link from 'next/link';
import { AgentUsage } from '@/components/AgentUsage';
import { MainNav } from '@/components/MainNav';
import './globals.css';
import '@xterm/xterm/css/xterm.css';

export const metadata = { title: 'SDDMaker' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="nav-bar">
          <Link href="/" className="brand">SDDMaker</Link>
          <MainNav />
          <AgentUsage />
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
