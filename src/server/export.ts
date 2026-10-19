import JSZip from 'jszip';

// 프로젝트 이름을 파일 이름으로: 문자·숫자·-·_ 밖의 글자는 -로 바꾼다.
// ascii는 헤더의 filename="" 용, encoded는 filename*=UTF-8'' 용 (RFC 5987).
export function exportFileName(projectName: string): { ascii: string; encoded: string } {
  const base = projectName.replace(/[^\p{L}\p{N}_-]/gu, '-');
  const ascii = base.replace(/[^A-Za-z0-9_-]/g, '-') + '-docs.zip';
  const encoded = encodeURIComponent(base + '-docs.zip');
  return { ascii, encoded };
}

// docs/AGENTS.md = 규칙 원문, docs/2-DESIGN.md = 디자인 문서(있을 때만), docs/<path> = 승인된 본문.
export async function buildExportZip(i: {
  designMd: string | null;
  docs: { path: string; content: string }[];
  rules: string;
}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const root = zip.folder('docs') as JSZip;
  root.file('AGENTS.md', i.rules);
  if (i.designMd !== null && i.designMd.trim() !== '') root.file('2-DESIGN.md', i.designMd);
  for (const d of i.docs) root.file(d.path, d.content);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
