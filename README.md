# Spot Difference Battle

> 문서 상태: CURRENT
> 현재 게임 규칙의 유일한 Markdown 정본은 [`docs/GAME_RULES.md`](docs/GAME_RULES.md)다.

두 플레이어가 제한시간 동안 겨루는 실시간 1대1 경쟁전과, 혼자 어려운 차이점 5개를 찾아 개인 최고기록을 줄이는 솔로 타임어택을 제공합니다.

## 다음 게임 방식

1. 두 플레이어가 매칭·준비한다.
2. 서버가 양쪽에 동일한 문제 순서를 배정한다.
3. 이미지 로드 후 3초 카운트다운으로 동시에 시작한다.
4. 변경본에서 차이 3개를 찾는다.
5. 모두 찾은 플레이어는 상대를 기다리지 않고 다음 이미지로 이동한다.
6. 전체 문제를 먼저 완료한 플레이어가 즉시 승리한다.
7. 제한시간이 끝나면 총점(찾은 차이 1개당 10점), 오답이 적은 순서로 판정하고 모두 같으면 무승부다. 생존전은 오답 3회에 즉시 패배한다.
8. 경쟁전 힌트와 문제별 선착 보너스는 없다.
9. 오답 입력 잠금은 난이도에 따라 0.5~2초이며 재접속 유예는 10초다.

현재 웹·서버는 이 규칙의 동시 대전 흐름을 구현한다.

솔로 타임어택은 신규 전용 퍼즐 5세트를 사용한다. 이미지 로드 후 3초 카운트다운하며, 오답마다 기록에 3초가 추가되고 퍼즐별 최고기록은 현재 기기에 저장된다.

## 에셋 상태

- 카페·숲·바다·도시·겨울: 원본·변경본과 수동 정답 3곳 등록 완료, 플레이 난이도 검수 필요
- 연구실: 유효한 변경본 필요
- 거실: 라이선스 미확인으로 출시 제외

내부 기능 검증에는 5세트 이상, 3분 경기에는 반복되지 않는 10세트 이상, 초기 반복 서비스에는 20~30세트를 목표로 한다.

## 프로젝트 구성

- `apps/web/`: React 웹 앱과 배포용 퍼즐 이미지
- `apps/server/`: Fastify·Socket.IO 서버와 PostgreSQL 저장소
- `packages/shared/`: 웹·서버 공유 규칙, 타입, Socket.IO 계약
- `packages/game-core/`: 프레임워크와 분리된 서버 권한 판정
- `tests/e2e/`: 웹·서버 전체를 검증하는 Playwright 브라우저 E2E 테스트
- `docs/`: 현재 명세, 설계 자료, 과거 변경 기록

활성 웹 진입점은 `apps/web/src/main.tsx`이며 `App`을 렌더한다. 전체 디렉터리 책임과 의존 방향은 [저장소 구조](docs/REPOSITORY_STRUCTURE.md)를 따른다.

## 주요 문서

- [문서 운영 기준](docs/DOCUMENTATION.md)
- [게임 규칙](docs/GAME_RULES.md)
- [게임 모드와 난이도](docs/GAME_MODES.md)
- [MVP 결정 기록](docs/MVP_DECISIONS.md)
- [게임 상태](docs/GAME_STATE.md)
- [게임 기획](docs/GAME_DESIGN.md)
- [사용자 흐름](docs/USER_FLOW.md)
- [화면 명세](docs/SCREEN_SPEC.md)
- [기술 설계](docs/TECH_SPEC.md)
- [테스트 계획](docs/TEST_PLAN.md)
- [테스트 구조](docs/TEST_STRUCTURE.md)
- [구현 백로그](docs/IMPLEMENTATION_BACKLOG.md)
- [UI 현황 점검](docs/UI_AUDIT.md)
- [문제 에셋 가이드](docs/GAME_ASSETS.md)
- [컨테이너 배포 가이드](docs/DEPLOYMENT.md)
- [Cloudflare 웹·실시간 대전 배포](docs/CLOUDFLARE_DEPLOYMENT.md)
- [저장소 구조](docs/REPOSITORY_STRUCTURE.md)
- [솔로 퍼즐 생성 기록](docs/design/SOLO_ASSET_PROVENANCE.md)

`docs/history/`의 날짜별 변경 문서와 과거 릴리스는 당시 구현의 역사 기록이다.

## 로컬 실행

필요 항목은 Apps in Toss SDK 3.1.1과 AIT Devtools 3.1.1이 요구하는 Node.js 24 이상 및 pnpm 11.9.0이며, PostgreSQL을 쓸 때만 Docker Desktop이 필요하다.

```powershell
pnpm setup
pnpm dev
```

- 웹: `http://localhost:5173`
- 서버 상태: `http://localhost:3001/health`

### 같은 Wi-Fi 휴대폰 테스트

1. PC와 휴대폰을 같은 Wi-Fi에 연결한다.
2. PC PowerShell에서 `ipconfig`로 Wi-Fi 어댑터의 IPv4 주소를 확인한다.
3. 저장소 루트에서 `pnpm dev`를 실행한다.
4. 휴대폰에서 `http://<PC의 IPv4 주소>:5173`으로 접속한다.

개발 웹은 접속한 PC 호스트의 `3001` 포트로 API를 자동 연결한다. Windows 방화벽 알림이 나오면 개인 네트워크만 허용한다. 이 기능은 같은 사설망의 개발 테스트용이며 인터넷에 직접 공개하는 용도가 아니다.

### Apps in Toss SDK 3.1.1 테스트

SDK 3.x의 로컬 기능 검증은 샌드박스 앱이나 Metro가 아니라 `pnpm dev`로 실행한 브라우저의 AIT Devtools를 사용한다. 실제 토스 환경은 `pnpm build:ait`로 `.ait` 번들을 만든 뒤 앱인토스 콘솔에 업로드하고 QR 코드로 테스트한다.

서버의 프로덕션 CORS는 SDK 3.x의 실서비스 및 QR 테스트 Origin인 `https://spot-difference-syk.web.tossmini.com`과 `https://spot-difference-syk.private-web.tossmini.com`을 허용한다.

검사:

```powershell
pnpm check
pnpm test
pnpm build
```

자동 테스트는 동시 사전 로드·카운트다운·독립 정답 판정·제한시간 승패 우선순위를 검증한다. PostgreSQL 없이 실행하면 메모리 저장소를 사용한다. PostgreSQL·환경변수·컨테이너 실행은 `.env.example`과 `docs/DEPLOYMENT.md`를 참고한다.
