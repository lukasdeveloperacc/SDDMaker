import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject } from '@/server/db';
import { repoDir } from '@/server/env';
import { readOriginalRules, readRepoContext, repoBaselineCommit } from '@/server/repo-context';

const GIT = ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];
function repo(files: Record<string, string | Buffer>, symlinks: string[] = []) {
  const id = createProject({ name: 'repo', idea: '', designMd: null, repo: 'octo/repo' }).id;
  const dir = repoDir(id);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  for (const name of symlinks) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync('keep.md', target);
  }
  execFileSync('git', [...GIT, 'add', '-A'], { cwd: dir });
  execFileSync('git', [...GIT, 'commit', '-qm', 'seed'], { cwd: dir });
  return id;
}

describe('repo context from baseline blobs', () => {
  it('uses docs-relative tracked content, excludes instruction files and redacts secrets', () => {
    const id = repo({
      'docs/PRODUCT.md': '# product\n',
      'docs/AGENTS.md': '\uFEFFmust never be context\r\n',
      'docs/CLAUDE.md': 'must never be context either',
      'docs/keep.md': `api key: ghp_${'x'.repeat(36)}\n`,
    });
    const ctx = readRepoContext(id, ['target.md']);
    expect(ctx.baselineCommit).toBe(repoBaselineCommit(id));
    expect(ctx.originals).toContainEqual({ path: 'docs/target.md', originalText: null, omissionReason: 'not_found' });
    expect(ctx.originals).toContainEqual({ path: 'docs/AGENTS.md', originalText: null, omissionReason: 'instruction_file' });
    expect(ctx.originals).toContainEqual({ path: 'docs/CLAUDE.md', originalText: null, omissionReason: 'instruction_file' });
    expect(ctx.originals).toContainEqual({ path: 'docs/keep.md', originalText: null, omissionReason: 'redacted' });
    expect(ctx.originals.find((x) => x.path === 'docs/PRODUCT.md')?.originalText).toBe('# product\n');
    expect(readOriginalRules(id)).toBe('\uFEFFmust never be context\r\n');
  });

  it('reports symlinks and oversized originals, and blocks unsafe rules files', () => {
    const id = repo({ 'docs/keep.md': 'ok', 'docs/large.md': 'x'.repeat(64 * 1024 + 1) }, ['docs/link.md', 'docs/AGENTS.md']);
    const ctx = readRepoContext(id, []);
    expect(ctx.originals.find((x) => x.path === 'docs/link.md')?.omissionReason).toBe('symlink');
    expect(ctx.originals.find((x) => x.path === 'docs/large.md')?.omissionReason).toBe('file_limit');
    expect(() => readOriginalRules(id)).toThrow(expect.objectContaining({ code: 'export_blocked', items: ['docs/AGENTS.md'] }));
  });

  it('includes an eligible rule file only when it is absent from the baseline', () => {
    const id = repo({ 'docs/keep.md': 'ok' });
    expect(readOriginalRules(id)).toBeNull();
  });

  it('prioritizes requested targets and reads only exact tracked baseline blobs', () => {
    const files: Record<string, string> = { 'docs/target.md': 'baseline target\n' };
    for (let i = 0; i < 52; i++) files[`docs/${String(i).padStart(2, '0')}.md`] = `candidate ${i}\n`;
    const id = repo(files);
    const dir = repoDir(id);
    fs.writeFileSync(path.join(dir, 'docs/target.md'), 'dirty worktree\n');
    fs.writeFileSync(path.join(dir, 'docs/untracked.md'), 'untracked\n');
    const ctx = readRepoContext(id, ['target.md']);
    expect(ctx.originals[0]).toMatchObject({ path: 'docs/target.md', originalText: 'baseline target\n' });
    expect(ctx.originals.find((x) => x.path === 'docs/untracked.md')).toBeUndefined();
    expect(ctx.originals.filter((x) => x.originalText !== null)).toHaveLength(50);
    expect(ctx.originals.find((x) => x.path === 'docs/51.md')?.omissionReason).toBe('file_limit');
  });

  it('reports the aggregate UTF-8 limit and invalid UTF-8 or NUL blobs', () => {
    const files: Record<string, string | Buffer> = {};
    for (let i = 0; i < 5; i++) files[`docs/${i}.md`] = 'x'.repeat(60 * 1024);
    files['docs/binary.md'] = Buffer.from([0xff, 0xfe]);
    files['docs/nul.md'] = Buffer.from('text\0content');
    const id = repo(files);
    const ctx = readRepoContext(id, []);
    expect(ctx.originals.filter((x) => x.omissionReason === 'total_limit').length).toBeGreaterThan(0);
    expect(ctx.originals.find((x) => x.path === 'docs/binary.md')?.omissionReason).toBe('non_text');
    expect(ctx.originals.find((x) => x.path === 'docs/nul.md')?.omissionReason).toBe('non_text');
  });
});
