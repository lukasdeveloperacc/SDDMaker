# 012 문서 편집기 탭

> 상태: 완료 (2026-10-21)

## 이유

문서 편집기는 마크다운 입력과 미리 보기를 나란히(좁은 화면에서는 위아래로) 함께 보여 준다. 문서가 길면 같은 내용이 두 번 이어져 화면이 길어지고, 읽을 때와 고칠 때 모두 필요 없는 쪽이 자리를 차지한다.

## 범위

- 편집기를 **마크다운 / 미리 보기** 두 탭으로 나눈다. 한 번에 한 쪽만 보인다. `마크다운`은 편집할 수 있는 문서와 읽기 전용 문서 모두에 맞는 이름이다.
- **처음 열 때의 탭**: 본문이 있으면 **미리 보기**, 본문이 비어 있고 편집할 수 있으면 **마크다운**. 탭을 바꿔도 입력 중인 내용은 그대로이며 저장 동작은 바뀌지 않는다.
- 탭은 기존 탭 패턴(연결 화면의 로그인 방식 탭과 같은 `role="tablist"`·`aria-selected`·밑줄 표시)을 쓴다. 키보드로 탭을 옮길 수 있다.
- 미리 보기 위의 `미리보기` 머리글은 탭 이름과 겹치므로 없앤다.
- 문서 패널의 편집기(`MarkdownEditor`)를 쓰는 모든 문서에 적용한다. 화면 정의서의 HTML 편집기는 바꾸지 않는다.

관련 기준: [문서 생성·편집·승인](../requirements/documents.md), [디자인](../2-DESIGN.md).

## 제외 범위

- 나란히 보기 옵션, 탭 선택 기억.
- 마크다운 편집 도구 모음·단축키.
- 화면 정의서 편집기 변경.

## 작업

1. `MarkdownEditor`에 탭 두 개와 처음 탭 규칙을 넣는다.
2. 편집기 CSS(`editor-split`)를 한 칸 레이아웃으로 정리한다.
3. 컴포넌트 테스트: 처음 탭(본문 있음 → 미리 보기, 빈 편집 가능 문서 → 마크다운), 탭 전환 후 입력 유지, 한 번에 한 패널만 보임.
4. `requirements/documents.md`의 편집 설명을 반영 상태로 고친다.

## 검증

- 컴포넌트 테스트, 린트·타입 검사·전체 테스트·빌드.
- 브라우저에서 1280×800·390×844로 초안·승인된 문서의 두 탭과 키보드 전환을 확인한다.

## 결과

- 코드: `src/components/documents/MarkdownEditor.tsx`, `src/app/globals.css`(`editor-split` 제거, `editor-tabs` 추가).
- 테스트: `test/components/markdown-editor.test.ts`(신규).
- 문서: `docs/requirements/documents.md`, `docs/1-SYSTEM-ARCHITECTURE.md`(편집기 설명).
- 확인(Frontend 팀 검사): `npx vitest run test/components` 9개 파일 99개 통과, 타입 검사·`npx eslint src` 종료 코드 0, 전체 `npx vitest run` 37개 파일 513개 통과.
- 전체 검사: `npm run lint`·`npm run typecheck` 통과, `npm test` 37개 파일·513개 통과, `npm run build` 통과.
- 리뷰: Karpathy·Ponytail·Impeccable 모두 PASS(필수 수정 0). 권고 13건(미리 보기 최소 높이, 링크 문구 통일, 섹션 제목 크기 등)은 후속으로 남겼다.
- 브라우저 확인: 1280×800·1024×768·390×844, 한국어, 밝은 테마(Impeccable, 화면 64장).
- 남은 것: 화면 낭독기 안내와 실제 기기 터치는 확인하지 않았다.
