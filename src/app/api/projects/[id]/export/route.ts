import { readDocRules } from '@/server/prompts';
import { apiError, parseId } from '@/server/http';
import { buildExportZip, exportFileName } from '@/server/export';
import { projectDetail } from '@/server/documents';
import { readOriginalRules } from '@/server/repo-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 서버는 파일을 쓰지 않고 zip 바이트만 돌려준다.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await ctx.params;
  const projectId = parseId(rawId);
  const detail = projectId === null ? null : projectDetail(projectId);
  if (!detail) return apiError(404, 'not_found', '프로젝트를 찾을 수 없습니다');
  if (!detail.exportGate.ok) {
    return apiError(409, 'export_blocked', '승인되지 않았거나 목록에서 빠진 문서가 있습니다', detail.exportGate.blocking);
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await buildExportZip({
      designMd: detail.project.designMd,
      designHtml: detail.project.designHtml,
      docs: detail.documents.map((d) => ({ path: d.path, content: d.content })),
      rules: readDocRules(),
      originalRules: detail.project.repo ? readOriginalRules(detail.project.id) : null,
    });
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'export_blocked') {
      return apiError(409, 'export_blocked', '기존 저장소 규칙 파일을 안전하게 읽지 못했습니다', 'items' in e && Array.isArray(e.items) ? e.items as string[] : ['docs/AGENTS.md']);
    }
    throw e;
  }
  const { ascii, encoded } = exportFileName(detail.project.name);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    },
  });
}
