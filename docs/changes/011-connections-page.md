# 011 연결 화면 정리

> 상태: 완료 (2026-10-21)

## 이유

GitHub 연결([009](009-github-repo.md))이 들어오면서 `/settings/agents`에는 AI 에이전트가 아닌 연결도 함께 있다. 메뉴 이름 **에이전트 연결**이 화면 내용과 맞지 않고, Claude Code·Codex·GitHub가 한 목록에 섞여 있어 각 연결이 무엇에 쓰이는지 구분되지 않는다.

상단 바는 로고 → 사용량 → 메뉴 순서라 주 메뉴가 화면 오른쪽 끝에 있다. 로고와 본문 제목은 왼쪽에 있어 메뉴까지 시선과 마우스가 멀리 움직이고, 지금 어느 메뉴에 있는지도 표시되지 않는다.

## 범위

- **메뉴·제목 이름**: 상단 메뉴와 화면 제목을 **에이전트 연결**에서 **연결**로 바꾼다. 주소 `/settings/agents`와 API는 그대로 둔다.
- **안내 문구**: 제목 아래 한 줄을 `문서 생성에 쓸 AI 에이전트와 GitHub 계정을 연결하세요.`로 바꾼다.
- **연결 종류별 섹션**: 목록을 두 섹션으로 나눈다. 탭이 아니라 위아래로 쌓은 섹션이며, 세 연결의 상태를 한 화면에서 함께 본다.
  - **AI 에이전트**: Claude Code, Codex. 설명 `인터뷰와 문서 생성에 쓰는 구독 계정입니다.`
  - **GitHub**: GitHub. 설명 `저장소를 받아 문서를 만들고 PR을 올릴 때 씁니다.`
- **로그인 방식 탭**: **간편 로그인 / 터미널** 탭은 지금처럼 화면 위쪽에 하나만 두고 두 섹션 모두에 적용한다. 탭 안에 다시 탭을 두지 않는다. 인증 중 탭 전환을 막는 규칙은 그대로다.
- **섹션 모양**: [디자인 문서](../2-DESIGN.md)의 카드(흰 바탕, `{rounded.lg}`, hairline 테두리)와 기존 제목·caption 글자 스타일을 쓴다. 새 색·장식은 넣지 않는다. 휴대폰 폭(390px)에서도 같은 순서로 쌓인다.
- **안내 문구 통일**: 작업 화면·오류 안내·문서에서 이 화면을 가리키는 **에이전트 연결 화면**을 **연결 화면**으로 바꾼다. 링크 주소는 그대로다.
- **상단 바 배치**: 왼쪽에 로고와 주 메뉴(**프로젝트**, **연결**)를 붙여 두고, 사용량은 오른쪽 끝으로 옮긴다. 왼쪽은 이동, 오른쪽은 상태다.
- **현재 메뉴 표시**: 지금 있는 메뉴에 `aria-current="page"`를 주고, 글자를 진하게(`{colors.ink}`) 하고 아래에 `{colors.primary}` 밑줄을 둔다. 프로젝트 목록(`/`)과 프로젝트 상세(`/projects/…`)는 **프로젝트**, `/settings/agents`는 **연결**이 현재 메뉴다.
- **좁은 화면**: 1024px 이하에서는 첫 줄에 로고와 메뉴, 둘째 줄에 사용량을 둔다. 600px 이하의 사용량 줄임 표시는 지금 규칙을 따른다.

관련 기준: [에이전트 연동](../requirements/agent-cli.md#앱에서-로그인), [GitHub 저장소](../requirements/github.md#github-연결), [사용자 흐름](../4-USERFLOW.md).

## 제외 범위

- 주소 변경(`/settings/connections` 등)과 이전 주소 리다이렉트.
- 연결 종류별 탭, 섹션 접기·펼치기.
- 각 연결의 로그인·해제·상태 확인 동작 변경.
- 새 연결 종류 추가.

## 작업

1. 상단 메뉴(`src/app/layout.tsx`)와 연결 화면 제목·안내 문구(`src/app/settings/agents/page.tsx`)를 바꾼다.
2. `AgentConnections`의 목록을 **AI 에이전트**·**GitHub** 두 섹션으로 나눈다. 섹션마다 제목(`h2`)과 설명 한 줄을 두고, 섹션 `aria-label`도 맞춘다.
3. 오류 안내와 작업 화면의 "에이전트 연결" 링크 문구를 "연결"로 바꾼다.
4. README와 `docs/` 안의 화면 이름(`에이전트 연결` → `연결`)을 실제 반영에 맞춰 고친다.
5. 상단 바 순서를 로고 → 메뉴 → 사용량으로 바꾸고, 현재 메뉴 표시를 넣는다 (`src/app/layout.tsx`, `src/app/globals.css`). 현재 경로 판단은 클라이언트에서 한다.

## 검증

- 컴포넌트 테스트: 두 섹션의 제목·설명과 소속 항목(Claude Code·Codex / GitHub), 로그인 방식 탭이 하나뿐이고 두 섹션에 적용되는지, 메뉴 이름 **연결**, 경로별 `aria-current`(`/`·`/projects/1` → 프로젝트, `/settings/agents` → 연결).
- 브라우저에서 1280·1024·390 폭의 상단 바 순서(로고·메뉴 왼쪽, 사용량 오른쪽 또는 둘째 줄)와 현재 메뉴 표시를 확인한다.
- 기존 로그인·연결 해제·터미널 테스트가 그대로 통과한다.
- 브라우저에서 1280×800·390×844로 미설치·미로그인·로그인 중·로그인됨 상태의 섹션 배치와 줄바꿈을 확인한다.
- 린트·타입 검사·전체 테스트·빌드.

## 결과

- 코드: `src/app/layout.tsx`, `src/components/MainNav.tsx`(신규), `src/app/globals.css`, `src/app/settings/agents/page.tsx`, `src/components/AgentConnections.tsx`, `src/components/RunStatus.tsx`, `src/components/projects/CreateProjectForm.tsx`, `src/components/documents/ExportPanel.tsx`, `src/components/documents/PrDialog.tsx`.
- 테스트: `test/components/main-nav.test.ts`(신규), `agent-connections-github.test.ts`, `login-console.test.ts`.
- 문서: `README.md`, `docs/1-SYSTEM-ARCHITECTURE.md`, `docs/4-USERFLOW.md`, `docs/requirements/agent-cli.md`, `github.md`, `documents.md`(화면 이름·섹션·상단 바 반영).
- 확인(Frontend 팀 검사): `npx vitest run test/components` 9개 파일 99개 통과, 타입 검사·`npx eslint src` 종료 코드 0, 전체 `npx vitest run` 37개 파일 513개 통과, `src`에 옛 화면 이름 없음(grep).
- 전체 검사: `npm run lint`·`npm run typecheck` 통과, `npm test` 37개 파일·513개 통과, `npm run build` 통과.
- 리뷰: Karpathy·Ponytail·Impeccable 모두 PASS(필수 수정 0). 권고 13건(미리 보기 최소 높이, 링크 문구 통일, 섹션 제목 크기 등)은 후속으로 남겼다.
- 브라우저 확인: 1280×800·1024×768·390×844, 한국어, 밝은 테마(Impeccable, 화면 64장).
- 남은 것: 화면 낭독기 안내와 실제 기기 터치는 확인하지 않았다.
