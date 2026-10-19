// 가짜 CLI 공용 부품. Node 표준 모듈만 쓴다. 실제 CLI를 부르지 않는다.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export const mode = () => process.env.FAKE_MODE || 'ok';

export function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

export function recordPid() {
  if (process.env.FAKE_PID_FILE) fs.writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));
}

export function newId() {
  return randomUUID();
}

const STRIPPABLE = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY',
  'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'OPENAI_BASE_URL',
];

// 실행 모드 env: 자식이 받은 값을 그대로 돌려준다 (API 키 제거, 작업 폴더, 표준입력 확인용).
export function envReport(stdin) {
  process.stdout.write(JSON.stringify({
    cwd: process.cwd(),
    args: process.argv.slice(2),
    stdin,
    hasAnthropicKey: 'ANTHROPIC_API_KEY' in process.env,
    hasAnthropicToken: 'ANTHROPIC_AUTH_TOKEN' in process.env,
    hasOpenaiKey: 'OPENAI_API_KEY' in process.env,
    hasCodexKey: 'CODEX_API_KEY' in process.env,
    present: STRIPPABLE.filter((k) => k in process.env),
    codexHome: process.env.CODEX_HOME ?? null,
  }) + '\n');
  process.exit(0);
}

// 큰 표준 오류 출력: 마지막 4KB 보관을 확인하려고 쓴다.
export function stderrFlood() {
  process.stderr.write('x'.repeat(10000) + 'END', () => process.exit(1));
}

const PRODUCT = '# 제품\n\n> 상태: 예정\n\n- [프로젝트](requirements/project.md)\n- [내보내기](requirements/export.md)\n';
const USERFLOW = '# 사용자 흐름\n\n> 상태: 예정\n\n- [홈](screens/home.html)\n- [상세](screens/detail.html)\n';

function screenHtml(name) {
  const link = name === 'home.html' ? 'detail.html' : 'home.html';
  return '```html\n'
    + '<!DOCTYPE html><html data-frame="page"><body>'
    + '<header data-component="top-bar">상단</header>'
    + '<main data-component="main-list">'
    + `<a href="${link}">이동</a><a href="missing.html">없는 링크</a>`
    + '</main>'
    + '<footer data-component="footer">하단</footer>'
    + '</body></html>\n```';
}

// 프롬프트 첫 줄에 따라 정해진 답을 고른다.
export function answerFor(prompt) {
  const first = prompt.split('\n')[0].trim();
  const comment = first.match(/^대상 화면: (.+)$/);
  if (comment) {
    return '```html\n<header data-component="top-bar">수정됨</header>\n```\n\n답변: 확인했습니다';
  }
  if (first.startsWith('[SDDMaker 인터뷰 요약]')) return '# 인터뷰 요약\n\n- 요약 내용';
  if (first.startsWith('[SDDMaker 인터뷰]')) return `질문: 다음 질문입니다 (턴 ${process.pid})`;

  const target = first.match(/^대상 문서: (.+)$/);
  if (!target) return '답변';
  const path = target[1].trim();
  if (path === '0-PRODUCT.md') return withFence(PRODUCT);
  if (path === '4-USERFLOW.md') return withFence(USERFLOW);
  if (path.startsWith('screens/') && path.endsWith('.html')) {
    return screenHtml(path.slice('screens/'.length));
  }
  return withFence(`# ${path}\n\n> 상태: 예정\n\n본문`);
}

function withFence(md) {
  return process.env.FAKE_FENCE === '1' ? '```markdown\n' + md + '```' : md;
}
