import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 시스템·전역 git 설정을 읽지 않는다. 커밋 작성자도 고정한다.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

const git = (args: string[]) => execFileSync('git', args, { env: GIT_ENV, stdio: 'pipe' });

const DEFAULT_FILES: Record<string, string> = {
  'README.md': '# app\n',
  'docs/0-PRODUCT.md': '# 제품\n',
  'docs/keep.md': 'keep\n',
};

export interface SeededRemote {
  remote: string;   // 가짜 gh가 복제할 bare 저장소 경로 (FAKE_GH_REMOTE)
  outside: string;  // symlinkDocs일 때 docs가 가리키는 바깥 폴더 (secret.txt 포함)
  cleanup(): void;
}

// 임시 bare 저장소를 만든다. 커밋 하나, 기본 파일은 README.md·docs/0-PRODUCT.md·docs/keep.md.
// symlinkDocs면 docs가 바깥 폴더를 가리키는 심볼릭 링크로 커밋된다.
export function seedRemote(opts: { files?: Record<string, string>; symlinkDocs?: boolean } = {}): SeededRemote {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sddmaker-remote-'));
  const work = path.join(root, 'work');
  const outside = path.join(root, 'outside');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(work);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n');
  git(['init', '-q', '-b', 'main', work]);
  for (const [rel, text] of Object.entries(opts.files ?? DEFAULT_FILES)) {
    fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    fs.writeFileSync(path.join(work, rel), text);
  }
  if (opts.symlinkDocs) {
    fs.rmSync(path.join(work, 'docs'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(work, 'docs'));
  }
  git(['-C', work, 'add', '-A']);
  git(['-C', work, 'commit', '-q', '-m', 'init']);
  git(['clone', '-q', '--bare', work, remote]);
  return { remote, outside, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
