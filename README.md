# Spot Difference Battle — 틀린그림 갤러리

> 문서 상태: CURRENT
> 기준일: 2026-10-01
> 게임 규칙의 유일한 Markdown 정본은 [`docs/GAME_RULES.md`](docs/GAME_RULES.md)다.

같은 그림 두 장에서 다른 곳을 찾는 게임이다. 웹·앱인토스·Android·iOS로 제공한다.

- **1대1 대결**: 두 사람이 같은 순서의 그림 10점을 동시에 푼다. 그림마다 차이 3개를 찾으면 각자 다음 그림으로 넘어가고, 전체를 먼저 끝낸 사람이 즉시 이긴다. 시간이 끝나면 점수·오답 순으로 판정한다.
- **혼자하기(솔로 타임어택)**: 어려운 차이 5개를 찾는 시간을 줄인다. 퍼즐별 최고 기록은 기기에 저장한다.
- **성장**: 대결·솔로 보상으로 레벨·코인을 얻고, 코인으로 꾸미기 아이템을 산다. 끝까지 푼 그림은 "내 갤러리"에 수집되고 오늘의 목표가 있다. 보상은 항상 서버가 계산한다.

## 운영 구조

| 구성 | 역할 |
|---|---|
| Cloudflare Worker + Durable Object (`workers/realtime`) | **운영 서버.** 웹 정적 파일, 실시간 대결(`/ws`), 그림 목록(`/catalog`), 성장 기록 |
| R2 + 전달 Worker (`workers/r2-delivery`) | 그림 이미지 저장·제공 |
| Supabase (Hyperdrive로 연결) | 그림 목록·정답(`puzzle_catalog`), 경기 기록, 신고, 성장 기록 백업 |
| Node 서버 (`apps/server`) | **로컬 개발·자동 테스트 전용.** 운영에 배포하지 않는다 |

main에 머지하면 Cloudflare가 자동으로 다시 배포한다. 자세한 내용은 [Cloudflare 배포](docs/CLOUDFLARE_DEPLOYMENT.md)를 본다.

## 저장소 구성

- `apps/web/`: React·Vite 웹 앱(앱인토스·Android 공용), 앱에 들어 있는 기본 그림
- `apps/server/`: 로컬 개발용 Fastify·Socket.IO 서버, Worker와 공유하는 카탈로그·저장소 코드
- `apps/android/`: Android WebView 래퍼
- `apps/ios/`: iOS 앱(Capacitor)
- `workers/realtime/`: 운영 게임 Worker
- `workers/r2-delivery/`: R2 이미지 전달 Worker
- `packages/shared/`: 공유 규칙·타입·통신 계약·성장/꾸미기 규칙
- `packages/game-core/`: 프레임워크와 분리된 대결 판정
- `supabase/migrations/`: DB 스키마
- `scripts/`: 빌드·그림 등록(`pnpm puzzle`)·구조 검사
- `tests/e2e/`: Playwright 브라우저 테스트
- `docs/`: 명세·설계·운영 문서, `docs/history/`는 과거 기록

디렉터리 책임과 의존 방향은 [저장소 구조](docs/REPOSITORY_STRUCTURE.md)를 따른다.

## 주요 문서

- 규칙·기획: [게임 규칙](docs/GAME_RULES.md) · [게임 모드](docs/GAME_MODES.md) · [게임 기획](docs/GAME_DESIGN.md) · [결정 기록](docs/MVP_DECISIONS.md)
- 화면·흐름: [사용자 흐름](docs/USER_FLOW.md) · [화면 명세](docs/SCREEN_SPEC.md) · [UI 구현 기준](docs/design/UI_GUIDELINES.md)
- 기술: [기술 설계](docs/TECH_SPEC.md) · [게임 상태](docs/GAME_STATE.md) · [DB 설계](docs/DATABASE_DESIGN.md)
- 운영: [Cloudflare 배포](docs/CLOUDFLARE_DEPLOYMENT.md) · [그림 에셋·등록](docs/GAME_ASSETS.md) · [모바일 앱(Android·iOS)](docs/MOBILE_APPS.md) · [Android 빌드 환경](docs/android-build-environment.md)
- 품질: [테스트 계획](docs/TEST_PLAN.md) · [테스트 구조](docs/TEST_STRUCTURE.md) · [구현 백로그](docs/IMPLEMENTATION_BACKLOG.md)
- 문서 운영: [문서 운영 기준](docs/DOCUMENTATION.md)

## 로컬 실행

Node.js 24 이상과 pnpm 11.9.0이 필요하다. PostgreSQL은 DB 테스트를 돌릴 때만 필요하다(`docker compose up postgres`).

```powershell
pnpm setup
pnpm dev
```

- 웹: `http://localhost:5173`
- 개발 서버 상태: `http://localhost:3001/health`

PostgreSQL 없이 실행하면 메모리 저장소를 쓴다. 개발 서버 환경변수는 `.env.example`을 본다.

### 같은 Wi-Fi 휴대폰 테스트

1. PC와 휴대폰을 같은 Wi-Fi에 연결한다.
2. PC에서 `ipconfig`로 Wi-Fi IPv4 주소를 확인한다.
3. `pnpm dev`를 실행하고 휴대폰에서 `http://<PC IPv4>:5173`으로 접속한다.

개발 웹은 접속한 PC의 `3001` 포트 서버에 자동 연결한다. 같은 사설망 테스트용이며 인터넷에 공개하지 않는다.

### 앱인토스 테스트

SDK 3.x 기능은 `pnpm dev`로 띄운 브라우저의 AIT Devtools로 확인한다. 실제 토스 환경용 번들은 운영 Worker에 연결되게 만든다. 서버 주소는 `scripts/production.config.json`에서 읽는다(`VITE_SERVER_URL`로 바꿀 수 있음).

```powershell
pnpm build:ait:cloudflare
```

### 모바일 앱

```powershell
pnpm build:android   # Android 앱에 웹 번들 넣기 → apps/android 에서 ./gradlew :app:assembleDebug
pnpm build:ios       # iOS 앱에 웹 번들 넣기 → Mac의 Xcode에서 실행·배포
```

자세한 내용은 [모바일 앱](docs/MOBILE_APPS.md)을 본다.

> `pnpm build:ait`(Cloudflare 없이)는 로컬 Node 서버(Socket.IO)에 연결하는 번들을 만든다. 토스에 올리는 번들은 `build:ait:cloudflare`를 쓴다.

## 검사

```powershell
pnpm check   # 구조·타입 검사
pnpm test    # 단위·통합 테스트(그림 등록 도구 포함)
pnpm e2e     # 브라우저 테스트(Node 개발 서버)
pnpm e2e:cloudflare   # 브라우저 테스트(로컬 Worker)
```
