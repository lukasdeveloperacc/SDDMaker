# SDDMaker

이 문서는 루트 바로 아래 항목의 역할만 간결하게 유지한다. 상세 설명과 규칙은 각 디렉터리의 `AGENTS.md`에서 관리한다.

- `README.md`: 프로젝트 소개.
- `docs/`: 제품·설계·요구사항·변경 문서.
- `.gitignore`: Git 추적 제외 설정.
- `Dockerfile`·`.dockerignore`·`compose.yaml`: 컨테이너 이미지와 로컬 실행·볼륨 설정.
- `package.json`·`package-lock.json`: 의존성과 스크립트.
- `tsconfig.json`·`next.config.ts`·`next-env.d.ts`: TypeScript와 Next 설정.
- `eslint.config.mjs`: 린트 설정.
- `vitest.config.ts`: 테스트 설정.
- `src/`: 앱 코드. `app/` 화면·API, `server/` 서버 모듈, `lib/` 공용·브라우저 로직, `components/` UI.
- `test/`: vitest 테스트와 가짜 CLI.
