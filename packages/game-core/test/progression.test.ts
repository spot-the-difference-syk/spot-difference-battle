import {
  PROGRESSION_RULES,
  emptyGrowth,
  grantMatchReward,
  grantSoloReward,
  growthView,
  normalizeGrowth,
  xpForLevel,
} from "@spot-battle/shared";
import { describe, expect, it } from "vitest";

const finished = (winnerId: string | null, endReason: "COMPLETED" | "TIMEOUT" | "FORFEIT" = "COMPLETED") =>
  ({ state: "FINISHED" as const, winnerId, endReason });

describe("player growth", () => {
  it("needs a little more experience for each level", () => {
    expect(xpForLevel(1)).toBe(100);
    expect(xpForLevel(2)).toBe(120);
    expect(growthView({ ...emptyGrowth(), totalXp: 0 })).toMatchObject({ level: 1, levelXp: 0, levelXpGoal: 100 });
    expect(growthView({ ...emptyGrowth(), totalXp: 219 })).toMatchObject({ level: 2, levelXp: 119, levelXpGoal: 120 });
    expect(growthView({ ...emptyGrowth(), totalXp: 220 })).toMatchObject({ level: 3, levelXp: 0, levelXpGoal: 140 });
  });

  it("pays win, loss and draw rewards exactly once per match", () => {
    const win = grantMatchReward(emptyGrowth(), "m1", finished("a"), "a")!;
    expect(win.reward).toMatchObject({ reason: "WIN", xp: 100, coins: 120, leveledUp: true });
    expect(grantMatchReward(win.progress, "m1", finished("a"), "a")).toBeNull();
    expect(grantMatchReward(emptyGrowth(), "m1", finished("a"), "b")!.reward).toMatchObject({ reason: "LOSS", xp: 40, coins: 30 });
    expect(grantMatchReward(emptyGrowth(), "m1", finished(null, "TIMEOUT"), "b")!.reward).toMatchObject({ reason: "DRAW" });
  });

  it("does not reward forfeits or cancelled matches", () => {
    expect(grantMatchReward(emptyGrowth(), "m1", finished("a", "FORFEIT"), "b")).toBeNull();
    expect(grantMatchReward(emptyGrowth(), "m1", { state: "CANCELLED", winnerId: null, endReason: null }, "a")).toBeNull();
  });

  it("limits solo rewards per Korean day and ignores impossible records", () => {
    const day = Date.UTC(2026, 9, 1, 3);
    let growth = emptyGrowth();
    for (let i = 0; i < PROGRESSION_RULES.soloDailyLimit; i += 1) growth = grantSoloReward(growth, 40_000, day).progress;
    const blocked = grantSoloReward(growth, 40_000, day);
    expect(blocked.reward).toBeNull();
    expect(blocked.limitReached).toBe(true);
    expect(grantSoloReward(growth, 40_000, day + 24 * 60 * 60 * 1_000).reward).not.toBeNull();
    expect(grantSoloReward(emptyGrowth(), 100, day).reward).toBeNull();
  });

  it("repairs corrupted stored values", () => {
    expect(normalizeGrowth({ totalXp: -5, coins: "x", rewardedMatchIds: [1, "m"] })).toEqual({
      totalXp: 0, coins: 0, rewardedMatchIds: ["m"], soloRewardDay: null, soloRewardCount: 0,
    });
  });
});
