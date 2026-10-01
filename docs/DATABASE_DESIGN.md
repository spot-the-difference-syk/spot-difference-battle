# 게임 데이터베이스 설계

> 문서 상태: CURRENT  
> 기준일: 2026-10-01

## 목표

Supabase 프로젝트 `usigggufvapufvbyugbr`의 PostgreSQL 한 곳에서 결과 조회, 신고 검토, 그림 목록과 성장 기록 백업을 관리한다. 운영 Worker는 Hyperdrive로 연결한다.
조회가 잦은 결과 값만 일반 열로 두고, 버전이 자주 바뀌는 경기 내부 상태와 퍼즐 정답은
JSONB 스냅샷으로 보존한다. 솔로 최고 기록은 기기 로컬에만 저장하고, 솔로 보상·수집은 `player_growth`에 반영된다.

| 테이블 | 운영 Worker | 로컬 Node 개발 서버 |
|---|---|---|
| `guest_sessions`, `active_matches` | 쓰지 않음(Durable Object에 보관) | 사용 |
| `matches`, `match_players`, `reports` | 사용 | 사용 |
| `puzzle_catalog` | database 모드에서 읽음 | database 모드에서 읽음 |
| `player_growth` | 성장 기록 백업·복원 | 사용 |

## 테이블

### `guest_sessions`

로그인 도입 전 게스트의 재접속 식별자와 닉네임을 저장한다. 오래 활동하지 않은 행은
`updated_at` 기준으로 정리한다. 계정 기능을 추가할 때 이 테이블을 프로필 테이블로
확장하지 않고 `user_profiles`를 별도로 추가한다.

### `active_matches`

진행 중인 경기 하나를 JSONB `state` 한 개로 저장한다. 서버 재시작 복구 전용이므로
경기가 끝나면 즉시 삭제한다. 내부 상태 버전이 바뀌어도 테이블 열을 계속 추가하지 않는다.

### `matches`

완료·취소된 경기의 공통 결과다.

- 모드, 난이도, 제한시간
- 승자와 종료 사유
- 전체 문제/정답 수
- 경기에서 실제 사용한 `puzzle_manifest`
- 장애 조사용 최종 `final_state`

생존전의 `MISTAKE_LIMIT`도 유효한 종료 사유로 저장한다. `puzzle_manifest`와
`final_state`는 경기 당시 버전의 불변 감사 자료이며, 카탈로그가 바뀌어도 수정하지 않는다.

### `match_players`

경기 참가자별 결과를 두 행으로 저장한다. 승/패/무/취소, 점수, 시간 보너스, 완료 문제 수,
전체 발견 수, 오답, 최고 콤보와 문제별 발견 ID를 가진다. 랭킹이나 개인 전적이 필요해지면
이 테이블을 기준으로 조회한다.

### `reports`

종료된 경기 신고를 플레이어당 한 번 저장한다. 자동 제재는 하지 않고 `status`만 운영자가
변경한다. 신고 당시 퍼즐과 최종 상태는 `matches`에서 확인한다.

### `puzzle_catalog`

퍼즐 ID와 에셋 버전을 복합 키로 사용한다. 원본·변경본의 Cloudflare R2 object key, 검수된
정답 영역 JSON, 난이도와 라이선스 메타데이터를 보존한다. 같은 퍼즐 ID에서는 한 버전만
활성화할 수 있다.

`metadata`에는 `{mode: "battle"|"solo", genre, alt, original_sha256, modified_sha256}`를 둔다. 행은 그림 등록 도구(`pnpm puzzle`)로 넣고, 노출 전환은 `activate_puzzle_version` 함수와 전체 목록 재검증으로 한다. 서버는 활성 행을 5분마다 다시 읽는다. 경기 결과는 계속 `puzzle_manifest`에 사본을 남긴다.

### `player_growth`

플레이어의 레벨·경험치·코인·꾸미기·전적·수집·오늘의 목표를 `growth` JSONB 한 덩어리로
저장한다. 운영(Cloudflare Worker)에서는 Durable Object가 원본을 들고, 바뀐 기록을 약 10초
안에 모아 이 테이블에 upsert한다(DB 장애 시 1분 간격 재시도, 백업 전 기록은 만료·정리하지 않음).

- `player_id`: 게임 내부 플레이어 ID. Worker는 `guest_sessions`를 쓰지 않으므로 외래키가 없다.
- `token_hash`: 기기 게스트 토큰의 SHA-256. 토큰 원문은 저장하지 않는다. 세션이 DO에서 정리된
  뒤 같은 기기로 다시 접속하면 이 해시로 기록을 되찾는다. DB 조회가 실패하면 새 토큰을 발급하지
  않고 잠시 뒤 재시도하게 해서 기존 기록과 끊기지 않게 한다.
- 보상 계산은 항상 게임 서버가 한다. 이 테이블은 브라우저나 Supabase API에 노출하지 않는다.
- 토스 로그인을 붙이면 계정 ID와 이 행을 연결한다(`docs/IMPLEMENTATION_BACKLOG.md`).

## 관계

```text
guest_sessions     active_matches
      │                   │
      └──── 경기 진행 ────┘
                │ 종료
                ▼
             matches ─────< match_players
                │
                └─────────< reports

puzzle_catalog ──(버전 선택)──> matches.puzzle_manifest 사본

player_growth (player_id, token_hash) — 게스트 토큰 해시로 성장 기록 복원
```

## 유지보수 원칙

- 실시간 진행 중 상태는 `active_matches.state`에서만 관리한다.
- 종료 후 검색할 값만 `matches`와 `match_players`의 일반 열로 저장한다.
- 과거 경기의 퍼즐·정답·최종 상태 스냅샷은 수정하지 않는다.
- 브라우저에는 DB 연결 문자열이나 service role 키를 제공하지 않는다.
- Supabase에는 R2 credential을 저장하지 않고 object key와 검증 메타데이터만 저장한다.
- 서버 전용 테이블에 대한 Supabase `anon`, `authenticated` 권한은 부여하지 않는다.
- 새 열은 먼저 nullable 또는 안전한 기본값으로 추가한 뒤 코드 배포 후 제약을 강화한다.
- Supabase CLI의 원격 마이그레이션 이력을 기준으로 아직 적용하지 않은 SQL만 배포한다.
- 적용 완료한 마이그레이션 파일은 수정하지 않고 새 번호의 파일을 추가한다.

스키마는 `supabase/migrations`에서만 관리하며 `pnpm db:push`로 연결된 프로젝트에 적용한다.
앱 서버가 시작할 때 스키마를 변경하지 않는다.
