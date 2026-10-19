# 데이터베이스

> 상태: 예정 — 스키마는 구현됨(아래 링크), 실제 CLI 수동 검증 전. 전체 스키마를 여기에 다시 적지 않는다 ([changes/001-mvp.md](changes/001-mvp.md)).

스키마: [`src/server/db/schema.ts`](../src/server/db/schema.ts)

로컬 SQLite 파일 하나(`<데이터 폴더>/sddmaker.db`, 위치는 [1-SYSTEM-ARCHITECTURE.md](1-SYSTEM-ARCHITECTURE.md#실행테스트))를 쓴다. 단일 사용자라 사용자·권한 테이블은 없다.

## 엔티티와 관계

```text
projects 1 ── 0..1 interviews 1 ── * interview_messages
projects 1 ── *    documents   (문서 경로마다 하나)
```

## 테이블

### `projects`

| 필드 | 의미 |
| --- | --- |
| `id` | 기본 키 |
| `name` | 프로젝트 이름 |
| `idea` | 사용자가 처음 입력한 앱 아이디어 |
| `design_md` | 사용자가 넣은 디자인 문서 (없으면 NULL). 생성 입력과 `2-DESIGN.md` 내보내기에 그대로 쓴다 |
| `created_at` | 생성 시각 |

### `interviews`

프로젝트당 최대 하나.

| 필드 | 의미 |
| --- | --- |
| `id` | 기본 키 |
| `project_id` | `projects.id` 참조, 유일 |
| `agent` | `claude` \| `codex` — 인터뷰를 진행한 에이전트. 시작 전에 건너뛰면 NULL |
| `session_id` | CLI 세션 ID. 다음 턴을 이어 갈 때 쓴다. 첫 질문 전에는 NULL |
| `summary` | 인터뷰 요약 (편집 가능). 이후 문서 생성의 입력 |
| `status` | `active` \| `summarized` \| `approved` \| `skipped` ([전이 규칙](requirements/interview.md#규칙)) |

### `interview_messages`

| 필드 | 의미 |
| --- | --- |
| `id` | 기본 키 |
| `interview_id` | `interviews.id` 참조 |
| `role` | `agent` \| `user` |
| `content` | 질문 또는 답변 |
| `created_at` | 정렬 기준 |

### `documents`

| 필드 | 의미 |
| --- | --- |
| `id` | 기본 키 |
| `project_id` | `projects.id` 참조 |
| `path` | 내보낼 때의 `docs/` 아래 경로 (예: `0-PRODUCT.md`, `requirements/project.md`, `screens/home.html`, `changes/001-mvp.md`) |
| `content` | 현재 본문. 화면 정의서는 HTML, 나머지는 마크다운 |
| `previous_content` | 마지막 생성·재생성 직전 본문. 되돌리기에 1개만 보관 |
| `status` | `empty` \| `draft` \| `approved` |
| `upstream_changed` | 앞 문서의 승인이 취소된 뒤 아직 확인하지 않음 ([앞 문서 변경 표시](requirements/documents.md#앞-문서-변경-표시)) |
| `agent` | 마지막으로 생성한 에이전트 (직접 쓴 문서는 NULL) |
| `updated_at` | 마지막 변경 시각 |

- 프로젝트 생성 시 기본 행 5개 — 기본 문서 4개와 변경 기록(`0-PRODUCT.md`, `1-SYSTEM-ARCHITECTURE.md`, `3-DATABASE.md`, `4-USERFLOW.md`, `changes/001-mvp.md`)를 `empty`로 만든다.
- `requirements/<기능>.md` 행은 `0-PRODUCT.md`를, `screens/<화면>.html` 행은 `4-USERFLOW.md`를 승인할 때 만든다 ([목록 확정](requirements/documents.md#목록-확정)).
- "목록에서 빠짐"은 저장하지 않는다. 승인된 `0-PRODUCT.md`·`4-USERFLOW.md`의 링크와 비교해 계산한다.
- 생성 순서는 DB에 두지 않고 경로로 코드에서 정한다.
- 화면 정의서의 보내기 전 주석은 저장하지 않는다 (브라우저에만 둔다).

## 키·제약조건

- `documents`: `(project_id, path)` 유일.
- `interviews.project_id` 유일.
- `status`, `agent`, `role` 값은 위 목록으로 제한한다 (`CHECK`, `agent`는 NULL 허용).
- 모든 참조는 `ON DELETE CASCADE` — 프로젝트를 지우면 인터뷰·메시지·문서가 함께 지워진다.
- 생성 순서·동시 실행 조건은 DB 제약이 아니라 API에서 검사한다 ([requirements/documents.md](requirements/documents.md#규칙)).

## 보관·삭제

- 데이터는 로컬 SQLite 파일에 남고, 앱을 다시 켜도 유지된다.
- 버전 히스토리는 보관하지 않는다. 생성·재생성 직전 본문 1개(`previous_content`)만 남긴다.
- 프로젝트 삭제 시 관련 행을 모두 지운다 ([requirements/project.md](requirements/project.md#동작)). 되돌릴 수 없다.
- "목록에서 빠짐" 문서는 사용자가 삭제할 때 행을 지운다.
