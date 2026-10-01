import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOLO_DIFFERENCE_COUNT, findSoloDifference, soloRegions } from "../model/solo-engine";
import { SOLO_PUZZLES, SOLO_PUZZLE_IDS } from "./catalog";

describe("solo puzzle catalog", () => {
  it("contains five distinct hard puzzles with five differences each", () => {
    expect(SOLO_PUZZLES).toHaveLength(5);
    expect(SOLO_PUZZLES.map((puzzle) => puzzle.id)).toEqual(SOLO_PUZZLE_IDS);

    for (const puzzle of SOLO_PUZZLES) {
      expect(puzzle.originalSrc).not.toBe(puzzle.modifiedSrc);
      expect(puzzle.differences).toHaveLength(SOLO_DIFFERENCE_COUNT);
      expect(new Set(puzzle.differences.map((difference) => difference.id)).size)
        .toBe(SOLO_DIFFERENCE_COUNT);
      for (const difference of puzzle.differences) {
        expect(difference.region.x).toBeGreaterThanOrEqual(0);
        expect(difference.region.x).toBeLessThanOrEqual(1);
        expect(difference.region.y).toBeGreaterThanOrEqual(0);
        expect(difference.region.y).toBeLessThanOrEqual(1);
        expect(difference.region.radius).toBeLessThanOrEqual(0.055);
        for (const region of soloRegions(difference)) {
          expect(region.radius).toBeGreaterThan(0);
          expect(region.radius).toBeLessThanOrEqual(0.055);
          expect(region.x - region.radius).toBeGreaterThanOrEqual(0);
          expect(region.x + region.radius).toBeLessThanOrEqual(1);
          expect(region.y - region.radius).toBeGreaterThanOrEqual(0);
          expect(region.y + region.radius).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("keeps every answer selectable when mobile touch targets overlap", () => {
    for (const puzzle of SOLO_PUZZLES) {
      for (const difference of puzzle.differences) {
        expect(
          findSoloDifference(puzzle.differences, new Set(), difference.region, 0.08)?.id,
          `${puzzle.id}/${difference.id}`,
        ).toBe(difference.id);
      }
    }
  });

  it("keeps every extra hit area tied to its own difference", () => {
    for (const puzzle of SOLO_PUZZLES) {
      for (const difference of puzzle.differences) {
        for (const region of soloRegions(difference)) {
          expect(findSoloDifference(puzzle.differences, new Set(), region)?.id, `${puzzle.id}/${difference.id}`).toBe(difference.id);
        }
      }
    }
  });

  it("accepts both clock hands and the whole multi-part objects that changed", () => {
    const hit = (puzzleId: string, x: number, y: number) =>
      findSoloDifference(SOLO_PUZZLES.find((puzzle) => puzzle.id === puzzleId)!.differences, new Set(), { x, y })?.id;
    // Alpine station clock: upper-left hand tip and lower-right hand tip.
    expect(hit("alpine-station", 0.296, 0.104)).toBe("station-clock");
    expect(hit("alpine-station", 0.350, 0.155)).toBe("station-clock");
    expect(hit("greenhouse", 0.20, 0.71)).toBe("greenhouse-watering-can");
    expect(hit("observatory", 0.37, 0.90)).toBe("observatory-magnifier");
    expect(hit("alpine-station", 0.912, 0.44)).toBe("station-flower-basket");
    expect(hit("clockmaker", 0.954, 0.656)).toBe("clockmaker-hourglass");
  });

  it("matches the versioned asset hashes", async () => {
    for (const puzzle of SOLO_PUZZLES) {
      expect(puzzle.metadata.generator).toBe("OpenAI ImageGen");
      expect(puzzle.metadata.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
      for (const asset of [puzzle.metadata.original, puzzle.metadata.modified]) {
        const path = fileURLToPath(new URL(`../../../assets/puzzles/solo/${asset.fileName}`, import.meta.url));
        const digest = createHash("sha256").update(await readFile(path)).digest("hex").toUpperCase();
        expect(digest, `${puzzle.id}/${asset.fileName}`).toBe(asset.sha256);
      }
    }
  });
});
