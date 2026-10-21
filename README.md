# SDDMaker

Claude Code·Codex 구독 CLI로 인터뷰를 진행하고, SDD 문서와 화면 정의서를 생성·검토·승인해 `docs/` 구조의 zip으로 내보내는 로컬 앱입니다.

Docker Compose로 실행하려면:

```sh
docker compose up -d --build --wait
```

<http://127.0.0.1:3000>으로 접속합니다. 이미지에는 두 CLI가 포함되며, 호스트의 로그인과 별도로 컨테이너에서 처음 한 번 구독 로그인합니다. 상단 **에이전트 연결**에서 **간편 로그인 / 터미널** 탭을 선택합니다. 간편 로그인은 인증 페이지와 코드 입력을 제공하고, 터미널은 실제 CLI를 엽니다. 터미널 안에서 인증 URL을 열고 입력·붙여넣기·방향키·Ctrl+C를 사용할 수 있습니다. Claude 인증 코드는 같은 터미널에, Codex 기기 코드는 OpenAI 인증 페이지에 입력합니다. Codex 기기 로그인이 차단되면 ChatGPT 설정 → 보안에서 허용한 뒤 다시 연결합니다. 터미널에서 직접 인증하려면:

```sh
docker compose exec sddmaker claude auth login --claudeai
docker compose exec sddmaker codex login --device-auth
```

앱이 표시하거나 터미널에 출력된 URL은 이용 중인 브라우저에서 엽니다. 브라우저로 계정을 인증하더라도 로그인 정보는 컨테이너의 SDDMaker 전용 저장소에만 남습니다. 호스트에 두 CLI가 설치되거나 로그인되어 있을 필요가 없습니다.

이미지에는 GitHub CLI(`gh`)도 들어 있습니다. GitHub 계정은 에이전트 연결에서 앱 전용으로 로그인하며, 로그인(`gh-home`)과 저장소 클론(`repos`)은 `data` 볼륨에 저장됩니다.

DB와 두 CLI의 로그인·설정은 `data` 볼륨(`/app/data/claude-home`, `/app/data/codex-home`), 그 밖의 CLI 홈 파일은 `cli-home` 볼륨에 저장되어 컨테이너를 다시 만들어도 유지됩니다. `docker compose down`으로 중지합니다. `down -v`는 저장 데이터와 로그인을 삭제하므로 사용하지 않습니다.

다른 포트는 `SDDMAKER_PORT=3001 docker compose up -d --wait`로 지정합니다. Docker만 사용하는 방법과 CLI의 컨테이너 제약은 [컨테이너 실행 안내](docs/1-SYSTEM-ARCHITECTURE.md#dockerdocker-compose-실행)를 참고하세요.

현재 Docker Desktop 검증 환경에서는 Codex의 read-only sandbox가 namespace 권한 오류로 막힙니다. 컨테이너에서는 Claude를 사용하거나, Codex는 호스트 실행에서 사용합니다.

호스트에서 직접 실행하려면:

```sh
npm ci
npm run dev
```

브라우저에서 <http://127.0.0.1:3000>을 엽니다. Claude Code 또는 Codex CLI가 필요하며, 상단 에이전트 연결에서 로그인 상태를 확인합니다. 두 CLI 모두 앱 전용 저장소를 사용하므로 앱에서 별도로 로그인합니다. 호스트 터미널에서 직접 인증할 때의 전용 저장소 설정은 [인증 안내](docs/1-SYSTEM-ARCHITECTURE.md#외부-연동-에이전트-cli)를 참고하세요.

실행 환경과 환경변수는 [시스템 아키텍처](docs/1-SYSTEM-ARCHITECTURE.md#실행테스트), 구현·검증 결과와 남은 실제 CLI 확인은 [MVP 변경 기록](docs/changes/001-mvp.md#결과)을 참고하세요.
