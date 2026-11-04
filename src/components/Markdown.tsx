import type { MouseEvent } from 'react';
import MarkdownIt from 'markdown-it';

// 원문 HTML은 허용하지 않는다 (html: false). 텍스트 속 URL 자동 링크도 끈다.
const md = new MarkdownIt({ html: false, linkify: false });

// onLink가 true를 돌려주면 그 링크는 앱이 직접 처리한 것이므로 브라우저 이동을 막는다.
export function Markdown({ source, onLink }: { source: string; onLink?: (href: string) => boolean }) {
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const href = (event.target as Element).closest('a')?.getAttribute('href');
    if (href && onLink?.(href)) event.preventDefault();
  };
  return <div className="markdown" onClick={click} dangerouslySetInnerHTML={{ __html: md.render(source) }} />;
}
