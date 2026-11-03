import { execFileSync } from 'node:child_process';
import { repoDir } from './env';
import type { RepoContext } from '@/lib/contract';

const FILE_LIMIT = 64 * 1024;
const TOTAL_LIMIT = 256 * 1024;
const MAX_FILES = 50;
const SECRET = /(gh[opsur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|sk-ant-[A-Za-z0-9_-]{20,})/g;

function git(projectId: number, args: string[], input?: Buffer): Buffer {
  return execFileSync('git', ['-C', repoDir(projectId), ...args], { encoding: 'buffer', input, stdio: ['pipe', 'pipe', 'ignore'], timeout: 10_000, maxBuffer: 3 * 1024 * 1024 });
}

export function repoBaselineCommit(projectId: number): string {
  return git(projectId, ['rev-parse', 'HEAD']).toString('utf8').trim();
}

function tracked(projectId: number, commit: string): Map<string, { oid: string; mode: string }> {
  const entries = git(projectId, ['ls-tree', '-rz', '-r', '--full-tree', commit, 'docs']).toString('utf8').split('\0').filter(Boolean);
  return new Map(entries.flatMap((entry) => {
    const tab = entry.indexOf('\t');
    const meta = entry.slice(0, tab).split(' ');
    const name = entry.slice(tab + 1);
    return meta[1] === 'blob' ? [[name, { mode: meta[0], oid: meta[2] }]] : [];
  }));
}

function blobSize(projectId: number, blob: string): number {
  const size = Number(git(projectId, ['cat-file', '-s', blob]).toString('utf8').trim());
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid blob size');
  return size;
}

function blobSizes(projectId: number, blobs: string[]): Map<string, number> {
  if (!blobs.length) return new Map();
  const output = git(projectId, ['cat-file', '--batch-check'], Buffer.from(`${blobs.join('\n')}\n`)).toString('utf8');
  const sizes = new Map<string, number>();
  for (const line of output.trimEnd().split('\n')) {
    const [oid, type, rawSize] = line.split(' ');
    const size = Number(rawSize);
    if (type === 'blob' && Number.isSafeInteger(size) && size >= 0) sizes.set(oid, size);
  }
  return sizes;
}

function textBlobs(projectId: number, blobs: string[]): Map<string, Buffer> {
  if (!blobs.length) return new Map();
  const output = git(projectId, ['cat-file', '--batch'], Buffer.from(`${blobs.join('\n')}\n`));
  const result = new Map<string, Buffer>();
  let offset = 0;
  while (offset < output.length) {
    const end = output.indexOf(10, offset);
    if (end < 0) break;
    const [oid, type, rawSize] = output.toString('ascii', offset, end).split(' ');
    const size = Number(rawSize);
    if (type !== 'blob' || !Number.isSafeInteger(size) || size < 0 || end + 1 + size >= output.length) break;
    result.set(oid, output.subarray(end + 1, end + 1 + size));
    offset = end + 1 + size + 1;
  }
  return result;
}

function textBlob(projectId: number, blob: string): string | null {
  const bytes = git(projectId, ['cat-file', 'blob', blob]);
  if (bytes.includes(0)) return null;
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

function instruction(rel: string): boolean { return /(^|\/)(AGENTS|CLAUDE)\.md$/i.test(rel); }

export function readOriginalRules(projectId: number): string | null {
  try {
    const blobs = tracked(projectId, repoBaselineCommit(projectId));
    const docsEntry = blobs.get('docs');
    if (docsEntry) throw new Error('unsafe docs directory');
    const blob = blobs.get('docs/AGENTS.md');
    if (!blob) return null;
    if (blob.mode !== '100644' && blob.mode !== '100755') throw new Error('unsafe file type');
    const size = blobSize(projectId, blob.oid);
    if (size > FILE_LIMIT) throw new Error('file too large');
    const text = textBlob(projectId, blob.oid);
    if (text === null || Buffer.byteLength(text, 'utf8') > FILE_LIMIT) throw new Error('not text');
    return text;
  } catch {
    throw Object.assign(new Error('기존 docs/AGENTS.md를 안전하게 읽을 수 없습니다'), { code: 'export_blocked', items: ['docs/AGENTS.md'] });
  }
}

export function readRepoContext(projectId: number, targetPaths: string[]): RepoContext {
  const baselineCommit = repoBaselineCommit(projectId);
  const blobs = tracked(projectId, baselineCommit);
  const unsafeDocs = blobs.get('docs')?.mode === '120000';
  const targets = targetPaths.map((p) => p.replace(/^docs\//, '')).filter((p) => !p.includes('..') && !p.startsWith('/'));
  const eligible = [...blobs.keys()].filter((p) => /^docs\/.+\.md$/i.test(p)).map((p) => p.slice(5)).sort();
  const paths = [...new Set([...targets, ...eligible])];
  const originals: RepoContext['originals'] = [];
  const candidates: Array<{ path: string; oid: string }> = [];
  for (const rel of paths) {
    const outputPath = `docs/${rel}`;
    if (unsafeDocs) { originals.push({ path: outputPath, originalText: null, omissionReason: 'symlink' }); continue; }
    if (instruction(rel)) { originals.push({ path: outputPath, originalText: null, omissionReason: 'instruction_file' }); continue; }
    const blob = blobs.get(outputPath);
    if (!blob) { originals.push({ path: outputPath, originalText: null, omissionReason: 'not_found' }); continue; }
    if (blob.mode !== '100644' && blob.mode !== '100755') { originals.push({ path: outputPath, originalText: null, omissionReason: 'symlink' }); continue; }
    if (!/^.+\.md$/i.test(rel)) { originals.push({ path: outputPath, originalText: null, omissionReason: 'non_text' }); continue; }
    candidates.push({ path: outputPath, oid: blob.oid });
    originals.push({ path: outputPath, originalText: null, omissionReason: 'non_text' });
  }
  const sizes = blobSizes(projectId, candidates.map((c) => c.oid));
  let total = 0;
  const selected: Array<{ path: string; oid: string }> = [];
  let eligibleCount = 0;
  for (const candidate of candidates) {
    const output = originals.find((item) => item.path === candidate.path)!;
    const size = sizes.get(candidate.oid);
    if (size === undefined) continue;
    if (eligibleCount >= MAX_FILES || size > FILE_LIMIT) { output.omissionReason = 'file_limit'; continue; }
    if (total + size > TOTAL_LIMIT) { output.omissionReason = 'total_limit'; continue; }
    eligibleCount += 1;
    total += size;
    selected.push(candidate);
  }
  const contents = textBlobs(projectId, selected.map((c) => c.oid));
  for (const candidate of selected) {
    const output = originals.find((item) => item.path === candidate.path)!;
    const bytes = contents.get(candidate.oid);
    if (!bytes || bytes.includes(0)) { output.omissionReason = 'non_text'; continue; }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { output.omissionReason = 'non_text'; continue; }
    SECRET.lastIndex = 0;
    if (SECRET.test(text)) { output.omissionReason = 'redacted'; continue; }
    output.originalText = text;
    output.omissionReason = null;
  }
  return { baselineCommit, originals };
}
