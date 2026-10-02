import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOLO_PUZZLES, SOLO_PUZZLE_IDS } from "./catalog";

describe("solo puzzle catalog", () => {
  it("ships five distinct solo puzzles without answers", () => {
    expect(SOLO_PUZZLES).toHaveLength(5);
    expect(SOLO_PUZZLES.map((puzzle) => puzzle.id)).toEqual(SOLO_PUZZLE_IDS);
    for (const puzzle of SOLO_PUZZLES) expect(puzzle.originalSrc).not.toBe(puzzle.modifiedSrc);
    // 정답은 서버만 가진다(랭킹 기록을 서버가 재므로).
    expect(JSON.stringify(SOLO_PUZZLES)).not.toContain("region");
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
