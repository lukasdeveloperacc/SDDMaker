import MarkdownIt from 'markdown-it';

// 원문 HTML은 허용하지 않는다 (html: false). 텍스트 속 URL 자동 링크도 끈다.
const md = new MarkdownIt({ html: false, linkify: false });

export function Markdown({ source }: { source: string }) {
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: md.render(source) }} />;
}
