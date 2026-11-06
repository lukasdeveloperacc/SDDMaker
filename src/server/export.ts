import JSZip from 'jszip';
import { projectTokensCss } from '@/lib/design-tokens';

// 프로젝트 이름을 파일 이름으로: 문자·숫자·-·_ 밖의 글자는 -로 바꾼다.
// ascii는 헤더의 filename="" 용, encoded는 filename*=UTF-8'' 용 (RFC 5987).
export function exportFileName(projectName: string): { ascii: string; encoded: string } {
  const base = projectName.replace(/[^\p{L}\p{N}_-]/gu, '-');
  const ascii = base.replace(/[^A-Za-z0-9_-]/g, '-') + '-docs.zip';
  const encoded = encodeURIComponent(base + '-docs.zip');
  return { ascii, encoded };
}

// 내보내는 파일 목록 (zip과 PR이 같이 쓴다). 경로는 저장소 기준 'docs/…'.
// docs/AGENTS.md = 규칙 원문, docs/2-DESIGN.md = 디자인 문서(있을 때만), docs/<path> = 승인된 본문.
// 디자인 문서에 토큰 머리말이 있으면 docs/2-DESIGN.tokens.css, 디자인 시스템 페이지가 있으면 docs/2-DESIGN.html.
export function exportFiles(i: {
  designMd: string | null;
  designHtml?: string | null;
  docs: { path: string; content: string }[];
  rules: string;
  originalRules?: string | null;
}): { path: string; content: string }[] {
  const files = [{ path: 'docs/AGENTS.md', content: i.originalRules ?? i.rules }];
  if (i.designMd !== null && i.designMd.trim() !== '') files.push({ path: 'docs/2-DESIGN.md', content: i.designMd });
  const tokens = projectTokensCss(i.designMd, i.designHtml ?? null);
  if (tokens) files.push({ path: 'docs/2-DESIGN.tokens.css', content: tokens });
  if (i.designHtml && i.designHtml.trim() !== '') files.push({ path: 'docs/2-DESIGN.html', content: i.designHtml });
  for (const d of i.docs) files.push({ path: `docs/${d.path}`, content: d.content });
  return files;
}

export async function buildExportZip(i: {
  designMd: string | null;
  designHtml?: string | null;
  docs: { path: string; content: string }[];
  rules: string;
  originalRules?: string | null;
}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.folder('docs');
  for (const f of exportFiles(i)) zip.file(f.path, f.content);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
