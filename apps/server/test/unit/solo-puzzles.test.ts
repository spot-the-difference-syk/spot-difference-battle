import { BUNDLED_SOLO_PUZZLES, SOLO_RULES, findSoloAnswer, soloRegions } from "@spot-battle/shared";
import { describe, expect, it } from "vitest";
import { BUNDLED_SOLO_ANSWERS } from "../../src/game/solo-puzzles.js";

/** 솔로 정답은 서버에만 있다. 판정 품질은 여기서 확인한다. */
describe("bundled solo answers", () => {
  it("has five distinct tight answers for every bundled solo puzzle", () => {
    expect(BUNDLED_SOLO_ANSWERS.map((puzzle) => puzzle.id)).toEqual(BUNDLED_SOLO_PUZZLES.map((puzzle) => puzzle.id));
    for (const puzzle of BUNDLED_SOLO_ANSWERS) {
      expect(puzzle.version).toBe(BUNDLED_SOLO_PUZZLES.find((card) => card.id === puzzle.id)!.version);
      expect(puzzle.answers).toHaveLength(SOLO_RULES.differences);
      expect(new Set(puzzle.answers.map((answer) => answer.id)).size).toBe(SOLO_RULES.differences);
      for (const answer of puzzle.answers) {
        for (const region of soloRegions(answer)) {
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
    for (const puzzle of BUNDLED_SOLO_ANSWERS) {
      for (const answer of puzzle.answers) {
        expect(findSoloAnswer(puzzle.answers, new Set(), answer.region, SOLO_RULES.maxTouchRadius)?.id, `${puzzle.id}/${answer.id}`).toBe(answer.id);
      }
    }
  });

  it("keeps every extra hit area tied to its own difference", () => {
    for (const puzzle of BUNDLED_SOLO_ANSWERS) {
      for (const answer of puzzle.answers) {
        for (const region of soloRegions(answer)) {
          expect(findSoloAnswer(puzzle.answers, new Set(), region)?.id, `${puzzle.id}/${answer.id}`).toBe(answer.id);
        }
      }
    }
  });

  it("accepts both clock hands and the whole multi-part objects that changed", () => {
    const hit = (puzzleId: string, x: number, y: number) =>
      findSoloAnswer(BUNDLED_SOLO_ANSWERS.find((puzzle) => puzzle.id === puzzleId)!.answers, new Set(), { x, y })?.id;
    expect(hit("alpine-station", 0.296, 0.104)).toBe("station-clock");
    expect(hit("alpine-station", 0.350, 0.155)).toBe("station-clock");
    expect(hit("greenhouse", 0.20, 0.71)).toBe("greenhouse-watering-can");
    expect(hit("observatory", 0.37, 0.90)).toBe("observatory-magnifier");
    expect(hit("alpine-station", 0.912, 0.44)).toBe("station-flower-basket");
    expect(hit("clockmaker", 0.954, 0.656)).toBe("clockmaker-hourglass");
  });
});
