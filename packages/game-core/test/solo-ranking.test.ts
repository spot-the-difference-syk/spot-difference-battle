import {
  RANKING_RULES,
  SOLO_RULES,
  buyCosmetic,
  emptyGrowth,
  equipCosmetic,
  grantRankingReward,
  grantSoloReward,
  guessSoloRun,
  koreanWeekKey,
  normalizeGrowth,
  previousWeekKey,
  rankingPayload,
  startSoloRun,
  submitRecord,
  weeklyRewards,
  type RankEntry,
  type SoloAnswer,
} from "@spot-battle/shared";
import { describe, expect, it } from "vitest";

const answers: SoloAnswer[] = [
  { id: "a", label: "가", region: { x: 0.2, y: 0.2, radius: 0.05 } },
  { id: "b", label: "나", region: { x: 0.8, y: 0.2, radius: 0.05 }, extraRegions: [{ x: 0.9, y: 0.3, radius: 0.04 }] },
  { id: "c", label: "다", region: { x: 0.5, y: 0.5, radius: 0.05 } },
  { id: "d", label: "라", region: { x: 0.2, y: 0.8, radius: 0.05 } },
  { id: "e", label: "마", region: { x: 0.8, y: 0.8, radius: 0.05 } },
];

const entry = (playerId: string, elapsedMs: number, recordedAt = 0): RankEntry => ({
  playerId, nickname: playerId, elapsedMs, recordedAt, avatar: "avatar-initial", profile: "profile-none", title: "title-visitor",
});

describe("server-judged solo run", () => {
  it("times the run on the server, adds the wrong-answer penalty and finishes after five answers", () => {
    let run = startSoloRun("r", { id: "p", version: "1" }, 1_000);
    expect(run.startsAtMs).toBe(1_000 + SOLO_RULES.countdownMs);
    expect(guessSoloRun(run, answers, { point: { x: 0.2, y: 0.2 } }, 2_000)).toMatchObject({ ok: false, code: "SOLO_NOT_STARTED" });
    let now = run.startsAtMs + 5_000;
    const wrong = guessSoloRun(run, answers, { point: { x: 0.01, y: 0.99 } }, now);
    if (!wrong.ok) throw new Error(wrong.message);
    expect(wrong).toMatchObject({ correct: false, run: { wrongCount: 1 } });
    run = wrong.run;
    expect(guessSoloRun(run, answers, { point: { x: 0.2, y: 0.2 } }, now + 50)).toMatchObject({ ok: false, code: "INPUT_RATE_LIMITED" });
    expect(guessSoloRun(run, answers, { point: { x: 2, y: 0 } }, now + 500)).toMatchObject({ ok: false, code: "INVALID_POINT" });
    // 큰 정답의 다른 부분을 눌러도 같은 정답이고, 표시는 주 영역에 한다.
    const extra = guessSoloRun(run, answers, { point: { x: 0.9, y: 0.3 } }, now += 500);
    expect(extra).toMatchObject({ ok: true, correct: true, mark: { differenceId: "b", region: { x: 0.8, y: 0.2 }, label: "나" } });
    if (!extra.ok) throw new Error(extra.message);
    run = extra.run;
    // 이미 찾은 곳을 다시 누르면 오답이다.
    const again = guessSoloRun(run, answers, { point: { x: 0.8, y: 0.2 } }, now += 500);
    expect(again).toMatchObject({ ok: true, correct: false });
    if (!again.ok) throw new Error(again.message);
    run = again.run;
    let last;
    for (const point of [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }]) {
      last = guessSoloRun(run, answers, { point }, now += 500);
      if (!last.ok) throw new Error(last.message);
      run = last.run;
    }
    expect(last).toMatchObject({ correct: true, elapsedMs: now - run.startsAtMs + 2 * SOLO_RULES.wrongPenaltyMs });
    expect(guessSoloRun(run, answers, { point: { x: 0.5, y: 0.5 } }, now + 500)).toMatchObject({ ok: false, code: "SOLO_FINISHED" });
  });

  it("gives touch input a finger-sized target but keeps mouse input exact, and expires stale runs", () => {
    const run = startSoloRun("r", { id: "p", version: "1" }, 0);
    const near = { x: 0.565, y: 0.5 };
    expect(guessSoloRun(run, answers, { point: near, pointerType: "mouse", boardSizePx: 320 }, run.startsAtMs)).toMatchObject({ correct: false });
    expect(guessSoloRun(run, answers, { point: near, pointerType: "touch", boardSizePx: 320 }, run.startsAtMs)).toMatchObject({ correct: true });
    // 화면 크기를 터무니없이 작게 보내도 판정 반경은 상한을 넘지 않는다.
    expect(guessSoloRun(run, answers, { point: { x: 0.5, y: 0.62 }, pointerType: "touch", boardSizePx: 1 }, run.startsAtMs)).toMatchObject({ correct: false });
    expect(guessSoloRun(run, answers, { point: near }, run.startsAtMs + SOLO_RULES.maxRunMs + 1)).toMatchObject({ ok: false, code: "SOLO_EXPIRED" });
  });
});

describe("solo leaderboard", () => {
  it("starts each week on Monday 0:00 in Korea", () => {
    // 2026-09-27(일) 15:00 UTC = 2026-09-28(월) 0:00 KST
    expect(koreanWeekKey(Date.parse("2026-09-27T14:59:59Z"))).toBe("2026-09-21");
    expect(koreanWeekKey(Date.parse("2026-09-27T15:00:00Z"))).toBe("2026-09-28");
    expect(previousWeekKey("2026-09-28")).toBe("2026-09-21");
  });

  it("keeps one best record per player, earlier record wins a tie, and trims the board", () => {
    let board: RankEntry[] = [];
    board = submitRecord(board, entry("a", 20_000, 1)).board;
    board = submitRecord(board, entry("b", 15_000, 2)).board;
    board = submitRecord(board, entry("c", 15_000, 3)).board;
    expect(board.map((row) => row.playerId)).toEqual(["b", "c", "a"]);
    const slower = submitRecord(board, { ...entry("b", 30_000, 4), nickname: "새이름" });
    expect(slower.improved).toBe(false);
    expect(slower.board[0]).toMatchObject({ playerId: "b", elapsedMs: 15_000, nickname: "새이름" });
    const faster = submitRecord(board, entry("a", 10_000, 5));
    expect(faster.improved).toBe(true);
    expect(faster.board.map((row) => row.playerId)).toEqual(["a", "b", "c"]);
    expect(submitRecord(board, entry("d", 99_000), 3)).toMatchObject({ improved: false, board: { length: 3 } });
  });

  it("shows the top rows without player IDs and my rank even outside them", () => {
    const board = Array.from({ length: RANKING_RULES.listSize + 5 }, (_, index) => entry(`p${index}`, 10_000 + index));
    const payload = rankingPayload(board, { puzzleId: "p", period: "all", weekKey: null }, { playerId: "p52", bestMs: 10_052 });
    expect(payload.rows).toHaveLength(RANKING_RULES.listSize);
    expect(JSON.stringify(payload.rows)).not.toContain("playerId");
    expect(payload).toMatchObject({ participants: 55, me: { rank: 53, elapsedMs: 10_052 } });
    expect(rankingPayload([], { puzzleId: "p", period: "week", weekKey: "2026-09-28" }, { playerId: "x", bestMs: null }).me).toBeNull();
  });

  it("rewards the weekly top players once, best tier across puzzles, only with enough participants", () => {
    const busy = Array.from({ length: 20 }, (_, index) => entry(`p${index}`, 10_000 + index * 100));
    const quiet = [entry("p5", 1_000), entry("solo", 2_000)];
    const grants = weeklyRewards("2026-09-21", [{ puzzleId: "busy", entries: busy }, { puzzleId: "quiet", entries: quiet }]);
    expect(grants.map((grant) => [grant.playerId, grant.tier, grant.rank])).toEqual([
      ["p0", "champion", 1], ["p1", "podium", 2], ["p2", "podium", 3],
    ]);
    // 참가자가 적은 그림은 보상이 없고, 상위 10%는 20명 중 2위까지라 2~3위 보상과 겹친다.
    expect(grants.some((grant) => grant.puzzleId === "quiet")).toBe(false);
    const big = Array.from({ length: 50 }, (_, index) => entry(`q${index}`, 10_000 + index));
    const bigGrants = weeklyRewards("2026-09-21", [{ puzzleId: "big", entries: big }, { puzzleId: "busy", entries: [entry("q4", 1), ...busy.slice(0, 4)] }]);
    expect(bigGrants.find((grant) => grant.playerId === "q4")).toMatchObject({ tier: "champion", puzzleId: "busy" });
    expect(bigGrants.find((grant) => grant.playerId === "q3")).toMatchObject({ tier: "top10", coins: 150, titleId: "title-weekly-top" });
    expect(bigGrants.find((grant) => grant.playerId === "q5")).toBeUndefined();
  });
});

describe("ranking rewards and growth", () => {
  it("pays a weekly reward once and unlocks the reward-only title", () => {
    const grant = { playerId: "p", weekKey: "2026-09-21", tier: "champion" as const, label: "주간 1위", rank: 1, puzzleId: "observatory", coins: 600, titleId: "title-weekly-champion" };
    expect(buyCosmetic({ ...emptyGrowth(), coins: 9_999 }, 30, "title-weekly-champion")).toMatchObject({ ok: false, code: "ITEM_REWARD_ONLY" });
    expect(equipCosmetic(emptyGrowth(), 30, "title-weekly-champion")).toMatchObject({ ok: false, code: "ITEM_REWARD_ONLY" });
    const granted = grantRankingReward(emptyGrowth(), grant, 0)!;
    expect(granted.reward).toMatchObject({ reason: "RANKING", coins: 600, xp: 0, ranking: { newTitle: true } });
    expect(granted.progress).toMatchObject({ coins: 600, ownedItems: ["title-weekly-champion"], rankingRewardWeeks: ["2026-09-21"] });
    expect(grantRankingReward(granted.progress, grant, 0)).toBeNull();
    expect(equipCosmetic(granted.progress, 1, "title-weekly-champion")).toMatchObject({ ok: true, growth: { loadout: { title: "title-weekly-champion" } } });
  });

  it("remembers the best solo time per puzzle and drops impossible stored values", () => {
    let growth = grantSoloReward(emptyGrowth(), 20_000, 0, "observatory").progress;
    growth = grantSoloReward(growth, 25_000, 0, "observatory").progress;
    growth = grantSoloReward(growth, 18_000, 0, "observatory").progress;
    expect(growth.soloBests).toEqual({ observatory: 18_000 });
    expect(normalizeGrowth({ soloBests: { observatory: 12_345, fake: 10, "Bad Id": 9_000 } }).soloBests).toEqual({ observatory: 12_345 });
  });
});
