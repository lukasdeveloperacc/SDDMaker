# 에이전트 연동

> 상태: 예정 ([changes/001-mvp.md](../changes/001-mvp.md))

## 목적

API 키 없이, 사용자 컴퓨터의 `claude` CLI와 `codex` CLI에 구독 계정으로 로그인해 인터뷰와 문서 생성을 실행한다. 로그인도 앱 화면에서 시작할 수 있다. 구조와 선택 이유는 [1-SYSTEM-ARCHITECTURE.md](../1-SYSTEM-ARCHITECTURE.md).

## 동작

### 실행

- 인터뷰와 각 문서 단계에서 `claude` 또는 `codex`를 고른다.
- 서버가 고른 CLI를 자식 프로세스로 실행하고 출력을 SSE로 브라우저에 흘린다.
- 인터뷰처럼 여러 턴이 필요한 단계는 CLI가 돌려준 세션 ID로 이어 간다. 세션은 단계 안에서만 쓴다.

### 로그인 상태

- 에이전트 선택 화면에 CLI별 상태(미설치 / 미로그인 / 로그인됨)를 보여 준다.
- 실행 직전에도 상태를 확인한다. 미로그인이면 실행하지 않고 로그인 버튼을 보여 준다.

### 앱에서 로그인

미로그인 CLI 옆의 **로그인** 버튼을 누르면 서버가 그 CLI의 공식 로그인 명령을 실행한다.

| CLI | 실행 명령 | 사용자가 하는 일 |
| --- | --- | --- |
| Claude Code | `claude auth login --claudeai` (구독 로그인) | 이 컴퓨터의 브라우저에 열린 로그인 페이지에서 로그인한다. 명령이 URL을 출력하면 화면에도 링크로 보여 준다 |
| Codex | `codex login --device-auth` | 화면에 표시된 URL을 열고 코드를 입력한다 |

로그인 명령이 끝나면 상태 확인 명령으로 다시 확인해 결과를 표시한다. 터미널 로그인(`claude auth login` / `codex login`)도 대안으로 안내한다.

## 규칙

- **어댑터 형태**: CLI마다 어댑터를 두고 같은 형태로 맞춘다 — 입력 `{ prompt, sessionId? }`, 출력은 텍스트 조각 스트림과 최종 `{ text, sessionId }`. 상태 확인과 로그인 실행도 어댑터가 맡는다.
- **권한 제한**: 파일 쓰기와 명령 실행을 막는 모드로 실행한다. 에이전트는 텍스트만 돌려준다.
- **인증 정보는 CLI만 다룬다**: 앱은 공식 CLI 로그인 명령을 실행할 뿐, 자체 OAuth를 구현하지 않는다. 토큰은 CLI가 자기 저장소에 보관하고, 앱은 읽거나 저장하지 않는다.
- **로그인 출력은 남기지 않는다**: 로그인 명령이 출력한 URL·코드는 화면에만 보여 주고 DB·로그에 남기지 않는다.
- **구독 로그인만 제공**: Claude는 `--claudeai`로 실행한다. Console(API 과금) 로그인과 API 키 로그인은 제공하지 않는다.
- **로그인 실행 수**: CLI마다 로그인은 한 번에 하나만 돈다. 진행 중 재요청은 409. 사용자가 취소하거나 10분이 지나면 로그인 프로세스를 종료한다.
- **연결 끊김**: 브라우저 연결이 끊기면 자식 프로세스(실행·로그인)를 종료하고 결과를 저장하지 않는다.
- CLI 플래그와 출력 형식은 구현 시 설치된 버전으로 확인한다 ([1-SYSTEM-ARCHITECTURE.md](../1-SYSTEM-ARCHITECTURE.md) 외부 연동). 특히 두 로그인 명령이 비대화(터미널 없음) 자식 프로세스에서 URL·코드를 어떻게 출력하는지 먼저 확인한다.

## 예외

| 오류 코드 | 판정 | 화면 |
| --- | --- | --- |
| `cli_not_found` | 실행 파일을 찾지 못함 | 설치 안내, 다른 에이전트 선택 가능 |
| `not_logged_in` | 상태 확인 명령이 미로그인을 돌려줌 | 로그인 버튼 + 터미널 로그인 안내 |
| `login_failed` | 로그인 명령이 실패·시간 초과·취소로 끝남 | 이유와 다시 시도 버튼 |
| `agent_failed` | 그 밖의 비정상 종료 | 에러 메시지와 다시 실행 버튼 |

로그인 상태 확인 명령 (2026-10-19, Claude Code 2.1.303 · 설치된 codex에서 확인):

| CLI | 명령 | 로그인 상태 출력 |
| --- | --- | --- |
| Claude Code | `claude auth status` | JSON — `loggedIn: true`, `authMethod: "claude.ai"` |
| Codex | `codex login status` | `Logged in using ChatGPT` |

구독이 아닌 방식(`authMethod`가 `claude.ai`가 아니거나 Codex가 API 키)으로 로그인돼 있으면 그 방식을 표시만 하고 막지는 않는다.

## SSE 이벤트 (예정)

인터뷰·문서 생성 API가 공통으로 쓴다.

| 이벤트 | 데이터 | 의미 |
| --- | --- | --- |
| `delta` | `{ text }` | 출력 조각 |
| `done` | `{ text }` | 완료. 서버가 저장한 최종 본문 |
| `error` | `{ code, message }` | 위 오류 코드 중 하나 |

로그인 API는 아래 이벤트를 쓴다.

| 이벤트 | 데이터 | 의미 |
| --- | --- | --- |
| `prompt` | `{ url, code? }` | 사용자가 열 URL (Codex는 입력할 코드 포함) |
| `done` | `{ loggedIn }` | 로그인 명령 종료 후 상태 확인 결과 |
| `error` | `{ code, message }` | `login_failed` 또는 `cli_not_found` |

## API (예정)

| 메서드·경로 | 응답 |
| --- | --- |
| `GET /api/agents` | `{ claude: { installed, loggedIn, authMethod? }, codex: { installed, loggedIn, authMethod? } }` — 상태 확인 명령 결과 |
| `POST /api/agents/:agent/login` | SSE — 로그인 진행 (`prompt` → `done`) |
| `DELETE /api/agents/:agent/login` | 진행 중인 로그인 취소 |

## 완료·테스트 기준

- [ ] 두 에이전트 모두로 인터뷰 질문과 문서 생성 결과가 스트리밍된다.
- [ ] 선택 화면에 CLI별 설치·로그인 상태가 맞게 나온다.
- [ ] 로그아웃한 Claude CLI를 앱의 로그인 버튼으로 구독 로그인할 수 있고, 끝나면 상태가 로그인됨으로 바뀐다.
- [ ] 로그아웃한 Codex CLI를 앱에 표시된 URL·코드로 로그인할 수 있다.
- [ ] 로그인을 취소하거나 10분이 지나면 로그인 프로세스가 남지 않는다.
- [ ] 로그인 URL·코드가 DB와 서버 로그에 남지 않는다.
- [ ] 생성 중 브라우저를 닫으면 자식 프로세스가 남지 않는다.
- [ ] 에이전트가 프로젝트 폴더나 사용자 파일을 수정하지 않는다.
