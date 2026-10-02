# 문서 운영 기준

> 문서 상태: CURRENT
> 기준일: 2026-10-02

## 단일 규칙 정본

게임의 역할, 행동 권한, 수치, 시간, 승패, 기권, 공개 범위, 보상과 신고 조건을 규정하는 Markdown 정본은 `GAME_RULES.md` 하나뿐이다.

- 수치를 실행하는 코드 정본은 `packages/shared`의 `GAME_CONFIG`·`PROGRESSION_RULES`·`COSMETIC_ITEMS`다.
- 상태·화면·흐름 문서는 정본을 각 관점으로 설명한다.
- `MVP_DECISIONS.md`는 결정 이유와 변경 이력을 보존한다.
- `history/`는 당시 기록이며 현재형으로 덮어쓰지 않는다.

## 문서 상태

- `CURRENT`: 현재 구현·확정 결정의 기준
- `PROPOSED`: 확정됐지만 아직 구현되지 않은 목표
- `HISTORICAL`: 당시 변경 기록
- `REMOVED`: 대상이 저장소에서 제거된 기록(`history/`에 둔다)

## 문서별 책임

| 문서 | 책임 |
|---|---|
| `GAME_RULES.md` | 게임 규칙의 유일한 정본 |
| `GAME_MODES.md` | 모드·판정·화풍 출제 요약 |
| `GAME_DESIGN.md` | 핵심 경험과 제품 목표 |
| `MVP_DECISIONS.md` | 결정 이유와 변경 이력 |
| `USER_FLOW.md`, `SCREEN_SPEC.md` | 사용자 흐름과 화면 요구 |
| `design/UI_GUIDELINES.md` | 화면 구현 기준(디자인 시스템·포인터·접근성) |
| `GAME_STATE.md` | 서버 경기 상태와 입력 권한 |
| `TECH_SPEC.md` | 운영 구조·통신·카탈로그 기술 계약 |
| `DATABASE_DESIGN.md` | Supabase 테이블과 관계 |
| `CLOUDFLARE_DEPLOYMENT.md` | 운영 배포·Supabase 연결·복구 |
| `GAME_ASSETS.md` | 그림 품질 기준과 R2·카탈로그 등록 절차 |
| `design/SOLO_ASSET_PROVENANCE.md` | 솔로 그림 생성 기록 |
| `MOBILE_APPS.md` | Android·iOS 앱 구조, 서버 주소, 빌드·배포 |
| `android-build-environment.md`, `android-wrapper-plan.md` | Android 래퍼 빌드 환경과 단계 계획 |
| `REPOSITORY_STRUCTURE.md` | 디렉터리 책임과 의존 방향 |
| `TEST_PLAN.md`, `TEST_STRUCTURE.md` | 검증 범위와 테스트 배치 |
| `IMPLEMENTATION_BACKLOG.md` | 남은 작업 |
| `README.md` | 입문 요약과 실행 방법 |

## 규칙 변경 절차

1. 결정 이유를 `MVP_DECISIONS.md`에 기록한다.
2. `GAME_RULES.md`와 공유 코드 정본을 함께 바꾼다.
3. 상태·기획·흐름·화면·기술·테스트·에셋·백로그 문서를 같은 변경에서 맞춘다.
4. 타입·단위·통합·브라우저 테스트를 통과한다.

파생 문서나 코드가 정본과 다르면 어느 하나를 임의로 우선하지 않고 결함으로 처리한다.

## 역사 문서

날짜별 변경 요약은 당시 문제와 해결 과정을 보존한다. 현재 구현과 달라도 내용을 현재형으로 덮어쓰지 않고, 바뀐 사실은 현재 문서와 `MVP_DECISIONS.md` 변경 이력에 남긴다.
