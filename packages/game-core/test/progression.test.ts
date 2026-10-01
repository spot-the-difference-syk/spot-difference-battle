import {
  COSMETIC_ITEMS,
  COSMETIC_SLOTS,
  DEFAULT_LOADOUT,
  PROGRESSION_RULES,
  buyCosmetic,
  equipCosmetic,
  emptyGrowth,
  settleMatch,
  DAILY_GOALS,
  dailyGoalFor,
  koreanDay,
  grantSoloReward,
  growthView,
  normalizeGrowth,
  xpForLevel,
} from "@spot-battle/shared";
import { describe, expect, it } from "vitest";

const finished = (winnerId: string | null, endReason: "COMPLETED" | "TIMEOUT" | "FORFEIT" = "COMPLETED") =>
  ({ state: "FINISHED" as const, winnerId, endReason });
const noJourney = { completedKeys: [], found: 0 };
const grantMatchReward = (growth: ReturnType<typeof emptyGrowth>, matchId: string, snapshot: Parameters<typeof settleMatch>[2], playerId: string) => {
  const settled = settleMatch(growth, matchId, snapshot, playerId, noJourney);
  return settled?.reward ? { progress: settled.progress, reward: settled.reward } : null;
};

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
    expect(grantMatchReward(emptyGrowth(), "m1", finished(null, "TIMEOUT"), "b")!.reward).toMatchObject({ reason: "DRAW", xp: 60, coins: 60 });
  });

  it("records stats and collection for every finished match, even a forfeit", () => {
    const journey = { completedKeys: ["game:cozy-cafe", "game:cyber-city", "game:Not A Puzzle"], found: 7 };
    const forfeited = settleMatch(emptyGrowth(), "m1", finished("a", "FORFEIT"), "b", journey)!;
    expect(forfeited.reward).toBeNull();
    expect(forfeited.progress).toMatchObject({ totalXp: 0, coins: 0, stats: { matches: 1, losses: 1, differencesFound: 7 }, collected: ["game:cozy-cafe", "game:cyber-city"] });
    expect(settleMatch(forfeited.progress, "m1", finished("a", "FORFEIT"), "b", journey)).toBeNull();
    const won = settleMatch(emptyGrowth(), "m2", finished("a"), "a", journey)!;
    expect(won.reward).toMatchObject({ reason: "WIN", newlyCollected: ["game:cozy-cafe", "game:cyber-city"] });
  });

  it("pays the daily goal bonus once when today's goal is reached", () => {
    const day = Date.UTC(2026, 9, 1, 3);
    const goal = dailyGoalFor(koreanDay(day));
    let growth = emptyGrowth();
    let bonuses = 0;
    for (let i = 0; i < 25; i += 1) {
      const settled = goal.metric === "soloClears"
        ? grantSoloReward(growth, 40_000, day)
        : settleMatch(growth, `m${i}`, finished("a"), "a", { completedKeys: [], found: 3 }, day)!;
      growth = settled.progress;
      if (settled.reward?.dailyGoal) bonuses += 1;
    }
    expect(bonuses).toBe(1);
    expect(growthView(growth, day).daily).toMatchObject({ id: goal.id, done: true });
    expect(growthView(growth, day + 86_400_000).daily.done).toBe(false);
    expect(DAILY_GOALS.length).toBeGreaterThan(1);
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
      ownedItems: [], loadout: DEFAULT_LOADOUT,
      stats: { matches: 0, wins: 0, draws: 0, losses: 0, soloClears: 0, differencesFound: 0 }, collected: [], daily: null,
    });
    expect(normalizeGrowth({ ownedItems: ["frame-wood", "nope"], loadout: { frame: "marker-ring", title: "title-detective" } })).toMatchObject({
      ownedItems: ["frame-wood"],
      loadout: { ...DEFAULT_LOADOUT, title: "title-detective" },
    });
  });

  it("buys and equips cosmetics only when level and coins allow", () => {
    const rich = { ...emptyGrowth(), coins: 2_000 };
    expect(buyCosmetic(rich, 1, "frame-gold")).toMatchObject({ ok: false, code: "ITEM_LOCKED" });
    expect(buyCosmetic({ ...rich, coins: 700 }, 1, "frame-wood")).toMatchObject({ ok: false, code: "NOT_ENOUGH_COINS" });
    expect(buyCosmetic(rich, 1, "marker-viewfinder")).toMatchObject({ ok: false, code: "ITEM_OWNED" });
    const bought = buyCosmetic(rich, 1, "frame-wood");
    expect(bought).toMatchObject({ ok: true, growth: { coins: 1_200, ownedItems: ["frame-wood"], loadout: { frame: "frame-wood" } } });
    if (!bought.ok) throw new Error("purchase failed");
    expect(buyCosmetic(bought.growth, 1, "frame-wood")).toMatchObject({ ok: false, code: "ITEM_OWNED" });
    expect(equipCosmetic(bought.growth, 1, "frame-none")).toMatchObject({ ok: true, growth: { loadout: { frame: "frame-none" } } });
    expect(equipCosmetic(rich, 1, "title-detective")).toMatchObject({ ok: false, code: "ITEM_NOT_OWNED" });
    expect(equipCosmetic(rich, 4, "title-eye")).toMatchObject({ ok: false, code: "ITEM_LOCKED" });
    expect(equipCosmetic(rich, 5, "title-eye")).toMatchObject({ ok: true, growth: { loadout: { title: "title-eye" } } });
    expect(growthView({ ...rich, totalXp: 0 }).ownedItemIds).toEqual(COSMETIC_ITEMS.filter((item) => item.price === 0 && item.minLevel === 1).map((item) => item.id));
  });

  it("gives every slot a free default item", () => {
    for (const slot of COSMETIC_SLOTS) {
      const fallback = COSMETIC_ITEMS.find((item) => item.id === DEFAULT_LOADOUT[slot]);
      expect(fallback).toMatchObject({ slot, price: 0, minLevel: 1 });
    }
  });
});
