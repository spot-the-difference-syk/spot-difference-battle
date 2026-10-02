# 기술 설계

> 문서 상태: CURRENT
> 기준일: 2026-10-02
> 게임 규칙은 `GAME_RULES.md`를 따른다.

## 운영 구조

| 구성 | 기술 | 역할 |
|---|---|---|
| 게임 Worker | Cloudflare Workers + Durable Object(`GameLobby`, SQLite 저장소) | 웹 정적 파일, `/ws` 실시간 대결, `/catalog`, `/health`, 게스트 세션·성장 기록 |
| 이미지 | R2 + 전달 Worker | `puzzles/{id}/{version}/runtime/{original\|modified}.webp` 제공 |
| DB | Supabase PostgreSQL(Hyperdrive) | 그림 목록·정답, 종료 경기, 신고, 성장 기록 백업 |
| 웹 | React 18 + Vite + Tailwind v4 | 화면, 좌표 변환, 이미지 사전 로드. 웹·앱인토스·Android·iOS 공용 |
| 모바일 앱 | Android WebView 래퍼, iOS Capacitor | 웹 번들을 앱 안에 넣어 실행(`MOBILE_APPS.md`) |
| 공유 | `packages/shared` | 수치·타입·통신 계약·성장/꾸미기 규칙·카탈로그 타입 |
| 게임 코어 | `packages/game-core` | 플레이어별 진행, 입력 잠금, 마감, 결과 판정 |
| 개발 서버 | `apps/server`(Fastify + Socket.IO) | 로컬 개발·자동 테스트 전용. Worker와 카탈로그·저장소 코드를 공유한다 |

Worker는 `apps/server`의 `CatalogService`, `parseCatalog`, `SupabasePostgresMatchStore`를 그대로 가져다 쓴다. 두 서버의 게임 판정은 `GameMatch` 하나다.

## 그림 카탈로그

- `PUZZLE_CATALOG_SOURCE="code"`(기본): 앱 번들에 들어 있는 그림 15점(대결 10, 솔로 5)을 쓴다.
- `"database"`: `puzzle_catalog`의 활성 행을 읽어 검증하고 5분마다 다시 읽는다. 다시 읽기에 실패하면 마지막 정상 목록을 유지한다. 이미지 주소는 `PUZZLE_ASSET_BASE_URL` + object key로 만든다.
- 그림 ID와 버전은 형식(`PUZZLE_ID_PATTERN`, `YYYY-MM-DD.N`)만 검사하므로 새 그림은 코드 수정 없이 추가된다. 대결 그림은 `GameMatch` 규칙으로, 솔로 그림은 차이 5개로 검증한다.
- 경기마다 화풍 하나를 무작위로 정하고(3점 미만 화풍 제외) 그 화풍 그림 중 최대 10점을 무작위로 뽑는다(`CatalogService.pickDeck`). 웹은 `match:found`의 `deck` 카드 화풍으로 이번 화풍을 보여준다.
- 대결 설정은 모드뿐이다(`MatchSettings`). 예전 앱이 보내는 `difficulty`나 저장된 예전 경기의 난이도는 `matchSettingsFrom`이 버린다. `matches.difficulty` 열에는 `NORMAL`을 넣는다.
- `GET /catalog`는 공개 카드(제목·화풍·설명·이미지 주소)를 준다. **정답은 대결·솔로 모두 포함하지 않는다.** `match:found`에는 이번 경기 그림 카드(`deck`)가 들어 있다.
- 웹은 `/catalog`를 10분마다 읽고, 실패하면 번들 그림으로 진행한다.
- 등록은 `pnpm puzzle`(`scripts/puzzle-publish.mjs`)로 한다. 절차는 `GAME_ASSETS.md`를 본다.

## 경기 계약

1. 매칭 시 서버가 두 플레이어와 그림 순서·버전을 확정한다.
2. 양쪽이 첫 그림 ID와 에셋 버전을 포함해 로드 완료를 알리고, 서버가 확정 버전과 일치할 때만 승인한다.
3. 서버가 공통 시작·마감 시각을 배포한다. 스냅샷의 `serverNowMs`로 기기 시계 오차를 보정한다.
4. 위치 선택에는 경기 ID, 상태 버전, 그림 ID와 정규화 좌표가 포함된다.
5. 서버가 정답·중복·오답·입력 잠금과 그림 완료를 판정한다.
6. 그림 완료 시 해당 플레이어의 다음 그림과 진행을 내려준다.
7. 종료 시 서버가 같은 결과 스냅샷을 양쪽에 보내고, 보상을 정산해 `player:growth`로 보낸다.

활성 경기에는 그림 순서·버전, 시작·마감 시각, 플레이어별 발견 ID·오답·잠금 시각·연결 상태를 저장한다. 종료 경기는 `matches.puzzle_manifest`에 그림 순서·버전·정답 영역 사본을 남긴다.

## 성장 기록

- 규칙: `PROGRESSION_RULES`, `COSMETIC_ITEMS`, `DAILY_GOALS`(공유 패키지). 정산은 `settleMatch`, `grantSoloReward`, `grantRankingReward`, `buyCosmetic`, `equipCosmetic`.
- 이벤트: `player:growth`(접속 직후·보상·구매 때), `shop:buy`, `shop:equip`.
- 저장: Durable Object 세션이 원본이다. 바뀐 기록은 약 10초 안에 Supabase `player_growth`로 일괄 upsert하고, 실패하면 1분 뒤 다시 시도한다. 백업 전 기록은 만료·정리하지 않는다.
- 복원: DO에서 정리된 플레이어가 같은 게스트 토큰으로 접속하면 토큰 SHA-256(`token_hash`)으로 찾아 복원한다. 조회가 실패하면 새 토큰을 발급하지 않고 잠시 뒤 다시 시도하게 한다.

## 솔로 판정과 랭킹

- 판정 규칙은 공유 패키지 `solo.ts`(`startSoloRun`, `guessSoloRun`), 순위 규칙은 `leaderboard.ts`(`submitRecord`, `rankingPayload`, `weeklyRewards`)다. 두 서버는 `apps/server/src/game/solo-league.ts`의 `SoloLeague`를 함께 쓴다.
- 솔로 정답은 서버에만 있다. 번들 정답은 `apps/server/src/game/solo-puzzles.ts`, DB 그림은 `puzzle_catalog` 행이다. `/catalog`와 웹 번들에는 솔로 정답도 넣지 않는다.
- 이벤트: `solo:start {puzzleId, nickname}` → `solo:started {runId, startsAtMs, serverNowMs}`, `solo:guess {runId, point, pointerType, boardSizePx}` → `solo:guess-result`(다 찾으면 `finished`에 기록·개인 최고·주간/전체 순위), `ranking:get {puzzleId, period}` → `ranking:list`.
- 진행 중인 판은 세션(`soloRun`)에 저장하므로 재접속해도 이어진다. 판 ID가 다르거나 그림 버전이 바뀌면 거절한다.
- 운영 Worker는 순위표를 Durable Object 저장소의 `league:board:<그림 ID>|all`, `league:board:<그림 ID>|w:<주 월요일>`에, 정산 상태와 미수령 보상을 `league:meta`에 둔다. 끝난 주간 순위표는 정산하면서 지운다. Node 개발 서버는 메모리에만 둔다.
- 순위표 응답에는 플레이어 ID를 넣지 않는다.

## 이미지 로드

- 첫 그림 로드 완료 전에는 경기 시간을 시작하지 않는다.
- 현재 그림을 푸는 동안 다음 그림의 두 이미지를 미리 불러온다(`preloadVisual`).
- 카운트다운 전에는 그림을 가린다.
- 원본·수정본에 같은 1~3배 배율과 정규화 이동량을 적용한다. 포인터 이동이 6px을 넘으면 드래그로 보고 정답 요청을 보내지 않는다. 선택 좌표는 변환된 이미지 경계 기준으로 0~1 정규화한다.

## 보안과 동시성

- 대결 정답 영역은 서버 전용이다. 상대의 발견 위치는 결과 전 전송하지 않는다.
- 상태·그림·버전이 다른 입력은 거절하고, 동일 정답 중복과 입력 잠금 중 요청은 무시한다.
- 마감과 순서는 서버 수신 시각으로 판정하고, 선택 요청에 속도 제한(120ms)을 둔다.
- 보상·코인·솔로 기록은 클라이언트 값을 믿지 않는다. 솔로 시간은 서버가 재고, 3초보다 빠른 솔로 완주는 보상·랭킹에서 뺀다.
- WebSocket·`/catalog`는 허용된 Origin(같은 사이트, 앱인토스·Android·iOS 앱 주소)에만 연다.
- DB 연결 문자열·R2 키는 저장소와 브라우저에 넣지 않는다.

## 빌드 경로

| 명령 | 연결 대상 | 용도 |
|---|---|---|
| `pnpm build:cloudflare` | 같은 Worker의 `/ws` | 운영 웹(자동 배포) |
| `pnpm build:ait:cloudflare` | 운영 Worker | 토스에 올리는 앱인토스 번들 |
| `pnpm build:android`, `pnpm build:ios` | 운영 Worker | Android·iOS 앱 |
| `pnpm build:ait` | Socket.IO(Node 서버) | 로컬 개발·CI 빌드 확인용 |

앱·앱인토스 번들의 운영 Worker 주소는 `scripts/production.config.json` 한 곳에서 관리한다(`VITE_SERVER_URL`로 덮어쓸 수 있음). 앱 Origin(`https://appassets.androidplatform.net`, `capacitor://localhost`)은 Worker `ALLOWED_ORIGINS`에 있다.

## DB 변경

DB 변경은 `supabase/migrations`에서만 관리하고 Supabase CLI로 적용한다(`pnpm db:push`). 테이블 설명은 `DATABASE_DESIGN.md`를 본다.
