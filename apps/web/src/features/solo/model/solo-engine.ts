import type { NormalizedPoint } from "@spot-battle/shared";

export const SOLO_DIFFERENCE_COUNT = 5;
export const SOLO_WRONG_PENALTY_MS = 3_000;
const SOLO_TOUCH_TARGET_RADIUS_PX = 24;

export type SoloRegion = NormalizedPoint & { radius: number };

export interface SoloDifference {
  id: string;
  label: string;
  /** Primary answer area. The found mark is drawn here. */
  region: SoloRegion;
  /** Additional hit areas for large or multi-part changes (e.g. both clock hands, a whole object). */
  extraRegions?: readonly SoloRegion[];
}

export function soloRegions(difference: SoloDifference): readonly SoloRegion[] {
  return difference.extraRegions ? [difference.region, ...difference.extraRegions] : [difference.region];
}

export function findSoloDifference(
  differences: readonly SoloDifference[],
  foundIds: ReadonlySet<string>,
  point: NormalizedPoint,
  minimumHitRadius = 0,
): SoloDifference | null {
  let best: { difference: SoloDifference; distanceSquared: number } | null = null;
  for (const difference of differences) {
    if (foundIds.has(difference.id)) continue;
    for (const region of soloRegions(difference)) {
      const deltaX = point.x - region.x;
      const deltaY = point.y - region.y;
      const distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
      const hitRadius = Math.max(region.radius, minimumHitRadius);
      if (distanceSquared <= hitRadius ** 2 && (!best || distanceSquared < best.distanceSquared)) {
        best = { difference, distanceSquared };
      }
    }
  }
  return best?.difference ?? null;
}

export function minimumSoloHitRadius(pointerType: string, boardSizePx: number): number {
  if (pointerType !== "touch" || boardSizePx <= 0) return 0;
  return Math.min(0.08, SOLO_TOUCH_TARGET_RADIUS_PX / boardSizePx);
}

export function soloElapsedMs(
  startedAtMs: number,
  finishedAtMs: number,
  wrongAnswerCount: number,
): number {
  return Math.max(0, finishedAtMs - startedAtMs)
    + (wrongAnswerCount * SOLO_WRONG_PENALTY_MS);
}

export function bestSoloTime(
  previousBestMs: number | null | undefined,
  elapsedMs: number,
): number {
  return previousBestMs === null || previousBestMs === undefined
    ? elapsedMs
    : Math.min(previousBestMs, elapsedMs);
}

export function formatSoloTime(elapsedMs: number): string {
  return `${(elapsedMs / 1_000).toFixed(2)}초`;
}
