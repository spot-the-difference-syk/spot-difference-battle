import {
  GAME_PUZZLE_ASSET_MANIFEST,
  BUNDLED_BATTLE_INFO,
  type BundledPuzzleId,
  type PuzzleAssetMetadata,
} from "@spot-battle/shared";
import bathroomVanityModified from "@/assets/puzzles/bathroom-vanity-modified.webp";
import bathroomVanityOriginal from "@/assets/puzzles/bathroom-vanity-original.webp";
import cafeModified from "@/assets/puzzles/cozy-cafe-modified-v2.webp";
import cafeOriginal from "@/assets/puzzles/cozy-cafe-original-v2.webp";
import cityModified from "@/assets/puzzles/cyber-city-modified-v2.webp";
import cityOriginal from "@/assets/puzzles/cyber-city-original-v2.webp";
import forestModified from "@/assets/puzzles/enchanted-forest-modified-v2.webp";
import forestOriginal from "@/assets/puzzles/enchanted-forest-original-v2.webp";
import farmersMarketModified from "@/assets/puzzles/farmers-market-modified.webp";
import farmersMarketOriginal from "@/assets/puzzles/farmers-market-original.webp";
import homeOfficeModified from "@/assets/puzzles/home-office-modified.webp";
import homeOfficeOriginal from "@/assets/puzzles/home-office-original.webp";
import lakesidePicnicModified from "@/assets/puzzles/lakeside-picnic-modified.webp";
import lakesidePicnicOriginal from "@/assets/puzzles/lakeside-picnic-original.webp";
import laundryRoomModified from "@/assets/puzzles/laundry-room-modified.webp";
import laundryRoomOriginal from "@/assets/puzzles/laundry-room-original.webp";
import underwaterModified from "@/assets/puzzles/underwater-treasure-modified-v2.webp";
import underwaterOriginal from "@/assets/puzzles/underwater-treasure-original-v2.webp";
import winterModified from "@/assets/puzzles/winter-cabin-modified.webp";
import winterOriginal from "@/assets/puzzles/winter-cabin-original.webp";

export interface GamePuzzleVisual {
  id: BundledPuzzleId;
  metadata: PuzzleAssetMetadata;
  label: string;
  originalSrc: string;
  modifiedSrc: string;
  alt: string;
}

const homeOfficeCanarySource = (
  kind: "original" | "modified",
  fallback: string,
  canaryBaseUrl: string | undefined,
): string => {
  const configuredUrl = canaryBaseUrl?.trim();
  if (!configuredUrl) return fallback;

  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredUrl);
  } catch {
    throw new Error("VITE_R2_CANARY_BASE_URL must be a valid absolute URL.");
  }
  const localHttp = baseUrl.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
  if (
    (baseUrl.protocol !== "https:" && !localHttp)
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash
    || (baseUrl.pathname !== "/" && baseUrl.pathname !== "")
  ) {
    throw new Error("VITE_R2_CANARY_BASE_URL must be an HTTPS origin or a local HTTP origin.");
  }

  const version = GAME_PUZZLE_ASSET_MANIFEST["home-office"].version;
  return `${baseUrl.origin}/puzzles/home-office/${version}/runtime/${kind}.webp`;
};

export const createGamePuzzleVisuals = (
  canaryBaseUrl?: string,
): Readonly<Record<BundledPuzzleId, GamePuzzleVisual>> => ({
  "cozy-cafe": {
    id: "cozy-cafe",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["cozy-cafe"],
    label: BUNDLED_BATTLE_INFO["cozy-cafe"].title,
    originalSrc: cafeOriginal,
    modifiedSrc: cafeModified,
    alt: BUNDLED_BATTLE_INFO["cozy-cafe"].alt,
  },
  "enchanted-forest": {
    id: "enchanted-forest",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["enchanted-forest"],
    label: BUNDLED_BATTLE_INFO["enchanted-forest"].title,
    originalSrc: forestOriginal,
    modifiedSrc: forestModified,
    alt: BUNDLED_BATTLE_INFO["enchanted-forest"].alt,
  },
  "underwater-treasure": {
    id: "underwater-treasure",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["underwater-treasure"],
    label: BUNDLED_BATTLE_INFO["underwater-treasure"].title,
    originalSrc: underwaterOriginal,
    modifiedSrc: underwaterModified,
    alt: BUNDLED_BATTLE_INFO["underwater-treasure"].alt,
  },
  "cyber-city": {
    id: "cyber-city",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["cyber-city"],
    label: BUNDLED_BATTLE_INFO["cyber-city"].title,
    originalSrc: cityOriginal,
    modifiedSrc: cityModified,
    alt: BUNDLED_BATTLE_INFO["cyber-city"].alt,
  },
  "winter-cabin": {
    id: "winter-cabin",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["winter-cabin"],
    label: BUNDLED_BATTLE_INFO["winter-cabin"].title,
    originalSrc: winterOriginal,
    modifiedSrc: winterModified,
    alt: BUNDLED_BATTLE_INFO["winter-cabin"].alt,
  },
  "home-office": {
    id: "home-office",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["home-office"],
    label: BUNDLED_BATTLE_INFO["home-office"].title,
    originalSrc: homeOfficeCanarySource("original", homeOfficeOriginal, canaryBaseUrl),
    modifiedSrc: homeOfficeCanarySource("modified", homeOfficeModified, canaryBaseUrl),
    alt: BUNDLED_BATTLE_INFO["home-office"].alt,
  },
  "farmers-market": {
    id: "farmers-market",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["farmers-market"],
    label: BUNDLED_BATTLE_INFO["farmers-market"].title,
    originalSrc: farmersMarketOriginal,
    modifiedSrc: farmersMarketModified,
    alt: BUNDLED_BATTLE_INFO["farmers-market"].alt,
  },
  "bathroom-vanity": {
    id: "bathroom-vanity",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["bathroom-vanity"],
    label: BUNDLED_BATTLE_INFO["bathroom-vanity"].title,
    originalSrc: bathroomVanityOriginal,
    modifiedSrc: bathroomVanityModified,
    alt: BUNDLED_BATTLE_INFO["bathroom-vanity"].alt,
  },
  "lakeside-picnic": {
    id: "lakeside-picnic",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["lakeside-picnic"],
    label: BUNDLED_BATTLE_INFO["lakeside-picnic"].title,
    originalSrc: lakesidePicnicOriginal,
    modifiedSrc: lakesidePicnicModified,
    alt: BUNDLED_BATTLE_INFO["lakeside-picnic"].alt,
  },
  "laundry-room": {
    id: "laundry-room",
    metadata: GAME_PUZZLE_ASSET_MANIFEST["laundry-room"],
    label: BUNDLED_BATTLE_INFO["laundry-room"].title,
    originalSrc: laundryRoomOriginal,
    modifiedSrc: laundryRoomModified,
    alt: BUNDLED_BATTLE_INFO["laundry-room"].alt,
  },
});

export const GAME_PUZZLE_VISUALS = createGamePuzzleVisuals(
  import.meta.env.VITE_R2_CANARY_BASE_URL,
);

const preloadCache = new Map<BundledPuzzleId, Promise<void>>();

export function preloadPuzzle(puzzleId: BundledPuzzleId): Promise<void> {
  const cached = preloadCache.get(puzzleId);
  if (cached) return cached;

  const puzzle = GAME_PUZZLE_VISUALS[puzzleId];
  const loading = Promise.all([puzzle.originalSrc, puzzle.modifiedSrc].map((src) => new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`${puzzle.label} 이미지를 불러오지 못했습니다.`));
    image.src = src;
  }))).then(() => undefined).catch((error: unknown) => {
    preloadCache.delete(puzzleId);
    throw error;
  });
  preloadCache.set(puzzleId, loading);
  return loading;
}
