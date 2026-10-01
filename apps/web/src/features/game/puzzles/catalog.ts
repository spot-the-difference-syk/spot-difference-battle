import {
  GAME_PUZZLE_ASSET_MANIFEST,
  GAME_PUZZLE_IDS,
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

interface GamePuzzleVisual {
  id: BundledPuzzleId;
  metadata: PuzzleAssetMetadata;
  label: string;
  originalSrc: string;
  modifiedSrc: string;
  alt: string;
}

const IMAGES: Readonly<Record<BundledPuzzleId, { originalSrc: string; modifiedSrc: string }>> = {
  "cozy-cafe": { originalSrc: cafeOriginal, modifiedSrc: cafeModified },
  "enchanted-forest": { originalSrc: forestOriginal, modifiedSrc: forestModified },
  "underwater-treasure": { originalSrc: underwaterOriginal, modifiedSrc: underwaterModified },
  "cyber-city": { originalSrc: cityOriginal, modifiedSrc: cityModified },
  "winter-cabin": { originalSrc: winterOriginal, modifiedSrc: winterModified },
  "home-office": { originalSrc: homeOfficeOriginal, modifiedSrc: homeOfficeModified },
  "farmers-market": { originalSrc: farmersMarketOriginal, modifiedSrc: farmersMarketModified },
  "bathroom-vanity": { originalSrc: bathroomVanityOriginal, modifiedSrc: bathroomVanityModified },
  "lakeside-picnic": { originalSrc: lakesidePicnicOriginal, modifiedSrc: lakesidePicnicModified },
  "laundry-room": { originalSrc: laundryRoomOriginal, modifiedSrc: laundryRoomModified },
};

/** 앱 번들에 포함된 대결 그림. 서버 카탈로그가 R2 주소를 주지 않을 때 쓴다. */
export const GAME_PUZZLE_VISUALS: Readonly<Record<BundledPuzzleId, GamePuzzleVisual>> = Object.fromEntries(
  GAME_PUZZLE_IDS.map((id) => [id, {
    id,
    metadata: GAME_PUZZLE_ASSET_MANIFEST[id],
    label: BUNDLED_BATTLE_INFO[id].title,
    alt: BUNDLED_BATTLE_INFO[id].alt,
    ...IMAGES[id],
  }]),
) as Record<BundledPuzzleId, GamePuzzleVisual>;
