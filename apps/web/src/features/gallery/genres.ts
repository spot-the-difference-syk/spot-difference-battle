import type { GamePuzzleId } from "@spot-battle/shared";
import type { SoloPuzzleId } from "../solo/puzzles/catalog";

export const ART_GENRES = ["실사", "애니", "회화", "카툰", "게임"] as const;
export type ArtGenre = (typeof ART_GENRES)[number];

// 새 그림을 등록하면 여기서 화풍을 정해야 컴파일된다.
export const GAME_PUZZLE_GENRES: Readonly<Record<GamePuzzleId, ArtGenre>> = {
  "cozy-cafe": "회화",
  "enchanted-forest": "카툰",
  "underwater-treasure": "카툰",
  "cyber-city": "애니",
  "winter-cabin": "카툰",
  "home-office": "실사",
  "farmers-market": "실사",
  "bathroom-vanity": "실사",
  "lakeside-picnic": "실사",
  "laundry-room": "실사",
};

export const SOLO_PUZZLE_GENRES: Readonly<Record<SoloPuzzleId, ArtGenre>> = {
  observatory: "회화",
  bakery: "회화",
  greenhouse: "회화",
  "alpine-station": "회화",
  clockmaker: "회화",
};
