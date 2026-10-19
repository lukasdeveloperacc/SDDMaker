import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata = { title: 'SDDMaker' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <header className="nav-bar">
          <Link href="/">SDDMaker</Link>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
