# 그림 에셋 가이드

> 문서 상태: CURRENT
> 기준일: 2026-10-01

## 1. 에셋 모델

게임 콘텐츠 단위는 `원본 + 수정본 + 정답 영역`으로 구성된 그림 한 쌍이다. 대결 그림은 정답 3개, 솔로 그림은 5개다. 경기 중 플레이어가 이미지를 수정하지 않는다.

- **운영 방식**: 새 그림은 코드 수정·재배포 없이 **R2(이미지) + Supabase `puzzle_catalog`(정답·노출 여부)** 로 추가한다. 절차는 아래 7절을 따른다.
- **앱 번들 그림**: 앱에 들어 있는 15점(대결 10, 솔로 5)은 기본 목록이자 서버·DB에 닿지 못할 때의 대체 목록이다. 기준 파일은 대결 `packages/shared/src/puzzles/asset-manifest.ts`, 솔로 `apps/web/src/features/solo/puzzles/manifest.ts`이며, 이미지는 `apps/web/src/assets/puzzles/`에 있다. 번들 이미지를 바꿀 때는 같은 이름으로 덮어쓰지 말고 버전과 해시를 함께 올린다.

권리 상태 `USER_SUPPLIED`는 사용자가 직접 제작·제공했다는 기록이지 제3자 법률 검증을 뜻하지 않는다.

## 2. 현재 보유 상태

| 구분 | 그림 | 화풍 |
|---|---|---|
| 대결 | 햇살 좋은 카페, 마법의 버섯 숲, 바닷속 보물, 네온 사이버 도시, 눈 내린 겨울 산장 | 회화·카툰·애니 |
| 대결 | 햇살 좋은 홈오피스, 정원 농산물 가판대, 뉴트럴 욕실 세면대, 호숫가 피크닉, 아늑한 세탁실 | 실사 |
| 솔로 | 달빛 천문대, 아침의 베이커리, 비밀의 온실, 알프스 산악역, 시계공의 작업실 | 회화 |

모두 1024×1024 WebP다. 난이도는 플레이 데이터가 없어 `UNRATED`다. 솔로 그림의 생성 기록은 `design/SOLO_ASSET_PROVENANCE.md`에 있다.

## 3. 이미지 조건

- 원본과 수정본의 크기·비율·구도·크롭이 같음
- 제목, A/B 표시, 테두리, 상표와 워터마크 없음
- 의도한 차이는 대결 정확히 3곳, 솔로 정확히 5곳
- 영역 밖 화풍·조명·노이즈 변화 최소화
- 모바일에서 확대했을 때 독립적으로 식별 가능한 크기
- 색상만 구별해야 하는 차이에 의존하지 않음
- 정답 영역이 겹치지 않고 그림 가장자리에서 잘리지 않음
- 실제 작품·캐릭터·상표가 들어간 그림은 권리 검토 없이 올리지 않음

게임 보드는 정사각형이다. 등록 도구는 정사각형이 아닌 그림의 가운데를 잘라 1024×1024로 맞추므로, 정답 좌표는 잘린 그림 기준으로 정한다.

## 4. 등록 원칙

1. 출처와 이용 조건을 확인한다.
2. 차이 위치는 `pnpm puzzle suggest`로 초안을 만들고, 미리보기를 보며 제작자가 확인·수정한다. 픽셀 차이를 그대로 정답으로 쓰지 않는다.
3. 미리 점검(`pnpm puzzle publish`)을 통과한 뒤 올린다.
4. PC·모바일에서 정답과 오답 경계를 육안 검수한 뒤 노출한다(`--activate` 또는 `pnpm puzzle activate`).
5. 플레이 데이터로 난이도와 오답률을 확인한다.

## 5. 수량 목표

- 한 경기: 반복되지 않는 대결 그림 10점(현재 충족)
- 초기 서비스: 화풍을 섞은 대결 그림 20~30점 이상

## 6. 완료 조건

- 양쪽이 같은 그림 순서와 버전을 사용한다.
- 현재·다음 그림을 경기 시간 손실 없이 불러온다.
- 모바일·데스크톱에서 같은 정규화 좌표가 같은 답이다.
- 라이선스가 확인되고 그림 버전을 재현할 수 있다.
- 신고 조사 기간 동안 이미지·정답·경기 사용 버전을 보존한다(R2 경로에 버전이 들어가고 `matches.puzzle_manifest`에 정답 사본이 남는다).

## 7. 새 그림 등록 (R2 + 카탈로그)

### 구조

- 이미지: R2 `puzzles/{id}/{version}/runtime/{original|modified}.webp` (1024×1024 WebP). 버전이 경로에 들어가므로 한 번 올린 주소의 내용은 바뀌지 않는다.
- 정답·제목·화풍·노출 여부: Supabase `puzzle_catalog` 행. `metadata`에 `{mode, genre, alt, original_sha256, modified_sha256}`를 둔다.
- 서버는 활성 행을 5분마다 다시 읽는다(`GET /catalog`). 실패하면 마지막 정상 목록을 계속 쓴다. 웹은 10분마다 `/catalog`를 읽고, 실패하면 번들 그림으로 진행한다.
- 대결 정답은 서버에만 있고 브라우저로 보내지 않는다. 솔로는 브라우저가 판정하므로 정답이 `/catalog`에 포함된다.
- 경기마다 활성 대결 그림 중 10점을 무작위로 뽑는다.
- R2 배포 Worker는 올라간 키라면 무엇이든 제공한다. 비활성 그림도 주소를 알면 받을 수 있으므로 공개 전 비밀이 필요한 그림은 올리지 않는다.

### 폴더 준비

그림 하나당 폴더 하나. 여러 폴더를 한 상위 폴더에 모아 두면 한 번에 처리한다.

```
inbox/
  night-market/
    original.png      # .png / .jpg / .webp
    modified.png      # 원본과 같은 크기
    puzzle.json
```

```json
{
  "id": "night-market",
  "mode": "battle",
  "title": "야시장 골목",
  "genre": "애니",
  "alt": "등불이 걸린 밤의 시장 골목",
  "difficulty": "UNRATED",
  "differences": [
    { "id": "lantern", "label": "빨간 등불", "regions": [{ "x": 0.31, "y": 0.22, "radius": 0.06 }] }
  ]
}
```

- `id`: 영문 소문자·숫자·하이픈. 수집 기록 키가 되므로 바꾸지 않는다.
- `mode`: `battle`(차이 정확히 3개, 각 영역 1개) 또는 `solo`(차이 정확히 5개, 영역 여러 개 가능).
- `genre`: 실사 / 애니 / 회화 / 카툰 / 게임.
- 좌표는 0~1 비율. 영역끼리 겹치거나 그림 밖으로 나가면 거부된다.
- 정사각형이 아니면 가운데를 잘라 1024×1024로 맞춘다(경고 표시). 잘린 뒤 좌표 기준이므로 `suggest`를 먼저 돌린다.

### 명령

```bash
pnpm puzzle suggest inbox/night-market        # 차이 자동 추천 → differences.suggested.json, preview.png
pnpm puzzle publish inbox                     # 미리 점검만 (R2·DB 변경 없음)
pnpm puzzle publish inbox --upload            # R2 업로드 + DB 등록 (아직 게임엔 안 보임)
pnpm puzzle publish inbox --upload --activate # 등록과 동시에 게임에 노출
pnpm puzzle activate night-market 2026-10-02.1
pnpm puzzle deactivate night-market
pnpm puzzle export-bundled inbox-bundled      # 기존 번들 15점을 등록용 폴더로 내보내기
```

- `suggest`는 픽셀 차이로 후보를 찾는다. 붙어 있는 두 변화는 하나로 합쳐질 수 있으니 `preview.png`를 보고 라벨과 빠진 곳을 고친 뒤 `puzzle.json`의 `differences`에 넣는다.
- 버전은 한국 날짜 기준 `YYYY-MM-DD.N`으로 자동 부여된다. 같은 그림·정답을 다시 올리면 새 버전을 만들지 않고 기존 버전을 쓴다. 정답이나 그림을 고치면 다음 번호가 된다.
- 노출을 바꾸는 명령은 트랜잭션 안에서 서버와 같은 규칙으로 전체 활성 목록을 다시 검증하고, 깨지면 되돌린다(예: 마지막 대결 그림을 내리는 경우).
- 필요한 환경변수: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `SUPABASE_DB_URL`. 저장소에 커밋하지 않는다.

### DB 카탈로그로 전환

1. `pnpm puzzle export-bundled inbox-bundled && pnpm puzzle publish inbox-bundled --upload --activate`로 기존 그림을 R2·DB에 올린다.
2. Worker `PUZZLE_CATALOG_SOURCE`를 `"database"`로 바꿔 배포한다(`docs/CLOUDFLARE_DEPLOYMENT.md`).
3. 이후 새 그림은 `publish --upload --activate`만으로 5분 안에 게임에 나타난다.

DB에 솔로 그림이 하나도 없으면 웹은 번들 솔로 그림 5점을 쓴다.
