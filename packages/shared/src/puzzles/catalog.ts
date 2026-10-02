import type { AnswerRegion } from "../game/types.js";
import { GAME_PUZZLE_ASSET_MANIFEST, type BundledPuzzleId, type SoloPuzzleId } from "./asset-manifest.js";

/** 대결과 솔로 모두 서버가 판정한다. */
export type PuzzleMode = "battle" | "solo";

export const ART_GENRES = ["실사", "애니", "회화", "카툰", "게임"] as const;
export type ArtGenre = (typeof ART_GENRES)[number];

/** 퍼즐 ID: 영문 소문자·숫자·하이픈. R2 경로와 수집 키에 그대로 쓰인다. */
export const PUZZLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** 에셋 버전: YYYY-MM-DD.N */
export const ASSET_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;

export interface SoloAnswer {
  id: string;
  label: string;
  /** 찾은 표시를 그리는 대표 영역 */
  region: AnswerRegion;
  /** 크거나 여러 부분으로 된 변화의 추가 판정 영역 */
  extraRegions?: readonly AnswerRegion[];
}

/**
 * 브라우저에 공개하는 퍼즐 정보. 정답은 대결·솔로 모두 넣지 않는다(서버가 판정한다).
 * URL이 없으면 앱 번들에 포함된 그림을 쓴다.
 */
export interface PuzzleCard {
  id: string;
  version: string;
  mode: PuzzleMode;
  title: string;
  alt: string;
  genre: ArtGenre;
  originalUrl?: string;
  modifiedUrl?: string;
}

export interface CatalogPayload {
  puzzles: PuzzleCard[];
}

export function collectionKey(card: Pick<PuzzleCard, "id" | "mode">): string {
  return `${card.mode === "battle" ? "game" : "solo"}:${card.id}`;
}

/** R2 object key. 버전이 경로에 들어가 같은 주소의 내용은 바뀌지 않는다. */
export function puzzleObjectKey(id: string, version: string, kind: "original" | "modified"): string {
  return `puzzles/${id}/${version}/runtime/${kind}.webp`;
}

interface BundledInfo { title: string; alt: string; genre: ArtGenre }

/** 앱 번들에 포함된 대결 그림의 공개 정보. 정답은 서버 코드에만 있다. */
export const BUNDLED_BATTLE_INFO: Readonly<Record<BundledPuzzleId, BundledInfo>> = {
  "cozy-cafe": { title: "햇살 좋은 카페", alt: "꽃병과 고양이가 있는 따뜻한 카페", genre: "회화" },
  "enchanted-forest": { title: "마법의 버섯 숲", alt: "토끼와 버섯집이 있는 마법의 숲", genre: "카툰" },
  "underwater-treasure": { title: "바닷속 보물", alt: "거북이와 보물상자가 있는 바닷속", genre: "카툰" },
  "cyber-city": { title: "네온 사이버 도시", alt: "네온 간판과 사람들이 있는 미래 도시", genre: "애니" },
  "winter-cabin": { title: "눈 내린 겨울 산장", alt: "모닥불과 눈사람이 있는 겨울 산장", genre: "카툰" },
  "home-office": { title: "햇살 좋은 홈오피스", alt: "노트북과 스탠드가 놓인 햇살 좋은 홈오피스", genre: "실사" },
  "farmers-market": { title: "정원 농산물 가판대", alt: "꽃과 과일, 채소가 진열된 야외 농산물 가판대", genre: "실사" },
  "bathroom-vanity": { title: "뉴트럴 욕실 세면대", alt: "원형 거울과 수건이 있는 뉴트럴톤 욕실 세면대", genre: "실사" },
  "lakeside-picnic": { title: "호숫가 피크닉", alt: "랜턴과 피크닉 바구니가 놓인 호숫가 나무 테이블", genre: "실사" },
  "laundry-room": { title: "아늑한 세탁실", alt: "세탁기와 다리미판이 있는 밝고 아늑한 세탁실", genre: "실사" },
};

/** 앱 번들에 포함된 솔로 그림의 공개 정보. 정답은 서버 코드(apps/server/src/game/solo-puzzles.ts)에만 있다. */
export const BUNDLED_SOLO_PUZZLES: ReadonlyArray<BundledInfo & { id: SoloPuzzleId; version: string }> = [
  { id: "observatory", version: "2026-09-04.1", title: "달빛 천문대", alt: "망원경과 천체 관측 도구가 가득한 달빛 천문대", genre: "회화" },
  { id: "bakery", version: "2026-10-01.1", title: "아침의 베이커리", alt: "빵과 조리 도구가 가득한 아침의 베이커리", genre: "회화" },
  { id: "greenhouse", version: "2026-10-01.1", title: "비밀의 온실", alt: "꽃과 원예 도구가 가득한 유리 온실", genre: "회화" },
  { id: "alpine-station", version: "2026-09-04.1", title: "알프스 산악역", alt: "기차와 여행 가방이 있는 알프스 산악역", genre: "회화" },
  { id: "clockmaker", version: "2026-09-04.1", title: "시계공의 작업실", alt: "시계와 기계 장치가 가득한 시계공의 작업실", genre: "회화" },
];

/** 서버가 코드 카탈로그 모드일 때 내려주는 공개 카드 */
export function bundledPuzzleCards(): PuzzleCard[] {
  return [
    ...(Object.keys(BUNDLED_BATTLE_INFO) as BundledPuzzleId[]).map((id) => ({
      id,
      version: GAME_PUZZLE_ASSET_MANIFEST[id].version,
      mode: "battle" as const,
      ...BUNDLED_BATTLE_INFO[id],
    })),
    ...BUNDLED_SOLO_PUZZLES.map(({ id, version, title, alt, genre }) => ({ id, version, mode: "solo" as const, title, alt, genre })),
  ];
}
