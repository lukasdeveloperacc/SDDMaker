'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 프로젝트 목록(/)과 프로젝트 상세(/projects/…)는 프로젝트, 연결 화면은 연결이 현재 메뉴다.
const ITEMS = [
  { href: '/', label: '프로젝트', isCurrent: (path: string) => path === '/' || path.startsWith('/projects/') },
  { href: '/settings/agents', label: '연결', isCurrent: (path: string) => path.startsWith('/settings/agents') },
];

export function MainNav() {
  const path = usePathname();
  return (
    <nav aria-label="주 메뉴">
      {ITEMS.map(({ href, label, isCurrent }) => (
        <Link key={href} href={href} aria-current={isCurrent(path) ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
