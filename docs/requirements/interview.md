# 초기 인터뷰

> 상태: 예정 ([changes/001-mvp.md](../changes/001-mvp.md))

## 목적

문서를 만들기 전에 에이전트가 질문으로 요구사항을 모아, `0-PRODUCT.md` 이후 모든 문서의 입력이 될 요약을 만든다. 인터뷰는 선택 사항이다.

## 동작

1. 사용자가 에이전트(`claude` | `codex`)를 고르고 인터뷰를 시작한다. 에이전트가 아이디어를 바탕으로 첫 질문을 한다.
2. 에이전트는 **한 번에 질문 하나**만 한다. 사용자가 답하면 같은 CLI 세션으로 다음 질문이 이어진다.
3. 에이전트가 충분하다고 판단하면 요약을 만들자고 제안하는 응답을 보낸다.
4. 사용자는 언제든 **인터뷰 완료**를 눌러 끝낼 수 있다. 완료하면 에이전트가 대화 전체를 요약한다.
5. 요약은 편집기에서 직접 수정할 수 있다. **승인**하면 `0-PRODUCT.md` 단계가 열린다.
6. **건너뛰기**: 인터뷰 시작 전이나 도중(`active`, `summarized`)에 건너뛸 수 있다. 건너뛰면 아이디어만으로 `0-PRODUCT.md`를 만든다. 그때까지의 대화는 남지만 문서 생성에 쓰지 않는다.
7. **승인 취소**: 승인한 요약을 다시 고치려면 승인을 취소한다 (`summarized`로 돌아감). 뒤 문서에는 [앞 문서 변경 표시](documents.md#앞-문서-변경-표시)가 붙는다.

(예정) 저장소 프로젝트는 에이전트가 코드를 먼저 읽고 코드로 알 수 없는 것만 묻는다. 상태와 API는 같다 ([github.md](github.md#저장소-프로젝트의-생성)).

에이전트 질문과 요약은 스트리밍으로 표시한다 (Codex는 끝날 때 한 번에, [agent-cli.md](agent-cli.md#실행)).

## 규칙

- 인터뷰 에이전트는 시작할 때 정하고, 인터뷰 중에는 바꾸지 않는다. CLI 세션이 에이전트별로 따로이기 때문이다.
- 상태 전이: (없음) → `active` → `summarized` → `approved`. (없음)·`active`·`summarized` → `skipped`. `approved` → `summarized` (승인 취소).
- `summarized`에서는 답변을 받지 않는다 (409). 더 묻고 싶으면 요약을 직접 고친다.
- `0-PRODUCT.md` 생성 조건: 인터뷰가 `approved` 또는 `skipped`.
- 문서 생성 프롬프트에는 대화 원문이 아니라 승인된 요약만 넣는다.
- 동시 실행 규칙은 [documents.md](documents.md#규칙)와 같다.

## 예외

| 상황 | 처리 |
| --- | --- |
| CLI 미설치·미로그인·구독 아님 | [agent-cli.md](agent-cli.md#예외)의 안내 표시. 인터뷰 상태는 바뀌지 않는다 |
| 첫 질문 생성 실패 | 세션 ID 없는 `active` 인터뷰가 남는다. `POST /interview`로 다시 시작할 수 있다 |
| 답변 처리 중 에이전트 실패 | 사용자 답변은 저장하고 에러를 표시한다. **다시 시도**는 `content` 없이 `POST /interview/messages`를 보내고, 마지막 user 메시지로 다시 요청한다 (새 메시지를 만들지 않음) |
| CLI 세션 이어하기 실패 (세션 파일 없음 등) | DB의 대화 기록을 프롬프트에 넣어 새 세션을 만들고, 새 세션 ID로 바꾼다 |
| 진행 중 앱 종료 | 메시지와 세션 ID가 남아 있어 이어서 답할 수 있다 |
| 실행 중인데 또 요청 | 409 |

## API (예정)

스트리밍 응답의 이벤트 형식은 [agent-cli.md](agent-cli.md#sse-이벤트-예정).

| 메서드·경로 | 요청 | 응답 |
| --- | --- | --- |
| `POST /api/projects/:id/interview` | `{ agent }` | SSE — 첫 질문. 인터뷰가 없거나, 세션 ID 없는 `active`일 때만 (그 외·`skipped`는 409) |
| `POST /api/projects/:id/interview/messages` | `{ content? }` | SSE — 다음 질문. `content`가 없으면 마지막 답변으로 다시 시도 (마지막 메시지가 agent면 409) |
| `POST /api/projects/:id/interview/summary` | — | SSE — 요약 생성 (`summarized`) |
| `PUT /api/projects/:id/interview/summary` | `{ summary }` | 저장된 요약 (`summarized`에서만) |
| `POST /api/projects/:id/interview/approve` | — | `approved` |
| `POST /api/projects/:id/interview/unapprove` | — | `summarized` |
| `POST /api/projects/:id/interview/skip` | — | `skipped` (`approved`가 아닐 때) |

## 완료·테스트 기준

- [ ] Claude로 인터뷰를 시작하면 질문이 하나씩 스트리밍되고, 답하면 같은 세션으로 다음 질문이 온다.
- [ ] 인터뷰 완료 후 요약을 수정·승인하면 `0-PRODUCT.md` 생성이 가능해진다.
- [ ] 시작 전 건너뛰기, 진행 중 건너뛰기 모두 아이디어만으로 `0-PRODUCT.md`를 생성할 수 있다.
- [ ] 답변 처리가 실패하면 다시 시도로 같은 답변이 한 번만 저장된 채 다음 질문이 온다.
- [ ] 인터뷰 도중 앱을 재시작해도 이어서 답할 수 있다.
