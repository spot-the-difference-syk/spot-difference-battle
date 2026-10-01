# Cloudflare에서 웹·실시간 대전 실행

> 기준일: 2026-09-30. 기존 게임 서버 대신 Workers + Durable Objects를 사용하는 배포 경로.

## 구성

- 웹: game Worker의 Static Assets. 솔로는 브라우저에서 실행한다.
- 대전: `/ws`의 native WebSocket과 `GameLobby` Durable Object. 기존 `GameMatch`의 정답 판정·게임 규칙을 재사용한다.
- 경기 상태·게스트 세션: Durable Object SQLite 저장소. 응답 전에 상태를 저장하고, hibernation 뒤 복원한다.
- 이미지: 기존 R2 전달 Worker는 유지한다. `home-office`만 R2에서, 나머지 이미지는 웹 번들에서 제공한다.
- Supabase: Hyperdrive를 설정하면 기존 스키마에 종료 경기·신고를 저장한다. 설정 전에도 Durable Object만으로 대전할 수 있다. 게스트 토큰은 Durable Object에서 관리한다.

현재는 **한 개의 MVP 로비**, 최대 동시 연결 200개·활성 경기 100개를 지원한다. 각 경기의 상태와 개인 스냅샷은 분리하지만, 대규모 서비스의 경기별 분산 구조는 이번 구현 범위에 포함하지 않는다. 같은 게임 모드·난이도끼리 매칭한다.

## 최초 배포

Node.js 24 이상, 저장소의 pnpm 버전을 사용한다. 루트에서 실행한다.

```powershell
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm deploy:cloudflare
```

이 명령은 공유 패키지와 Cloudflare 웹을 빌드한 뒤 `workers/realtime/wrangler.toml`로 배포한다. 최초 배포에서 SQLite Durable Object namespace를 생성한다. CLI가 반환한 **실제 Worker URL**로 웹을 열고 `/health`를 확인한다. 공개 주소·계정 ID는 소스에 가정해서 기록하지 않는다.

웹은 같은 Worker의 `/ws`로 연결하므로 별도 대전 서버 주소가 필요 없다. `pnpm build:cloudflare`는 `VITE_GAME_TRANSPORT=cloudflare`, 빈 `VITE_SERVER_URL`로 웹을 빌드한다. 기존 `pnpm dev`·`pnpm build:ait`는 기존 Node/Socket.IO 경로를 유지한다.

## 앱인토스 번들

배포 후 위에서 얻은 주소를 사용한다.

```powershell
$env:VITE_SERVER_URL="https://<실제-game-worker-주소>"
pnpm build:ait:cloudflare
```

생성한 `apps/web/spot-difference-syk.ait`를 앱인토스 콘솔에 업로드하고 QR로 2인 대전을 검증한다. Worker 주소 없이 AIT 빌드를 요청하면 빌드 스크립트가 오류를 낸다. AIT 화면의 Origin에서 서버를 찾는 잘못된 연결을 방지하기 위해서다.

WebSocket Origin은 같은 웹 사이트와 다음 AIT 주소만 허용한다. 앱 ID나 별도 웹 주소가 달라지면 `ALLOWED_ORIGINS`를 수정해 배포한다.

- `https://spot-difference-syk.web.tossmini.com`
- `https://spot-difference-syk.private-web.tossmini.com`

## Supabase 연결

1. 기존 Supabase 마이그레이션을 적용한다. 이 Worker는 DB 스키마를 변경하지 않는다.
2. Cloudflare에서 해당 Supabase PostgreSQL에 연결하는 Hyperdrive를 생성한다. 활성 카탈로그를 즉시 읽으려면 Hyperdrive 쿼리 캐시를 비활성화한다.
3. `workers/realtime/wrangler.toml`의 `[[hyperdrive]]` 예시를 활성화하고 **실제 Hyperdrive ID**를 넣는다. 연결 비밀번호는 저장소·브라우저 환경변수에 넣지 않는다.
4. DB 퍼즐을 사용할 때만 `PUZZLE_CATALOG_SOURCE="database"`로 변경한다. Hyperdrive와 `PUZZLE_ASSET_BASE_URL`(R2 배포 Worker 주소) 없이는 이 모드로 시작할 수 없다. 처음 읽기에 실패하면 코드 카탈로그로 자동 전환하지 않는다. 그 뒤 새로 읽기에 실패하면 마지막 정상 목록을 유지한다.
5. 재배포 후 `/health`의 `database`가 `true`인지 확인한다. 기본 DO 모드에서는 `null`이다.

DB 카탈로그는 Durable Object가 5분마다 다시 읽고, 웹은 `GET /catalog`(Worker가 먼저 처리, 60초 캐시)로 활성 목록과 R2 이미지 주소를 받는다. 새 그림은 `pnpm puzzle publish … --upload --activate`로 R2와 DB에 올리면 재배포 없이 나타난다(`docs/GAME_ASSETS.md` 7절). 대결 정답은 `/catalog`에 포함되지 않는다.

### 성장 기록(레벨·코인) 백업

Hyperdrive가 연결돼 있으면 Worker가 레벨·코인·꾸미기·수집 기록을 Supabase `player_growth`에 백업한다. 별도 설정값은 없고, 아래 마이그레이션만 적용돼 있으면 된다.

- `20261001000100_player_growth.sql`, `20261002000100_player_growth_worker_backup.sql`
- 적용 전 배포해도 게임은 정상 동작한다. 백업만 실패해 로그에 `database.growth_save_failed`가 1분 간격으로 남고, 기록은 DO에 보관된 채 적용 후 자동으로 올라간다.
- 확인: `SELECT count(*), max(updated_at) FROM player_growth;`
- 운영 서버는 Cloudflare Worker이고, `apps/server`(Node)는 로컬 개발·자동 테스트 전용이다.

종료 경기는 먼저 Durable Object에 저장한다. Supabase 저장이 실패하면 기록을 유지하고 alarm에서 재시도한다. Supabase 저장이 끝나야 활성 기록을 정리한다. 신고는 종료 경기의 저장을 먼저 완료한 뒤 DB에 등록한다. DB 장애 시 신고 오류를 표시해 사용자가 재시도할 수 있다.

## 복구와 보관

- 정상 WebSocket은 hibernation을 통해 유지한다. 세션은 URL 쿼리 대신 첫 인증 메시지로 전달한다.
- 연결이 끊기면 10초 재접속 유예를 적용한다. 같은 토큰의 새 연결은 기존 연결을 종료한다.
- countdown·준비·로딩·경기 마감은 Durable Object alarm으로 처리한다. countdown alarm이 늦게 실행돼도 원래 시작 시각을 기준으로 경기 마감을 계산한다.
- 종료 경기는 5분 동안 다시 조회·신고할 수 있고, 이후 DO `history:` 키에 보관한다. 두 참가자가 새 매칭을 시작하면 이전 경기의 실시간 조회는 종료한다.
- 게스트 세션은 연결·경기가 없는 상태로 7일이 지나면 정리한다. 경기 기록·신고의 장기 보관 정책은 별도로 정해야 한다.
- 기존 Node 서버의 진행 중 경기·토큰은 자동 이전하지 않는다. 이전 경기가 없는 시점에 전환한다.

## 로컬 확인

```powershell
pnpm build:packages
pnpm build:cloudflare
pnpm --filter @spot-battle/realtime dev
```

로컬 실행과 `e2e:cloudflare`는 Hyperdrive 바인딩이 없는 `workers/realtime/wrangler.local.toml`을 사용한다. `wrangler dev`는 로컬 Postgres 연결 문자열 없이 Hyperdrive 바인딩을 거부하기 때문이다. `wrangler.toml`을 바꾸면 이 파일도 함께 맞춘다.

`http://localhost:8787`을 서로 다른 두 브라우저 프로필에서 연다. 동일한 localStorage 토큰을 공유하는 두 탭은 동일 사용자라 두 플레이어로 매칭되지 않는다.

자동 검사:

```powershell
pnpm check
pnpm test
pnpm e2e:cloudflare
pnpm --filter @spot-battle/realtime build
```

`e2e:cloudflare`는 기존 UI E2E를 실제 local workerd·native WebSocket으로 실행한다. 테스트에서는 외부 R2 네트워크 변수를 비워 번들 이미지로 검증한다. 실제 토스 WebView·실제 R2·원격 Supabase의 연결 검증은 별도로 수행한다.

브라우저 없이 로컬 런타임의 2인 통신을 검사하려면 위 local Worker 실행 상태에서 다음을 실행한다.

```powershell
pnpm --filter @spot-battle/server build
node workers/realtime/test/runtime.mjs
```

되돌릴 때는 직전 정상 Cloudflare 배포 버전을 선택하고 이에 맞는 웹·AIT 번들을 사용한다. Durable Object에 저장된 진행 경기와 스키마 호환성을 함께 확인한다.

공식 참고: [Durable Objects WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Hyperdrive node-postgres](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/).
