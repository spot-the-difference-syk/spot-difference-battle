import type { SoloDifference } from "../model/solo-engine";
import alpineStationModified from "@/assets/puzzles/solo/alpine-station-modified.webp";
import alpineStationOriginal from "@/assets/puzzles/solo/alpine-station-original.webp";
import bakeryModified from "@/assets/puzzles/solo/bakery-modified.webp";
import bakeryOriginal from "@/assets/puzzles/solo/bakery-original.webp";
import clockmakerModified from "@/assets/puzzles/solo/clockmaker-modified.webp";
import clockmakerOriginal from "@/assets/puzzles/solo/clockmaker-original.webp";
import greenhouseModified from "@/assets/puzzles/solo/greenhouse-modified.webp";
import greenhouseOriginal from "@/assets/puzzles/solo/greenhouse-original.webp";
import observatoryModified from "@/assets/puzzles/solo/observatory-modified.webp";
import observatoryOriginal from "@/assets/puzzles/solo/observatory-original.webp";
import { SOLO_ASSET_MANIFEST, type SoloAssetMetadata } from "./manifest";

import { BUNDLED_SOLO_PUZZLES, SOLO_PUZZLE_IDS, type SoloPuzzleId } from "@spot-battle/shared";

export { SOLO_PUZZLE_IDS, type SoloPuzzleId };

export interface SoloPuzzle {
  id: SoloPuzzleId;
  metadata: SoloAssetMetadata;
  label: string;
  alt: string;
  originalSrc: string;
  modifiedSrc: string;
  differences: readonly SoloDifference[];
}

const IMAGES: Readonly<Record<SoloPuzzleId, { originalSrc: string; modifiedSrc: string }>> = {
  observatory: { originalSrc: observatoryOriginal, modifiedSrc: observatoryModified },
  bakery: { originalSrc: bakeryOriginal, modifiedSrc: bakeryModified },
  greenhouse: { originalSrc: greenhouseOriginal, modifiedSrc: greenhouseModified },
  "alpine-station": { originalSrc: alpineStationOriginal, modifiedSrc: alpineStationModified },
  clockmaker: { originalSrc: clockmakerOriginal, modifiedSrc: clockmakerModified },
};

/** 앱 번들에 포함된 솔로 그림. 제목·정답은 공용 패키지(BUNDLED_SOLO_PUZZLES)가 정본이다. */
export const SOLO_PUZZLES: readonly SoloPuzzle[] = BUNDLED_SOLO_PUZZLES.map((puzzle) => ({
  id: puzzle.id,
  metadata: SOLO_ASSET_MANIFEST[puzzle.id],
  label: puzzle.title,
  alt: puzzle.alt,
  ...IMAGES[puzzle.id],
  differences: puzzle.answers,
}));

export const SOLO_PUZZLE_BY_ID = Object.fromEntries(
  SOLO_PUZZLES.map((puzzle) => [puzzle.id, puzzle]),
) as Readonly<Record<SoloPuzzleId, SoloPuzzle>>;

const preloadCache = new Map<SoloPuzzleId, Promise<void>>();

export function preloadSoloPuzzle(puzzleId: SoloPuzzleId): Promise<void> {
  const cached = preloadCache.get(puzzleId);
  if (cached) return cached;
  const puzzle = SOLO_PUZZLE_BY_ID[puzzleId];
  const loading = Promise.all(
    [puzzle.originalSrc, puzzle.modifiedSrc].map((src) => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`${puzzle.label} 이미지를 불러오지 못했습니다.`));
      image.src = src;
    })),
  ).then(() => undefined).catch((error: unknown) => {
    preloadCache.delete(puzzleId);
    throw error;
  });
  preloadCache.set(puzzleId, loading);
  return loading;
}
