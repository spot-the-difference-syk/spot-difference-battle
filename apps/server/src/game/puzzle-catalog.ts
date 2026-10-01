import type { MatchPuzzle } from "@spot-battle/game-core";
import { GAME_PUZZLE_ASSET_MANIFEST } from "@spot-battle/shared";

export const GAME_PUZZLES: readonly MatchPuzzle[] = [
  {
    id: "cozy-cafe",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["cozy-cafe"].version,
    differences: [
      { id: "cafe-clock-hands", label: "벽시계 바늘", regions: [{ x: 0.125, y: 0.155, radius: 0.09 }] },
      { id: "cafe-bouquet", label: "테이블 꽃", regions: [{ x: 0.52, y: 0.59, radius: 0.14 }] },
      { id: "cafe-cat", label: "의자 위 고양이", regions: [{ x: 0.86, y: 0.8, radius: 0.13 }] },
    ],
  },
  {
    id: "enchanted-forest",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["enchanted-forest"].version,
    differences: [
      { id: "forest-lantern", label: "매달린 등불", regions: [{ x: 0.31, y: 0.33, radius: 0.13 }] },
      { id: "forest-scarf", label: "토끼 목도리", regions: [{ x: 0.27, y: 0.78, radius: 0.08 }] },
      { id: "forest-roof-bird", label: "버섯 지붕의 새", regions: [{ x: 0.79, y: 0.17, radius: 0.06 }] },
    ],
  },
  {
    id: "underwater-treasure",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["underwater-treasure"].version,
    differences: [
      { id: "underwater-turtle-hat", label: "거북이 모자", regions: [{ x: 0.39, y: 0.11, radius: 0.1 }] },
      { id: "underwater-jellyfish", label: "해파리 색", regions: [{ x: 0.8, y: 0.22, radius: 0.14 }] },
      { id: "underwater-chest", label: "보물상자", regions: [{ x: 0.5, y: 0.76, radius: 0.18 }] },
    ],
  },
  {
    id: "cyber-city",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["cyber-city"].version,
    differences: [
      { id: "city-neon-sign", label: "대형 네온 간판", regions: [{ x: 0.23, y: 0.24, radius: 0.16 }] },
      { id: "city-flying-car", label: "하늘의 자동차", regions: [{ x: 0.75, y: 0.24, radius: 0.15 }] },
      { id: "city-headphones", label: "가운데 인물의 헤드폰", regions: [{ x: 0.52, y: 0.69, radius: 0.065 }] },
    ],
  },
  {
    id: "winter-cabin",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["winter-cabin"].version,
    differences: [
      { id: "winter-chimney-smoke", label: "굴뚝 연기", regions: [{ x: 0.66, y: 0.12, radius: 0.1 }] },
      { id: "winter-snowman-hat", label: "눈사람 모자", regions: [{ x: 0.84, y: 0.6, radius: 0.11 }] },
      { id: "winter-campfire", label: "모닥불 색", regions: [{ x: 0.51, y: 0.78, radius: 0.13 }] },
    ],
  },
  {
    id: "home-office",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["home-office"].version,
    differences: [
      { id: "office-wall-decor", label: "벽시계와 액자", regions: [{ x: 0.56, y: 0.16, radius: 0.14 }] },
      { id: "office-mug", label: "책상 위 머그컵", regions: [{ x: 0.24, y: 0.66, radius: 0.09 }] },
      { id: "office-notebook", label: "노트 색", regions: [{ x: 0.84, y: 0.72, radius: 0.12 }] },
    ],
  },
  {
    id: "farmers-market",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["farmers-market"].version,
    differences: [
      { id: "market-flowers", label: "꽃 종류", regions: [{ x: 0.14, y: 0.37, radius: 0.11 }] },
      { id: "market-fruit", label: "왼쪽 과일", regions: [{ x: 0.21, y: 0.64, radius: 0.16 }] },
      { id: "market-tote", label: "오른쪽 천가방", regions: [{ x: 0.91, y: 0.57, radius: 0.09 }] },
    ],
  },
  {
    id: "bathroom-vanity",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["bathroom-vanity"].version,
    differences: [
      { id: "bathroom-succulent", label: "세면대 왼쪽 화분", regions: [{ x: 0.285, y: 0.39, radius: 0.06 }] },
      { id: "bathroom-candle", label: "세면대 왼쪽 촛불", regions: [{ x: 0.40, y: 0.42, radius: 0.04 }] },
      { id: "bathroom-wall-towel", label: "벽걸이 수건 색", regions: [{ x: 0.90, y: 0.30, radius: 0.10 }] },
    ],
  },
  {
    id: "lakeside-picnic",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["lakeside-picnic"].version,
    differences: [
      { id: "picnic-lantern", label: "랜턴 색", regions: [{ x: 0.24, y: 0.49, radius: 0.07 }] },
      { id: "picnic-mug", label: "테이블 위 머그컵", regions: [{ x: 0.35, y: 0.54, radius: 0.04 }] },
      { id: "picnic-bag", label: "나무 옆 가방", regions: [{ x: 0.87, y: 0.73, radius: 0.13 }] },
    ],
  },
  {
    id: "laundry-room",
    assetVersion: GAME_PUZZLE_ASSET_MANIFEST["laundry-room"].version,
    differences: [
      { id: "laundry-detergent", label: "파란 세제통", regions: [{ x: 0.34, y: 0.14, radius: 0.065 }] },
      { id: "laundry-shirt", label: "걸린 티셔츠", regions: [{ x: 0.83, y: 0.30, radius: 0.11 }] },
      { id: "laundry-ironing-board", label: "다리미판 색", regions: [{ x: 0.78, y: 0.51, radius: 0.09 }] },
    ],
  },
] as const;

export function shuffledGamePuzzles(): MatchPuzzle[] {
  return [...GAME_PUZZLES]
    .map((puzzle) => ({ puzzle, order: Math.random() }))
    .sort((left, right) => left.order - right.order)
    .map(({ puzzle }) => structuredClone(puzzle));
}
