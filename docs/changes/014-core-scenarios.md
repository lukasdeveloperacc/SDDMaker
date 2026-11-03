# 014 — 두 핵심 시나리오

> 상태: 구현·자동 검증 완료 — 서버·UI 구현 및 전체 자동 검사 통과. 문서 확정 시점의 브라우저 조작은 미검증이며 독립 검토 결과는 실행 증거에서 관리한다. 2026-10-29.

## 이유와 결과 목표

기존 프로젝트는 현재 코드를 설명하는 지원 문서 세트를 일괄 **초안**으로 만들고, 사람이 코드 근거·원문을 검토/수정한 뒤 명시적으로 승인하여 PR을 올린다. 새 프로젝트는 아이디어 인터뷰를 통해 개발 가능한 요구사항을 만들고, 기존 `changes/001-mvp.md` 안에 구현 순서와 완료 기준을 담는다.

기존 단계별 수동 생성의 승인 조건을 배치가 대신 만족시키거나 자동 승인하지 않는다. 과거 구현 결과는 완료된 변경 기록에 그대로 보존하고, 이 변경은 아래 확장만 다룬다.

## 확정 범위와 수용 기준

| ID | 확정 동작과 수용 기준 | 요구사항/검증 기준 |
| --- | --- | --- |
| R1 | `기존 프로젝트`/`새 프로젝트` 명시적 선택, 유형별 입력과 비활성 값 미제출. 선택적 mode를 생략한 기존 요청/저장 프로젝트 호환 | [프로젝트](../requirements/project.md#r1-명시적-진입) |
| R2 | 저장소 전용 순차 배치. 배치에서만 유효한 선행 초안 허용, 현재 PRODUCT 활성 요구사항 집합으로 행·작업·모든 문맥 통일. 화면/디자인 생성 제외 | [문서](../requirements/documents.md#r2-순차-초안과-활성-목록) |
| R3 | 기존 비어 있지 않은 내용 보존, 문서별 원자 저장, 실패/취소/연결 끊김/재시작 후 수동 재개. 본문 변경 시 하위 초안도 변경 표시, 명시적 확인 전 오래된 입력 사용 차단 | [보존·복구](../requirements/documents.md#r3-내용-보존과-복구) |
| R4 | 상태·진행·근거/원문 검토, 경로 확인 목록과 토큰을 거친 사용자 일괄 승인. 기존 검증·단계 순서·한 트랜잭션, 부분 승인 없음 | [검토·승인](../requirements/documents.md#r4-검토와-원자적-승인) |
| R5 | 소스 경로/심볼/기준 SHA와 확인 필요, 제한된 추적 blob 문맥·누락/가림·원문 비교, 기존 DESIGN/규칙/무관 문서 보존 | [GitHub 근거](../requirements/github.md#r5-근거와-제한된-기존-문서-문맥), [공통 내보내기](../requirements/export.md#r5-저장소-원본-규칙-보존) |
| R6 | GET 및 push 직전 인증된 git 원격 SHA 확인, 기준 차이/조회 실패 중단, 필수 검토 토큰·명시적 덮어쓰기 확인. 기존 프로젝트 보존 후 새 프로젝트로 복구 | [PR 검토](../requirements/github.md#r6-기준-커밋과-명시적-pr-확인) |
| R7 | 한 질문씩 일곱 항목을 채우거나 명시적 미확정으로 남기는 인터뷰. 기존 MVP 변경 문서에 순서/의존성/관찰 가능한 완료 기준/제외/차단 사항 | [인터뷰](../requirements/interview.md#r7-요구사항-구체화) |

제품/흐름은 [0-PRODUCT](../0-PRODUCT.md), [4-USERFLOW](../4-USERFLOW.md), 구조는 [1-SYSTEM-ARCHITECTURE](../1-SYSTEM-ARCHITECTURE.md)에 반영한다. API 형태의 기준은 [`src/lib/contract.ts`](../../src/lib/contract.ts)다. 상세는 기존 기능 요구사항에 두며 별도 API/테스트 계획/ADR/로드맵 문서는 추가하지 않는다.

## 유지할 기존 동작

- 개별 생성은 앞 문서 승인을 요구한다. 기존 편집·피드백 재생성·되돌리기·승인/승인 취소·수동 화면 생성/주석·인터뷰 건너뛰기·삭제·ZIP을 유지한다.
- 저장소 모드는 기존처럼 화면 HTML을 만들지 않고 `changes/001-baseline.md`를 쓴다. 기준선은 현재 구현/근거/미확정 사실의 기록이며 미래 로드맵이 아니다.
- 자동 승인·자동 PR은 없다. 배치 완료도 `draft`이며 ZIP/PR은 실제 승인을 요구한다. 빠진 요구사항 행은 보관하고 기존 수동/내보내기 정책으로 처리한다.
- 원래 `docs/AGENTS.md`는 ZIP·PR 공통 `exportFiles`에서 그대로 보존한다. 없는 경우만 앱 규칙을 쓰고, 읽을 수 없는 기존 규칙은 `export_blocked/items`로 중단한다. 원래 DESIGN은 사용자 입력이 없는 한 손대지 않는다. PR의 생성 대상 밖 파일을 유지한다.

## 구현 작업과 의존 순서

서버 완료는 아래 관찰된 코드/표적 검사 범위다. UI도 아래 컴포넌트 검증을 통과했다. 전체 자동 검사는 통과했으며 브라우저 관찰·독립 검토와 구분한다.

| 순서 | 작업 | 선행 조건 | 관찰 가능한 완료 기준 | 상태 |
| --- | --- | --- | --- | --- |
| 1 | 관련 제품/기능 문서와 공유 API 계약 확정 | 승인된 R1–R7 계획 | 기능 요구사항에 조건·오류·수용 기준, 공유 타입의 batch/repoContext/PR token 존재 | 공유 계약/서버/UI 정합 반영 완료 |
| 2 | 서버 원문 문맥/프롬프트, 배치·복구·입력 잠금·원자 승인 | 1 | 동적 활성 집합, 실패/취소 보존, 오래된 입력 차단, 배치 중 쓰기 거절, 초안 상태 유지의 자동 증거 | 구현·표적 검증 완료 |
| 3 | 공통 ZIP/PR 원본 보존, 원격 최신성·검토 토큰 | 1 | 원문 규칙 동일성/읽기 실패 차단, 원격 전진/조회 실패/변경 토큰에서 push 0건, 명시 확인한 로컬 PR 성공 | 구현·표적 검증 완료 |
| 4 | 두 진입 유형·배치 진행/취소/재개·검토 목록/비교·인터뷰 안내·PR 복구 UI | 공유 계약 1, 서버 동작 2–3 | 실제 조작으로 유형별 값 제출, 초안 0승인, 사용자 확인 후 승인, 오래된 기준 복구 안내 | 구현·컴포넌트 검증 완료 |
| 5 | 자동/브라우저 통합·기존 수동 회귀·독립 검토 | 2–4 | R1–R7 증거, 전체 검사, 1280×900/390×844 조작 검증, 해결되지 않은 중대 지적 없음 | 전체 자동 검사 통과; 브라우저/독립 결과는 실행 증거 관리 |

배치는 기존 잠금·SQLite 문서 행·SSE를 재사용한다. DB 스키마/마이그레이션·영속 작업 큐·작업 이력을 추가하지 않는다. API는 선택적 생성 mode, 상세 batch/repoContext, 별도 batch SSE/취소/일괄 승인, PR 미리보기 SHA/token과 필수 POST `{reviewToken, confirmOverwrites}`를 사용한다. 성공 PR은 기존 `{url}` 201을 유지한다.

## 제외 범위와 남는 한계

- 앱 코드 생성, 자동 승인/PR, 아키텍처 재설계, 새 의존성, 디자인 원칙 편집/자동 디자인 선택, 저장소 화면 생성은 제외한다.
- 일반 문서 가져오기/편집기, 전체 버전/작업 이력, 자동 재개, 클론 새로고침/reset/rebase/자동 병합은 추가하지 않는다.
- 재시작 후에는 저장된 문서로 부분 진행을 계산한다. 프로세스 종료와 이전 취소를 구별한다고 안내하지 않는다.
- 원문 문맥은 기준 Git blob의 최대 50파일·64 KiB/파일·256 KiB/전체로 제한하고 지시 파일·symlink·비텍스트/초과 내용을 제외한다. 누락 이유를 표시하고 비밀 모양 감지 파일은 본문 전체를 제외한다. `originalText: null`과 `redacted`를 반환하며 알려지지 않은 비밀 형식까지 완전히 제거한다고 주장하지 않는다.
- 코드 인용은 사람이 확인할 근거이며 의미적 진실을 기계가 인증하지 않는다. CLI 읽기 도구/읽기 전용 옵션만으로 악성 저장소의 완전한 파일 읽기 격리를 입증하지 않는다.
- 원격 SHA 최종 확인에서 push까지 원격 기본 브랜치가 바뀔 수 있다. 원자적 GitHub 잠금 보장은 없다.
- 오래된 기준 복구는 현재 프로젝트/초안을 보존하고 새 프로젝트를 만드는 경로다. ZIP도 승인 전에는 제공하지 않는다.

## 검증 방법과 결과

**관찰된 서버 결과:** 실행 증거 `docs/inprogress/core-scenarios/backend-core.md`, `backend-repo.md`, `backend.md`의 완료 기록과 실제 서버 코드를 확인했다.

- CORE 표적 명령 `npx vitest run test/server/batch-api.test.ts test/server/doc-rules.test.ts test/server/documents-api.test.ts test/server/documents-view.test.ts test/server/interview-api.test.ts test/server/projects-api.test.ts test/server/projects-repo.test.ts test/server/runtime.test.ts test/server/prompts.test.ts test/server/annotations-api.test.ts test/lib/contract.test.ts`: 11파일/196건 통과. 정리 후 `npx vitest run test/server/batch-api.test.ts`: 15/15 통과, 범위 ESLint/공백 검사 통과.
- REPO 표적 명령 `npx vitest run test/server/repo-context.test.ts test/server/github-pr.test.ts test/server/export.test.ts test/server/repo-mode.test.ts test/server/github.test.ts`: 5파일/65건 통과. 추가 내용 변경 토큰 1건, 규칙 symlink/토큰/마지막 최신성 4건 통과. 원본 BOM/CRLF·한도·ZIP/PR 보존·로컬 원격 전진 차단을 포함한다.
- 가짜 CLI/시드 구문·시드 실행 검증 통과. 모든 PR 검증은 로컬 bare 원격만 사용했고 외부 push는 수행하지 않았다.

**관찰된 UI 결과:** 실제 진입/배치/인터뷰/비교/PR 컴포넌트와 최종 실행 증거 `docs/inprogress/core-scenarios/frontend.md`, `frontend-ui.md`를 확인했다.

- 작업자 표적 명령 `npx vitest run test/components/projects.test.ts test/components/project-create-form.test.ts test/components/interview-panel.test.ts test/components/batch-panel.test.ts test/components/document-panel.test.ts test/components/export-pr.test.ts test/components/stage.test.ts test/lib/sse-client.test.ts`: 8파일/53건 통과. 범위 ESLint 통과.
- 프런트엔드 리드의 `npx vitest run test/components test/lib/sse-client.test.ts`: 종료 0, 14파일/118건 통과. 유형별 제출, 배치/취소/검토, 원문/확인, PR 토큰/덮어쓰기/복구와 기존 컴포넌트 회귀를 포함한다.
- 8개 변경 TSX 대상 디자인 탐지 종료 0. 정규식 검사만 수행했고 파싱 기반 페이지 규칙은 실행되지 않았으므로 시각 검증 PASS로 해석하지 않는다. CSS/의존성 변경은 없다.

**r1 전체 자동 검사 결과 (수정 전 기록):** `docs/inprogress/core-scenarios/checks-r1.log`와 `checks-r1.json`의 실제 명령 출력/종료 코드를 확인했다. 구현 코드가 정지된 상태에서 루트가 실행했다.

| 명령 | 관찰 결과 | 소요 시간 |
| --- | --- | --- |
| `npm test` | 종료 0, 43파일/568건 통과 | 63.94초 |
| `npm run typecheck` | 종료 0 | 2.29초 |
| `npm run lint` | 종료 0 | 3.27초 |
| `npm run build` | 종료 0, Next.js 프로덕션 빌드 성공 | 24.74초 |

이전 서버 단계의 FE fixture 타입 오류는 위 최종 타입 검사에서 남지 않았다. 자동 검증은 인터뷰/생성 전달 구조, 보존/동시 실행/복구, 원자 승인, 원문 제한·규칙 보존, 로컬 Git 최신성/토큰 및 기존 수동 경로 회귀를 확인한다. 실제 모델 문장 품질을 증명하지 않는다.

**최초 r1 문서 확정 시점의 브라우저·독립 검토:** 당시 실제 브라우저 조작은 아직 검증하지 않았다. 격리된 새 시드/가짜 CLI 프로덕션 서버가 준비됐다는 사실을 1280×900/390×844 조작 PASS로 취급하지 않는다. 브라우저와 고정 변경본의 독립 검토 결과는 별도 실행 증거에 유지하며, 관찰하지 않은 결과를 이 문서에서 예측하지 않는다.

### r1 접근성 지적과 수정

r1의 독립 Impeccable/E2E 브라우저 검토는 1280×900와 390×844에서 같은 필수 지적 I-01을 확인했다. 빈 새 프로젝트/기존 저장소를 제출하면 필드 오류의 `aria-invalid`와 설명 연결은 있었지만 포커스가 제출 버튼에 남고 별도 오류 알림도 없었다. 실제 스크린리더 음성을 검사한 결과는 아니다. 실행 증거는 `docs/inprogress/core-scenarios/review-r1-impeccable.md`, `review-r1-e2e.md`에 보존한다.

수정은 [`CreateProjectForm.tsx`](../../src/components/projects/CreateProjectForm.tsx)의 오류 렌더링 후 첫 `aria-invalid="true"` 입력으로 포커스를 이동하는 처리다. 로컬 필수값 검사와 서버 `repo_not_found`/`invalid_input` 필드 오류에 적용하며, 서버 요청 뒤에는 비활성 fieldset이 풀린 상태에서 동작한다. 기존 필드 설명 연결과 입력값은 유지한다. 공통 UI/API/서버/스키마 변경은 없다.

수정된 DOM 검증은 제출 버튼에 포커스를 둔 시작 상태를 먼저 확인한 뒤, 새 프로젝트 이름→아이디어와 기존 저장소의 첫 오류 포커스·실제 설명·입력값 보존을 확인한다. `npx vitest run test/components/project-create-form.test.ts test/components/projects.test.ts`는 종료 0, 2파일/21건 통과했다. 해당 두 파일 범위 ESLint 종료 0이며 디자인 탐지는 1개 TSX의 정규식 검사만 통과했다. 실제 수정 코드·검증과 실행 기록 `docs/inprogress/core-scenarios/frontend-fix-r1-ui.md`를 확인했다. 이 결과를 r2 독립 검토나 실제 스크린리더/브라우저 재검토 PASS로 해석하지 않는다.

### 수정 후 r2 전체 자동 검사

포커스 수정 코드가 정지된 뒤 루트가 실행한 `docs/inprogress/core-scenarios/checks-r2.log`와 `checks-r2.json`의 실제 결과다. 위 r1의 568건은 수정 전 기록이고 현재 r2는 571건이다.

| 명령 | 현재 r2 관찰 결과 | 소요 시간 |
| --- | --- | --- |
| `npm test` | 종료 0, 43파일/571건 통과 | 31.70초 |
| `npm run typecheck` | 종료 0 | 1.27초 |
| `npm run lint` | 종료 0 | 2.53초 |
| `npm run build` | 종료 0, Next.js 프로덕션 빌드 성공 | 17.24초 |

r2 문서 확정 시점에 수정 후 실제 브라우저/독립 재검토 PASS는 관찰하지 않았다. 그 결과는 별도 실행 증거에서 관리하며 자동 검증 통과와 구분한다.

**검증 한계:** 실제 AI 충실도, 실계정 GitHub push, 소스 근거의 의미적 검증, 악성 저장소의 완전한 읽기 격리는 미검증이다. PR 자동 검증은 로컬 bare 원격만 사용하며 원격 SHA 최종 확인과 push 사이의 경쟁 조건은 남는다. 새 기능의 수동/브라우저 수용 기준은 관련 요구사항에 유지한다.
