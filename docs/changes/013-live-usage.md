# 013 사용량 실시간 반영

> 상태: 완료 (2026-10-21)

## 이유

Claude 사용량은 SDDMaker에서 Claude를 실행할 때 출력으로만 받았다. 앱을 켠 뒤 실행 전이거나, 다른 곳(호스트 터미널 등)에서 같은 구독을 쓰면 상단 바 값이 `—`이거나 낡은 값이었다. 화면도 열 때와 실행이 끝날 때만 다시 읽어서, 열어 둔 화면의 값이 실제와 멀어졌다.

## 범위

- **Claude**: 조회 때마다 공식 CLI `claude -p /usage --output-format json`(`TZ=UTC`)을 실행해 `Current session`(5시간)·`Current week (all models)`(주간) 줄을 읽는다. 모델을 부르지 않아 토큰을 쓰지 않는다. 읽지 못하면 실행 이벤트로 받아 둔 마지막 값을 쓴다.
- **화면**: 탭이 보이는 동안 1분마다 다시 읽고, 다른 탭에서 돌아오면 바로 읽는다.
- 앱은 여전히 토큰을 읽지 않는다 ([agent-cli.md](../requirements/agent-cli.md#사용량)).

## 제외 범위

- 모델별 주간 한도(`Current week (Fable)` 등) 표시.
- 서버 쪽 결과 캐시. 동시 요청은 하나의 CLI 실행으로 합친다.

## 결과

- 코드: `src/server/agents/usage.ts`(`parseClaudeUsage`·`readClaudeUsage`), `src/components/AgentUsage.tsx`(1분 주기·탭 복귀 읽기).
- 테스트: `test/server/agents-usage.test.ts`(글 해석·날짜 없음·12am/12pm·해 넘김·실패·시간 초과·API), `test/components/agent-usage.test.ts`(주기 읽기·숨은 탭), 가짜 CLI `test/fixtures/fake-claude.mjs`의 `-p /usage`.
- 확인: 호스트 Claude Code 2.1.306 실제 계정에서 앱과 같은 인자로 `47%`·`10:50 UTC` 초기화를 읽었다(약 2.7초). 린트·타입 검사·전체 테스트 37개 파일 519개 통과.
- 남은 것: 컨테이너(Dockerfile의 Claude Code 버전)와 실행 중인 앱에서는 확인하지 않았다. `/usage` 글 형식이 바뀌면 오류 없이 마지막 저장값 또는 `—`가 된다.
