// 테스트용 부모 프로세스: 가짜 claude를 실행해 두고 기다린다.
// CLEANUP_MODE=exit이면 일정 시간 뒤 process.exit()로 끝낸다 (exit 정리 확인용).
import { spawnCli } from '../../src/server/agents/exec';

const ac = new AbortController();
spawnCli('claude', ['-p'], { stdin: '', signal: ac.signal }).catch(() => {});
if (process.env.CLEANUP_MODE === 'exit') {
  setTimeout(() => process.exit(0), 500);
}
console.log('READY');
