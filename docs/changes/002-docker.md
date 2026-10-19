# 002 Docker 실행 지원

> 상태: 완료 (2026-10-19)

## 변경 이유와 범위

호스트에 Node.js와 CLI를 직접 설치하지 않아도 Docker 또는 Docker Compose로 SDDMaker를 실행한다. Node.js·앱·Claude Code·Codex CLI를 이미지에 포함하고, DB와 CLI 로그인 정보는 별도 볼륨에 보관한다.

컨테이너 내부는 `0.0.0.0:3000`에서 받고, 호스트에는 `127.0.0.1`로만 포트를 공개한다. 기존 Host·Origin 검사와 구독 전용 실행 규칙을 유지한다. 계정 인증 자동화와 외부 배포는 범위에 포함하지 않는다.

## 구현과 검증

- Next.js standalone 출력, 다단계 Dockerfile, `.dockerignore`, `compose.yaml`을 추가했다.
- 비 root 사용자로 실행하고 DB·CLI 홈을 이름 있는 볼륨에 저장한다.
- 실행·로그인·중지 명령과 저장 경로를 [시스템 아키텍처](../1-SYSTEM-ARCHITECTURE.md#dockerdocker-compose-실행) 및 README에 반영했다. 아키텍처 구조도는 요청에 따라 Mermaid로 바꿨다.

## 결과

- Docker Desktop의 Linux arm64에서 `docker compose config --quiet`와 `docker compose build` 성공. 이미지에서 Node 24.22.0, Claude Code 2.1.303, Codex 0.162.1, SQLite 네이티브 모듈 실행을 확인했다.
- Docker 단독 실행에서도 healthy, 실제 두 CLI의 설치됨·미로그인 상태 조회, 잘못된 Host의 403을 확인했다. 기본 Compose 앱도 별도로 기동해 `http://127.0.0.1:3000`에서 healthy를 확인했다.
- 격리된 Compose 프로젝트로 상태 검사 healthy, UID 1000 실행, `127.0.0.1` 포트 공개, 페이지·정적 파일 응답, 다른 포트 Origin의 403을 확인했다.
- 두 가짜 CLI를 읽기 전용으로 주입해 모든 문서 생성·승인과 zip 내보내기를 확인했다. zip에는 기본 문서·요구사항·화면 정의서·변경 기록·디자인과 원문 `docs/AGENTS.md`가 포함됐다.
- 컨테이너 강제 재생성 후 SQLite의 프로젝트·문서와 `/home/node`·Codex 홈에 둔 확인 파일이 유지됐다. 검증 전용 컨테이너·네트워크·볼륨은 정리했다.
- 기존 테스트 21개 파일·275개, 린트, 타입 검사 통과. Docker 빌드가 Next.js 프로덕션 빌드를 포함한다.
- 별도 읽기 전용 리뷰에서 필수 수정 사항은 없었다.

## 검증 한계

- 실제 계정 인증과 구독 모델 생성은 수행하지 않았다. 최초 실행 시 사용자가 컨테이너의 CLI로 인증한다. 호스트 로그인 파일은 이미지에 넣지 않는다.
- 이 Docker Desktop에서 실제 `codex sandbox linux` 실행은 bubblewrap namespace 권한 오류로 실패했다. 고정 Codex 버전에서는 legacy Landlock도 파일시스템 제한 실행을 지원하지 않는다. 기존 read-only 계약을 유지하고 권한 우회는 추가하지 않았다. Codex의 도구 실행은 이 환경에서 제한되며 Claude 또는 호스트 실행을 사용한다 ([공식 고정 버전 소스](https://github.com/openai/codex/blob/092d3acd6bec3e3a14bdc7e7a2810ab628ab759d/codex-rs/linux-sandbox/README.md#L40-L42)).
- 다른 CPU 아키텍처에서의 이미지 빌드는 이번 검증에 포함하지 않았다.
