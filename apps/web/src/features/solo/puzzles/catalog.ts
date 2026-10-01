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

import { SOLO_PUZZLE_IDS, type SoloPuzzleId } from "@spot-battle/shared";

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

export const SOLO_PUZZLES: readonly SoloPuzzle[] = [
  {
    id: "observatory",
    metadata: SOLO_ASSET_MANIFEST.observatory,
    label: "달빛 천문대",
    alt: "망원경과 천체 관측 도구가 가득한 달빛 천문대",
    originalSrc: observatoryOriginal,
    modifiedSrc: observatoryModified,
    differences: [
      { id: "observatory-vine", label: "책장 위 화분", region: { x: 0.31, y: 0.21, radius: 0.05 } },
      { id: "observatory-moon", label: "창밖의 달", region: { x: 0.56, y: 0.27, radius: 0.055 } },
      { id: "observatory-hourglass", label: "모래시계의 모래", region: { x: 0.924, y: 0.75, radius: 0.05 } },
      { id: "observatory-ribbon", label: "망원경의 리본", region: { x: 0.17, y: 0.478, radius: 0.05 } },
      { id: "observatory-magnifier", label: "책상 위 돋보기", region: { x: 0.32, y: 0.93, radius: 0.055 }, extraRegions: [{ x: 0.37, y: 0.905, radius: 0.04 }, { x: 0.232, y: 0.96, radius: 0.03 }] },
    ],
  },
  {
    id: "bakery",
    metadata: SOLO_ASSET_MANIFEST.bakery,
    label: "아침의 베이커리",
    alt: "빵과 조리 도구가 가득한 아침의 베이커리",
    originalSrc: bakeryOriginal,
    modifiedSrc: bakeryModified,
    differences: [
      { id: "bakery-clock", label: "벽시계 바늘", region: { x: 0.72, y: 0.31, radius: 0.04 } },
      { id: "bakery-whisk", label: "벽의 거품기", region: { x: 0.662, y: 0.34, radius: 0.04 } },
      { id: "bakery-bowls", label: "선반의 그릇", region: { x: 0.723, y: 0.208, radius: 0.05 } },
      { id: "bakery-jam", label: "잼 병 덮개", region: { x: 0.804, y: 0.73, radius: 0.05 } },
      { id: "bakery-croissant", label: "쟁반의 크루아상", region: { x: 0.60, y: 0.68, radius: 0.055 } },
    ],
  },
  {
    id: "greenhouse",
    metadata: SOLO_ASSET_MANIFEST.greenhouse,
    label: "비밀의 온실",
    alt: "꽃과 원예 도구가 가득한 유리 온실",
    originalSrc: greenhouseOriginal,
    modifiedSrc: greenhouseModified,
    differences: [
      { id: "greenhouse-butterfly", label: "파란 나비", region: { x: 0.425, y: 0.225, radius: 0.045 } },
      { id: "greenhouse-bottle", label: "작업대의 파란 병", region: { x: 0.267, y: 0.503, radius: 0.045 } },
      { id: "greenhouse-gloves", label: "정원 장갑", region: { x: 0.175, y: 0.935, radius: 0.055 } },
      { id: "greenhouse-succulent", label: "앞쪽 다육식물", region: { x: 0.565, y: 0.86, radius: 0.05 } },
      { id: "greenhouse-watering-can", label: "왼쪽 물뿌리개", region: { x: 0.10, y: 0.75, radius: 0.055 }, extraRegions: [{ x: 0.19, y: 0.715, radius: 0.04 }, { x: 0.04, y: 0.765, radius: 0.035 }] },
    ],
  },
  {
    id: "alpine-station",
    metadata: SOLO_ASSET_MANIFEST["alpine-station"],
    label: "알프스 산악역",
    alt: "기차와 여행 가방이 있는 알프스 산악역",
    originalSrc: alpineStationOriginal,
    modifiedSrc: alpineStationModified,
    differences: [
      { id: "station-clock", label: "역 시계 바늘", region: { x: 0.328, y: 0.135, radius: 0.055 } },
      { id: "station-umbrella", label: "파란 우산", region: { x: 0.67, y: 0.642, radius: 0.045 }, extraRegions: [{ x: 0.65, y: 0.595, radius: 0.035 }] },
      { id: "station-cat-collar", label: "고양이 목걸이", region: { x: 0.314, y: 0.819, radius: 0.04 } },
      { id: "station-hat", label: "여행 가방의 모자", region: { x: 0.55, y: 0.676, radius: 0.055 } },
      { id: "station-flower-basket", label: "매달린 꽃바구니", region: { x: 0.854, y: 0.423, radius: 0.055 }, extraRegions: [{ x: 0.905, y: 0.43, radius: 0.035 }] },
    ],
  },
  {
    id: "clockmaker",
    metadata: SOLO_ASSET_MANIFEST.clockmaker,
    label: "시계공의 작업실",
    alt: "시계와 기계 장치가 가득한 시계공의 작업실",
    originalSrc: clockmakerOriginal,
    modifiedSrc: clockmakerModified,
    differences: [
      { id: "clockmaker-bird", label: "유리관 속 기계 새", region: { x: 0.221, y: 0.40, radius: 0.055 } },
      { id: "clockmaker-main-clock", label: "청록색 시계 바늘", region: { x: 0.442, y: 0.565, radius: 0.055 } },
      { id: "clockmaker-hourglass", label: "오른쪽 모래시계", region: { x: 0.955, y: 0.614, radius: 0.04 }, extraRegions: [{ x: 0.954, y: 0.66, radius: 0.035 }] },
      { id: "clockmaker-glasses", label: "안경알", region: { x: 0.516, y: 0.899, radius: 0.05 } },
      { id: "clockmaker-key", label: "책상 아래쪽 열쇠", region: { x: 0.322, y: 0.92, radius: 0.05 } },
    ],
  },
] as const;

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
