'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// 프로젝트 목록(/)과 프로젝트 상세(/projects/…)는 프로젝트, 연결 화면은 연결이 현재 메뉴다.
const ITEMS = [
  { href: '/', label: '프로젝트', isCurrent: (path: string) => path === '/' || path.startsWith('/projects/') },
  { href: '/settings/agents', label: '연결', isCurrent: (path: string) => path.startsWith('/settings/agents') },
];

export function MainNav() {
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);
  // 고정된 상단 바 높이(줄바꿈 포함)를 --nav-height로 알려 사이드바·스크롤 위치가 바에 가리지 않게 한다.
  useEffect(() => {
    const bar = ref.current?.closest('header');
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty('--nav-height', `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  return (
    <nav ref={ref} aria-label="주 메뉴">
      {ITEMS.map(({ href, label, isCurrent }) => (
        <Link key={href} href={href} aria-current={isCurrent(path) ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
