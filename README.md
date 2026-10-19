# SDDMaker

Claude Code·Codex 구독 CLI로 인터뷰를 진행하고, SDD 문서와 화면 정의서를 생성·검토·승인해 `docs/` 구조의 zip으로 내보내는 로컬 앱입니다.

```sh
npm ci
npm run dev
```

브라우저에서 <http://127.0.0.1:3000>을 엽니다. Claude Code 또는 Codex CLI가 필요하며, 앱의 에이전트 설정에서 로그인 상태를 확인할 수 있습니다. Codex는 앱 전용 홈을 사용하므로 앱에서 별도로 로그인합니다.

실행 환경과 환경변수는 [시스템 아키텍처](docs/1-SYSTEM-ARCHITECTURE.md#실행테스트), 구현·검증 결과와 남은 실제 CLI 확인은 [MVP 변경 기록](docs/changes/001-mvp.md#결과)을 참고하세요.
