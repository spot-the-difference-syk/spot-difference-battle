import type { AnswerRegion } from "../game/types.js";
import { GAME_PUZZLE_ASSET_MANIFEST, type BundledPuzzleId, type SoloPuzzleId } from "./asset-manifest.js";

/** 대결은 서버가 판정하고, 솔로는 브라우저가 판정한다. */
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
 * 브라우저에 공개하는 퍼즐 정보. 대결 정답은 절대 넣지 않는다.
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
  /** 솔로 퍼즐만 정답을 포함한다. */
  answers?: readonly SoloAnswer[];
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

/** 앱 번들에 포함된 솔로 그림. 솔로는 브라우저가 판정하므로 정답을 함께 둔다. */
export const BUNDLED_SOLO_PUZZLES: ReadonlyArray<BundledInfo & { id: SoloPuzzleId; version: string; answers: readonly SoloAnswer[] }> = [
  {
    id: "observatory",
    version: "2026-09-04.1",
    title: "달빛 천문대",
    alt: "망원경과 천체 관측 도구가 가득한 달빛 천문대",
    genre: "회화",
    answers: [
      { id: "observatory-vine", label: "책장 위 화분", region: { x: 0.31, y: 0.21, radius: 0.05 } },
      { id: "observatory-moon", label: "창밖의 달", region: { x: 0.56, y: 0.27, radius: 0.055 } },
      { id: "observatory-hourglass", label: "모래시계의 모래", region: { x: 0.924, y: 0.75, radius: 0.05 } },
      { id: "observatory-ribbon", label: "망원경의 리본", region: { x: 0.17, y: 0.478, radius: 0.05 } },
      { id: "observatory-magnifier", label: "책상 위 돋보기", region: { x: 0.32, y: 0.93, radius: 0.055 }, extraRegions: [{ x: 0.37, y: 0.905, radius: 0.04 }, { x: 0.232, y: 0.96, radius: 0.03 }] },
    ],
  },
  {
    id: "bakery",
    version: "2026-10-01.1",
    title: "아침의 베이커리",
    alt: "빵과 조리 도구가 가득한 아침의 베이커리",
    genre: "회화",
    answers: [
      { id: "bakery-clock", label: "벽시계 바늘", region: { x: 0.72, y: 0.31, radius: 0.04 } },
      { id: "bakery-whisk", label: "벽의 거품기", region: { x: 0.662, y: 0.34, radius: 0.04 } },
      { id: "bakery-bowls", label: "선반의 그릇", region: { x: 0.723, y: 0.208, radius: 0.05 } },
      { id: "bakery-jam", label: "잼 병 덮개", region: { x: 0.804, y: 0.73, radius: 0.05 } },
      { id: "bakery-croissant", label: "쟁반의 크루아상", region: { x: 0.60, y: 0.68, radius: 0.055 } },
    ],
  },
  {
    id: "greenhouse",
    version: "2026-10-01.1",
    title: "비밀의 온실",
    alt: "꽃과 원예 도구가 가득한 유리 온실",
    genre: "회화",
    answers: [
      { id: "greenhouse-butterfly", label: "파란 나비", region: { x: 0.425, y: 0.225, radius: 0.045 } },
      { id: "greenhouse-bottle", label: "작업대의 파란 병", region: { x: 0.267, y: 0.503, radius: 0.045 } },
      { id: "greenhouse-gloves", label: "정원 장갑", region: { x: 0.175, y: 0.935, radius: 0.055 } },
      { id: "greenhouse-succulent", label: "앞쪽 다육식물", region: { x: 0.565, y: 0.86, radius: 0.05 } },
      { id: "greenhouse-watering-can", label: "왼쪽 물뿌리개", region: { x: 0.10, y: 0.75, radius: 0.055 }, extraRegions: [{ x: 0.19, y: 0.715, radius: 0.04 }, { x: 0.04, y: 0.765, radius: 0.035 }] },
    ],
  },
  {
    id: "alpine-station",
    version: "2026-09-04.1",
    title: "알프스 산악역",
    alt: "기차와 여행 가방이 있는 알프스 산악역",
    genre: "회화",
    answers: [
      { id: "station-clock", label: "역 시계 바늘", region: { x: 0.328, y: 0.135, radius: 0.055 } },
      { id: "station-umbrella", label: "파란 우산", region: { x: 0.67, y: 0.642, radius: 0.045 }, extraRegions: [{ x: 0.65, y: 0.595, radius: 0.035 }] },
      { id: "station-cat-collar", label: "고양이 목걸이", region: { x: 0.314, y: 0.819, radius: 0.04 } },
      { id: "station-hat", label: "여행 가방의 모자", region: { x: 0.55, y: 0.676, radius: 0.055 } },
      { id: "station-flower-basket", label: "매달린 꽃바구니", region: { x: 0.854, y: 0.423, radius: 0.055 }, extraRegions: [{ x: 0.905, y: 0.43, radius: 0.035 }] },
    ],
  },
  {
    id: "clockmaker",
    version: "2026-09-04.1",
    title: "시계공의 작업실",
    alt: "시계와 기계 장치가 가득한 시계공의 작업실",
    genre: "회화",
    answers: [
      { id: "clockmaker-bird", label: "유리관 속 기계 새", region: { x: 0.221, y: 0.40, radius: 0.055 } },
      { id: "clockmaker-main-clock", label: "청록색 시계 바늘", region: { x: 0.442, y: 0.565, radius: 0.055 } },
      { id: "clockmaker-hourglass", label: "오른쪽 모래시계", region: { x: 0.955, y: 0.614, radius: 0.04 }, extraRegions: [{ x: 0.954, y: 0.66, radius: 0.035 }] },
      { id: "clockmaker-glasses", label: "안경알", region: { x: 0.516, y: 0.899, radius: 0.05 } },
      { id: "clockmaker-key", label: "책상 아래쪽 열쇠", region: { x: 0.322, y: 0.92, radius: 0.05 } },
    ],
  },
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
    ...BUNDLED_SOLO_PUZZLES.map(({ id, version, title, alt, genre, answers }) => ({ id, version, mode: "solo" as const, title, alt, genre, answers })),
  ];
}
