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
  └─ 프로젝트 목록 / 프로젝트 상세(단계 목록: 인터뷰 · 고정 문서 · 요구사항 문서 · 화면 정의서 · 변경 기록 · 내보내기)
     └─ 화면 정의서: iframe 미리보기 + 선택·그리기 주석 + 컴포넌트 교체(DOMParser)
        │  fetch · SSE
서버 (Next.js route handler)
  ├─ 프로젝트·문서·인터뷰 API ──► DB 모듈 (SQLite)
  ├─ 에이전트 실행 API (SSE) ───► 에이전트 모듈 ──► claude / codex 자식 프로세스
  └─ 내보내기 API ─────────────► DB 모듈 → zip
```

- **페이지**: 화면과 입력만 맡는다. DB·CLI에 직접 접근하지 않는다.
- **API**: 요청 검증, 단계 순서 규칙(앞 단계 승인 여부) 검사, 모듈 호출.
- **DB 모듈**: 스키마 생성과 조회·저장. 테이블은 [3-DATABASE.md](3-DATABASE.md).
- **에이전트 모듈**: CLI별 어댑터(`claude`, `codex`)가 같은 형태를 제공한다 — 프롬프트와 선택적 세션 ID를 받아, 텍스트 스트림과 세션 ID를 돌려준다. 세부 규칙은 [requirements/agent-cli.md](requirements/agent-cli.md).
- **프롬프트·규칙**: 인터뷰와 문서 종류별(고정 문서, 요구사항, 화면 정의서, 변경 기록) 프롬프트, 화면 주석 요청 템플릿, 그리고 생성 문서에 넣을 문서 규칙(`AGENTS.md`) 사본은 코드에 고정한다.
- **화면 정의서 반영**: 마크다운 문서는 서버가 결과를 저장하지만, 화면 정의서는 브라우저가 결과를 정리(스크립트 제거, 컴포넌트 교체)한 뒤 저장 API로 저장한다. 세부는 [requirements/screens.md](requirements/screens.md#결과-반영).

## 데이터 흐름

1. 사용자가 단계(인터뷰 또는 문서)와 에이전트를 고르고 실행한다.
2. API가 앞 단계 승인 여부를 확인하고, 프롬프트를 조립한다. 들어가는 내용은 [requirements/documents.md](requirements/documents.md#생성-입력).
3. 에이전트 모듈이 CLI를 실행하고 출력을 SSE로 브라우저에 흘린다.
4. 완료되면 결과를 DB에 저장한다. 인터뷰는 CLI 세션 ID를 저장해 다음 턴에 이어 간다.

단계 간 맥락은 CLI 세션이 아니라 승인된 문서로 넘긴다. 그래서 단계마다 다른 에이전트를 골라도 된다.

## 외부 연동: 에이전트 CLI

| CLI | 실행 형태 | 멀티턴 |
| --- | --- | --- |
| Claude Code | `claude -p` + JSON 스트림 출력 | 세션 ID로 이어하기 (`--resume`) |
| Codex | `codex exec` + JSON 출력 | 세션 ID로 이어하기 (`codex exec resume`) |

- 두 CLI 모두 파일 쓰기·명령 실행을 막는 모드(도구 제한 / read-only sandbox)로 실행한다.
- 정확한 플래그와 JSON 이벤트 형식은 두 CLI가 서로 다르고 버전에 따라 바뀐다. 구현 시 설치된 CLI의 `--help`와 실제 출력으로 확인하고, 확인한 값을 이 표에 기록한다.
- 앱은 자체 OAuth를 구현하지 않는다. 로그인은 공식 CLI 로그인 명령(`claude auth login --claudeai`, `codex login --device-auth`)을 자식 프로세스로 실행해 처리하고, 토큰은 CLI가 자기 저장소에 보관한다. 상태 확인은 `claude auth status`, `codex login status`. 세부는 [requirements/agent-cli.md](requirements/agent-cli.md).

## 실행·테스트

| 용도 | 명령 |
| --- | --- |
| 개발 실행 | `npm run dev` |

테스트 명령은 구현 시 정하고 여기에 추가한다.

| 환경변수 | 용도 | 기본값 |
| --- | --- | --- |
| `CLAUDE_CLI` | Claude Code 실행 명령 | `claude` |
| `CODEX_CLI` | Codex 실행 명령 | `codex` |

셸 alias는 자식 프로세스에 적용되지 않는다. `claude`를 alias(예: `npx @anthropic-ai/claude-code`)로 쓰는 환경이면 `CLAUDE_CLI`에 실제 명령을 지정한다. 비밀값은 기록하지 않는다 (MVP는 API 키를 쓰지 않는다).

## 배포

하지 않는다. 로컬 실행 전용이다 ([0-PRODUCT.md](0-PRODUCT.md) 제품 공통 정책).
