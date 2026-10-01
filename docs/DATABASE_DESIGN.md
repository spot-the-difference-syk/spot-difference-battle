# 게임 데이터베이스 설계

> 문서 상태: CURRENT  
> 기준일: 2026-09-13

## 목표

Supabase 프로젝트 `usigggufvapufvbyugbr`의 PostgreSQL 한 곳에서 경쟁전 복구, 결과 조회, 신고 검토와 퍼즐 교체를 관리한다.
조회가 잦은 결과 값만 일반 열로 두고, 버전이 자주 바뀌는 경기 내부 상태와 퍼즐 정답은
JSONB 스냅샷으로 보존한다. 솔로 타임어택은 현재 규칙대로 기기 로컬 저장만 사용한다.

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

현재 서버의 코드 카탈로그를 바로 제거하지는 않는다. 운영 퍼즐을 DB로 옮길 때 데이터를
이 테이블에 입력하고 저장소 구현만 교체한다. 경기 결과는 계속 `puzzle_manifest`에 사본을
남긴다.

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
