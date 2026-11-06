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

export async function logout() {
  recordPid();
  if (process.env.FAKE_LOGOUT === 'hang') await new Promise(() => setInterval(() => {}, 1000));
  if (process.env.FAKE_LOGOUT === 'fail') {
    process.stderr.write('private authentication details\n');
    process.exit(1);
  }
  if (process.env.FAKE_LOGOUT_FILE) {
    fs.writeFileSync(process.env.FAKE_LOGOUT_FILE, JSON.stringify({
      args: process.argv.slice(2),
      claudeHome: process.env.CLAUDE_CONFIG_DIR,
      codexHome: process.env.CODEX_HOME,
      ghConfigDir: process.env.GH_CONFIG_DIR,
    }));
  }
  process.exit(0);
}

export function newId() {
  return randomUUID();
}

const STRIPPABLE = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN',
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
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null,
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
  if (first.startsWith('[SDDMaker 인터뷰 요약]')) return process.env.FAKE_CORE_SCENARIOS === '1'
    ? '# 대상 사용자\n요약 사용자\n\n# 구체적 문제·사용 사례\n현재 문제\n\n# MVP 포함 범위\n핵심 기능\n\n# MVP 제외 범위\n후속 기능\n\n# 우선순위·의존성\n1. 핵심 기능\n\n# 측정 가능한 성공 기준\n완료율 80%\n\n# 미해결 가정·결정\n정책 결정 대기'
    : '# 인터뷰 요약\n\n- 요약 내용';
  if (first.startsWith('[SDDMaker 인터뷰]')) return `질문: 다음 질문입니다 (턴 ${process.pid})`;

  const target = first.match(/^대상 문서: (.+)$/);
  if (!target) return '답변';
  const path = target[1].trim();
  if (process.env.FAKE_CORE_SCENARIOS === '1') return coreScenarioAnswer(path, prompt);
  if (path === '0-PRODUCT.md') return withFence(PRODUCT);
  if (path === '4-USERFLOW.md') return withFence(USERFLOW);
  if (path.startsWith('screens/') && path.endsWith('.html')) {
    return screenHtml(path.slice('screens/'.length));
  }
  if (path === '2-DESIGN.html') {
    return '```html\n<!DOCTYPE html><html data-frame="page"><body><button data-component="button-primary">저장</button></body></html>\n```';
  }
  return withFence(`# ${path}\n\n> 상태: 예정\n\n본문`);
}

export function scenarioTarget(prompt) {
  return prompt.split('\n')[0].trim().match(/^대상 문서: (.+)$/)?.[1]?.trim() ?? null;
}

function coreScenarioAnswer(path, prompt) {
  if (path === '0-PRODUCT.md') return withFence('# 제품\n\n- [프로젝트](requirements/project.md)\n- [내보내기](requirements/export.md)\n\n## 확인 필요\n- 제품 정책은 담당자 확인이 필요합니다.');
  const evidence = '현재 구현 근거: `src/example.ts`의 `example`.';
  if (path === '4-USERFLOW.md') return withFence(`# 사용자 흐름\n\n${evidence}\n\n## 확인 필요\n- 상세 화면 정책은 확인이 필요합니다.`);
  if (path.startsWith('requirements/')) return withFence(`# ${path}\n\n${evidence}\n\n## 확인 필요\n- 요구사항 의도는 확인이 필요합니다.`);
  if (path === 'changes/001-mvp.md') return withFence(`# MVP 구현 순서\n\n1. 요구사항 연결 추가\n   - 의존성: 없음\n   - 완료 확인: 프로젝트 요구사항 문서가 연결됨\n2. 내보내기 지원 추가\n   - 의존성: 1번\n   - 완료 확인: 승인된 문서를 ZIP으로 받을 수 있음\n\n## 제외 범위\n- 자동 배포\n\n## 차단 요소\n- 확인된 차단 요소 없음`);
  if (path === 'changes/001-baseline.md') {
    const baseline = prompt.match(/기준 커밋: ([0-9a-f]{40,64})/)?.[1] ?? '확인 불가';
    return withFence(`# 현재 기준 구현\n\n- 기준 커밋: ${baseline}\n- ${evidence}\n\n## 확인 필요\n- 저장소에 드러나지 않는 제품 의도는 알 수 없습니다.`);
  }
  if (path.startsWith('changes/')) return withFence(`# ${path}\n\n${evidence}\n\n## 확인 필요\n- 우선순위는 확인이 필요합니다.`);
  return withFence(`# ${path}\n\n${evidence}\n\n## 확인 필요\n- 제품 정책은 확인이 필요합니다.`);
}

function withFence(md) {
  return process.env.FAKE_FENCE === '1' ? '```markdown\n' + md + '```' : md;
}
