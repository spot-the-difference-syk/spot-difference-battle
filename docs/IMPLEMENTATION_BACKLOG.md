# 구현 백로그

> 문서 상태: CURRENT
> 기준일: 2026-10-02
> 체크는 구현과 자동 검증이 모두 있을 때만 사용한다. 완료된 과거 항목은 `MVP_DECISIONS.md` 변경 이력과 `history/`에 남긴다.

## 지금까지 완료

- [x] 동시 빨리찾기 대결(사전 로드·카운트다운·독립 진행·전체 완료 즉시 승리·점수제), 모드·난이도
- [x] 솔로 타임어택, 서버 판정과 그림별 주간·전체 랭킹(주간 보상 코인·칭호)
- [x] Cloudflare Worker + Durable Object 운영, Supabase 경기·신고 저장
- [x] 갤러리 UI(웹·앱인토스·Android·iOS 공용), 포인터 세트와 누름 반응
- [x] 레벨·코인·꾸미기·수집·전적·오늘의 목표, 성장 기록 Supabase 백업
- [x] R2 + 그림 목록(DB)으로 재배포 없이 그림 추가, 그림 등록 도구(`pnpm puzzle`)
- [x] 구형 제작자/찾는 사람·편집기·제출·힌트 코드 제거

## 그림 콘텐츠

- [ ] 기존 그림 15점을 R2·DB에 올리고 Worker를 `PUZZLE_CATALOG_SOURCE="database"`로 전환(`GAME_ASSETS.md` 7절)
- [ ] `PUZZLE_ASSET_BASE_URL`을 운영용 R2 전달 Worker 주소로 확정(현재 canary 주소)
- [ ] 초기 서비스용 대결 그림 20~30점 이상, 화풍별 고르게
- [ ] 모바일 식별성과 화풍·크롭 일치 육안 검수, 난이도 표기

## 운영과 품질

- [ ] Supabase에 `20261001000100_player_growth.sql`, `20261002000100_player_growth_worker_backup.sql` 적용 확인
- [ ] 그림별 풀이 시간·오답률·신고율 지표
- [ ] 신고 검토 화면과 정확한 그림 버전 재현
- [ ] 실제 PostgreSQL 환경에서 재시작 복구 테스트 실행. `postgres-restart.integration.test.ts`는 예전 경기 저장 형식(schemaVersion 2)을 기대하므로 갱신이 필요하다.
- [ ] 접근성·색각·저사양 모바일·느린 네트워크 검증
- [ ] 솔로 랭킹: 순위표 Supabase 백업, 의심 기록(입력 간격·좌표 패턴) 검토와 순위 제외 도구
- [ ] 결과 화면 그림별 정답 보기, 재접속 남은 시간 표시

## 모바일 앱

- [x] Android·iOS 앱이 운영 Worker에 연결(`pnpm build:android`, `pnpm build:ios`), Worker에 앱 Origin 허용
- [x] iOS 앱(Capacitor) 생성, 앱 아이콘·이름, Android 15 시스템 바 처리, CI 빌드
- [ ] 실기기에서 매칭·그림 로딩·결과 흐름 확인(운영 Worker 주소 `scripts/production.config.json` 확인 포함)
- [ ] Android release 서명·AAB·스토어 등록, iOS 서명·App Store 심사(`MOBILE_APPS.md`)

## 앱인토스 출시 전 — 계정과 상품화

> 토스(앱인토스) 출시 작업을 시작할 때 이 항목부터 다시 확인한다. 2026-10-01 추가.

- [ ] 토스 로그인 연동: 레벨·코인·꾸미기·수집 기록은 Supabase `player_growth`에 백업되지만, 찾는 열쇠가 기기 로컬 저장소의 게스트 토큰이라 앱 데이터를 지우거나 기기를 바꾸면 찾을 수 없다. 토스 계정과 `player_growth` 행을 연결하고, 기존 게스트 기록을 첫 로그인 계정으로 옮기는 흐름을 만든다.
- [ ] 계정 연동 후 게스트 기록 보존 기간(현재 성장 기록이 있으면 180일) 재검토
- [ ] 유료 결제(코인·아이템 판매)를 하려면 토스 결제 연동과 정책 검토

## 보류

- [ ] 재대전, 즉시 새 매칭, 랭킹, 시즌
- [ ] 친구 대전, 관전, 리플레이
- [ ] 사용자 이미지 업로드
