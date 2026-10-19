# 시스템 아키텍처

> 상태: 예정 — 코드 없음. 아래는 MVP에서 확정한 구조다. 구현 후 실제 경로·명령으로 갱신한다 ([changes/001-mvp.md](changes/001-mvp.md)).

## 기술 스택

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| 앱 | Next.js (App Router), TypeScript | 화면과 서버 처리를 한 프로세스·한 명령으로 띄운다. |
| DB | SQLite (`better-sqlite3`) | 단일 사용자 로컬 앱이라 파일 하나로 충분하다. 동기 API라 코드가 단순하다. |
| 에이전트 | 로컬 `claude` CLI, `codex` CLI를 자식 프로세스로 실행 | 구독 로그인을 쓰는 유일한 방법이다. API 키를 쓰지 않는다. |
| 스트리밍 | Server-Sent Events | 서버→브라우저 단방향 출력이면 충분하다. |
| 문서 편집 | 마크다운 텍스트 편집 + 미리보기 | 문서가 마크다운이다. |
| 화면 정의서 | 스크립트를 막은 iframe 미리보기 + 브라우저 내장 `DOMParser` | 에이전트가 만든 HTML을 실행하지 않고 보여 주고, 컴포넌트 교체를 라이브러리 없이 한다. |
| 내보내기 | zip 라이브러리 1개 (예: `jszip`) | 승인 문서 세트를 `docs/` 구조 그대로 한 파일로 내려받는다. |

## 모듈 역할과 경계

```text
브라우저 (페이지)
  └─ 프로젝트 목록 / 프로젝트 상세(단계 목록: 인터뷰 · 기본 문서 · 요구사항 문서 · 화면 정의서 · 변경 기록 · 내보내기)
     └─ 화면 정의서: iframe 미리보기 + 선택·그리기 주석 + 컴포넌트 교체(DOMParser)
        │  fetch · SSE
서버 (Next.js route handler)
  ├─ 프로젝트·문서·인터뷰 API ──► DB 모듈 (SQLite)
  ├─ 에이전트 실행 API (SSE) ───► 에이전트 모듈 ──► claude / codex 자식 프로세스
  └─ 내보내기 API ─────────────► DB 모듈 → zip
```

- **페이지**: 화면과 입력만 맡는다. DB·CLI에 직접 접근하지 않는다. 예외로 화면 정의서의 HTML 정리·컴포넌트 교체는 브라우저가 한다 ([requirements/screens.md](requirements/screens.md#결과-반영)).
- **API**: 요청 검증, 생성 순서·동시 실행 규칙 검사, 모듈 호출.
- **DB 모듈**: 스키마 생성과 조회·저장. 테이블은 [3-DATABASE.md](3-DATABASE.md).
- **에이전트 모듈**: CLI별 어댑터(`claude`, `codex`)가 실행·상태 확인·로그인을 같은 형태로 제공한다. 동작 규칙은 [requirements/agent-cli.md](requirements/agent-cli.md), CLI별 실제 명령은 아래 [외부 연동](#외부-연동-에이전트-cli).
- **프롬프트**: 인터뷰와 문서 종류별 프롬프트, 화면 주석 요청 템플릿은 코드에 고정한다.
- **문서 규칙**: 생성 프롬프트에 넣고 zip에 담는 문서 규칙은 이 저장소의 [`docs/AGENTS.md`](AGENTS.md)를 실행 시 그대로 읽는다. 사본을 따로 두지 않는다.

## 데이터 흐름

1. 사용자가 단계(인터뷰 또는 문서)와 에이전트를 고르고 실행한다.
2. API가 생성 조건을 확인하고 프롬프트를 조립한다. 들어가는 내용은 [requirements/documents.md](requirements/documents.md#생성-입력).
3. 에이전트 모듈이 CLI를 실행하고 출력을 SSE로 브라우저에 흘린다.
4. 완료되면 결과를 저장한다 — 마크다운 문서는 서버가, 화면 정의서는 브라우저가 정리 후 저장 API로. 인터뷰는 CLI 세션 ID를 저장해 다음 턴에 이어 간다.

## 외부 연동: 에이전트 CLI

2026-10-19에 Claude Code 2.1.303, codex-cli 0.162.1로 실제 실행해 확인한 값이다. CLI를 올리면 다시 확인하고 이 표를 갱신한다.

### 실행

| 항목 | Claude Code | Codex |
| --- | --- | --- |
| 실행 | `<CLAUDE_CLI> -p --output-format stream-json --verbose --include-partial-messages --tools "" --setting-sources "" --strict-mcp-config --session-id <uuid>` | `<CODEX_CLI> exec --json --sandbox read-only --skip-git-repo-check --ignore-user-config -C <작업 폴더> -` |
| 이어하기 | `--session-id` 대신 `--resume <uuid>` | `exec <같은 옵션> resume <thread_id> -` |
| 프롬프트 전달 | 표준입력 | 표준입력 (`-`) |
| 세션 ID | 시도마다 새 UUID를 만들어 `--session-id`로 지정하고, 첫 턴이 성공한 뒤 저장 | 첫 이벤트 `thread.started`의 `thread_id` (첫 턴 성공 뒤 저장) |
| 출력 조각 | `stream_event` → `content_block_delta`의 `delta.text` | 없음. 그 턴의 마지막 `item.completed`(`item.type = agent_message`)가 전체 본문 |
| 최종 결과 | `type: result` — `result`, `is_error`, `session_id` | `turn.completed` (실패는 `turn.failed` / `error`) |
| 도구·명령 | `--tools ""`로 도구 0개 (명령 실행·파일 접근 없음) | read-only sandbox — 파일 쓰기는 막히지만 읽기 명령은 실행될 수 있다 |
| 사용자 설정·지시문 | `--setting-sources "" --strict-mcp-config`로 사용자 훅·플러그인·MCP와 전역 `~/.claude/CLAUDE.md`가 빠진다 (내장 플러그인만 남음) | `--ignore-user-config`만으로는 전역 `~/.codex/AGENTS.md`가 들어간다. 그래서 `CODEX_HOME`을 앱 전용 폴더로 둔다 (아래 실행 환경) |

- **`--bare`는 쓰지 않는다.** OAuth를 읽지 않아 구독 로그인이 동작하지 않는다.
- Codex의 `--sandbox` 등 `exec` 옵션은 `resume` 턴에도 적용된다 (이어하기 턴에서 파일 생성 시도가 막힘을 확인).
- 표준입력을 닫지 않으면 두 CLI 모두 입력을 기다린다. 프롬프트를 쓰고 바로 닫는다.
- 두 CLI 모두 작업 폴더에 파일을 만들지 않았다.

### 실행 환경

- **작업 폴더**: 모든 자식 프로세스는 `<데이터 폴더>/agent-workdir`(빈 폴더, 고정)에서 실행한다. SDDMaker 저장소에서 실행하면 CLI가 SDDMaker의 `AGENTS.md`·`docs/`를 지시로 읽어 생성 문서가 오염된다. Claude 세션은 작업 폴더 기준으로 저장되므로 폴더를 바꾸지 않는다.
- **Codex 홈 분리**: Codex는 `CODEX_HOME=<데이터 폴더>/codex-home`으로 실행한다. 사용자 전역 지시문(`~/.codex/AGENTS.md`)이 생성 문서에 섞이지 않게 하기 위해서다. 그래서 SDDMaker의 Codex 로그인은 사용자 터미널의 Codex 로그인과 따로이며, 로그인 파일은 CLI가 이 폴더에 둔다. Claude는 사용자 기본 로그인을 그대로 쓴다.
- **API 키 제거**: 자식 프로세스 환경에서 `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY`를 지운다. 남아 있으면 구독 대신 API 키로 과금될 수 있다.
- **셸 미사용**: 실행 파일을 직접 실행한다(`spawn`, 셸 없음).

### 로그인 상태·로그인

| 항목 | Claude Code | Codex |
| --- | --- | --- |
| 상태 확인 | `auth status` — JSON. 로그인: `loggedIn: true`, `authMethod: "claude.ai"`(구독). 미로그인: `loggedIn: false`, `authMethod: "none"` | `login status` (`CODEX_HOME` 지정) — 로그인: `Logged in using ChatGPT`, 종료 코드 0. 미로그인: `Not logged in`, 종료 코드 1 |
| 로그인 | `auth login --claudeai` (구독, 브라우저가 열림) | `login --device-auth` (`CODEX_HOME` 지정, URL·코드 출력) |
| 터미널 로그인 안내 | `claude auth login` | `CODEX_HOME=<데이터 폴더>/codex-home codex login` |

- 로그인 명령이 터미널 없는 자식 프로세스에서 URL·코드를 어떻게 출력하는지는 아직 확인하지 않았다 (실제 로그인이 필요). [changes/001-mvp.md](changes/001-mvp.md) 구현 작업 1에서 확인한다.
- 앱은 자체 OAuth를 구현하지 않고 토큰을 다루지 않는다 ([requirements/agent-cli.md](requirements/agent-cli.md#규칙)).

## 보안

- 개발 서버는 `127.0.0.1`에만 연다. 인증 없는 API가 사용자 구독으로 CLI를 실행하므로 같은 네트워크에 열면 안 된다.
- 모든 요청은 `Host`가 `localhost`/`127.0.0.1`일 때만 받는다 (DNS rebinding으로 문서 본문을 읽는 것을 막음). 변경 요청(POST·PUT·DELETE)은 `Origin`도 같은 조건을 검사한다 (다른 웹사이트가 보내는 요청으로 CLI가 실행되는 것을 막음).
- `<데이터 폴더>`에는 DB와 SDDMaker용 Codex 로그인 파일이 있다. git에 올리거나 공유하지 않는다.

## 서버 공유 상태

프로젝트별 실행 잠금과 실행 중인 자식 프로세스 목록은 여러 API(생성·취소·프로젝트 삭제)가 함께 쓴다. 개발 서버가 모듈을 다시 읽어도 사라지지 않게 `globalThis`에 둔다.

## 실행·테스트

| 용도 | 명령 |
| --- | --- |
| 개발 실행 | `npm run dev` (= `next dev -H 127.0.0.1`) |

테스트 명령은 구현 시 정하고 여기에 추가한다.

| 환경변수 | 용도 | 기본값 |
| --- | --- | --- |
| `CLAUDE_CLI` | Claude Code 실행 파일의 절대 경로. 인자를 넣지 않는다 | `claude` (PATH에서 찾음) |
| `CODEX_CLI` | Codex 실행 파일의 절대 경로. 인자를 넣지 않는다 | `codex` (PATH에서 찾음) |
| `SDDMAKER_DATA_DIR` | DB 파일(`sddmaker.db`), CLI 작업 폴더(`agent-workdir/`), Codex 홈(`codex-home/`)을 둘 폴더 | `./data` |

- 환경변수는 `.env.local`에 둔다. 셸 alias는 자식 프로세스에 적용되지 않으므로, `claude`를 alias로 쓰는 환경(예: `npx @anthropic-ai/claude-code`)은 Claude Code를 전역 설치하고 그 경로를 `CLAUDE_CLI`에 넣는다.
- `./data/`는 git에서 제외한다.
- 비밀값은 기록하지 않는다 (MVP는 API 키를 쓰지 않는다).

## 배포

하지 않는다. 로컬 실행 전용이다 ([0-PRODUCT.md](0-PRODUCT.md#제품-공통-정책)).
