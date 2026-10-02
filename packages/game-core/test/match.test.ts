import { describe, expect, it } from "vitest";
import { GameMatch, GameRuleError, type MatchPuzzle } from "../src/index.js";

const puzzles: MatchPuzzle[] = [
  { id: "enchanted-forest", assetVersion: "forest-v1", differences: [
    { id: "a", label: "A", regions: [{ x: 0.2, y: 0.2, radius: 0.05 }] },
    { id: "b", label: "B", regions: [{ x: 0.5, y: 0.5, radius: 0.05 }] },
    { id: "c", label: "C", regions: [{ x: 0.8, y: 0.8, radius: 0.05 }] },
  ] },
  { id: "underwater-treasure", assetVersion: "underwater-v1", differences: [
    { id: "d", label: "D", regions: [{ x: 0.2, y: 0.8, radius: 0.05 }] },
    { id: "e", label: "E", regions: [{ x: 0.5, y: 0.2, radius: 0.05 }] },
    { id: "f", label: "F", regions: [{ x: 0.8, y: 0.5, radius: 0.05 }] },
  ] },
];

function createMatch() {
  return new GameMatch("match-1", puzzles, [
    { playerId: "p1", nickname: "첫째" },
    { playerId: "p2", nickname: "둘째" },
  ]);
}

function startPlaying(match: GameMatch, now = 1_000) {
  match.markReady("p1", now);
  match.markReady("p2", now);
  expect(match.currentState).toBe("PRELOADING");
  match.markLoaded("p1", "enchanted-forest", "forest-v1", now + 100);
  match.markLoaded("p2", "enchanted-forest", "forest-v1", now + 100);
  expect(match.currentState).toBe("COUNTDOWN");
  match.expire(now + 3_100);
  expect(match.currentState).toBe("PLAYING");
  return now + 3_100;
}

describe("GameMatch simultaneous race", () => {
  it("cancels when the ready deadline expires", () => {
    const match = new GameMatch("match-ready-timeout", puzzles, [
      { playerId: "p1", nickname: "첫째" },
      { playerId: "p2", nickname: "둘째" },
    ], 1_000);
    expect(match.expire(31_000)).toBe(true);
    expect(match.snapshot("p1")).toMatchObject({ state: "CANCELLED", endReason: "CANCELLED" });
  });

  it("rejects a load acknowledgement at or after the preload deadline", () => {
    const match = new GameMatch("match-load-timeout", puzzles, [
      { playerId: "p1", nickname: "첫째" },
      { playerId: "p2", nickname: "둘째" },
    ], 1_000);
    match.markReady("p1", 1_100);
    match.markReady("p2", 1_100);
    expect(() => match.markLoaded("p1", "enchanted-forest", "forest-v1", 16_100)).toThrowError(GameRuleError);
    expect(match.snapshot("p1")).toMatchObject({ state: "CANCELLED", endReason: "CANCELLED" });
  });
  it("rejects a client that loaded a different puzzle asset version", () => {
    const match = createMatch();
    match.markReady("p1", 1_000);
    match.markReady("p2", 1_000);
    expect(() => match.markLoaded("p1", "enchanted-forest", "stale-version", 1_100))
      .toThrowError(/버전이 서버와 다릅니다/);
    expect(match.currentState).toBe("PRELOADING");
  });
  it("starts only after both players load the same first puzzle", () => {
    const match = createMatch();
    match.markReady("p1", 1_000);
    match.markReady("p2", 1_000);
    match.markLoaded("p1", "enchanted-forest", "forest-v1", 1_100);
    expect(match.currentState).toBe("PRELOADING");
    match.markLoaded("p2", "enchanted-forest", "forest-v1", 1_100);
    expect(match.currentState).toBe("COUNTDOWN");
  });

  it("lets both players find independently and advances only the player who found all three", () => {
    const match = createMatch();
    const now = startPlaying(match);
    match.guess("p1", "enchanted-forest", { x: 0.2, y: 0.2 }, now + 10);
    match.guess("p1", "enchanted-forest", { x: 0.5, y: 0.5 }, now + 20);
    const completed = match.guess("p1", "enchanted-forest", { x: 0.8, y: 0.8 }, now + 30);
    expect(completed).toMatchObject({ correct: true, puzzleCompleted: true, currentPuzzleId: "underwater-treasure" });
    expect(match.snapshot("p1").players[0]).toMatchObject({ completedPuzzleCount: 1, foundCount: 0, totalFoundCount: 3 });
    expect(match.snapshot("p2").currentPuzzleId).toBe("enchanted-forest");
    expect(match.snapshot("p2")).toMatchObject({ currentPuzzleVersion: "forest-v1", nextPuzzleVersion: "underwater-v1" });
  });

  it.each(["p1", "p2"])("finishes as soon as %s clears the deck and rejects later guesses", (winnerId) => {
    const match = createMatch();
    let now = startPlaying(match);
    const loserId = winnerId === "p1" ? "p2" : "p1";
    match.guess(loserId, "enchanted-forest", { x: 0.2, y: 0.2 }, ++now);
    for (const puzzle of puzzles) {
      for (const difference of puzzle.differences) {
        match.guess(winnerId, puzzle.id, difference.regions[0]!, ++now);
      }
    }
    for (const viewer of [winnerId, loserId]) {
      expect(match.snapshot(viewer)).toMatchObject({ state: "FINISHED", endReason: "COMPLETED", winnerId });
    }
    const snapshot = match.snapshot(winnerId);
    const winner = snapshot.players.find((player) => player.playerId === winnerId)!;
    const loser = snapshot.players.find((player) => player.playerId === loserId)!;
    expect(winner).toMatchObject({ completedAllPuzzles: true, totalFoundCount: 6 });
    expect(winner.timeBonus).toBeGreaterThan(0);
    expect(winner.score).toBe(60 + winner.timeBonus);
    expect(loser).toMatchObject({ completedAllPuzzles: false, totalFoundCount: 1, timeBonus: 0 });
    expect(() => match.guess(loserId, "enchanted-forest", { x: 0.5, y: 0.5 }, ++now)).toThrowError(GameRuleError);
    expect(GameMatch.restore(match.serialize()).snapshot(loserId)).toMatchObject({ state: "FINISHED", winnerId });
  });

  it("supports a different number of differences in each puzzle", () => {
    const variablePuzzles: MatchPuzzle[] = [
      { ...puzzles[0]!, differences: puzzles[0]!.differences.slice(0, 2) },
      puzzles[1]!,
    ];
    const match = new GameMatch("variable", variablePuzzles, [
      { playerId: "p1", nickname: "첫째" },
      { playerId: "p2", nickname: "둘째" },
    ]);
    const now = startPlaying(match);
    match.guess("p1", "enchanted-forest", { x: 0.2, y: 0.2 }, now + 10);
    match.guess("p1", "enchanted-forest", { x: 0.5, y: 0.5 }, now + 20);
    expect(match.snapshot("p1")).toMatchObject({ totalDifferenceCount: 5 });
    expect(match.snapshot("p1").players[0]).toMatchObject({ completedPuzzleCount: 1, totalFoundCount: 2, currentDifferenceCount: 3 });
  });

  it("locks wrong input for one second without subtracting time", () => {
    const match = createMatch();
    const now = startPlaying(match);
    const wrong = match.guess("p1", "enchanted-forest", { x: 0.95, y: 0.1 }, now + 10);
    expect(wrong).toMatchObject({ correct: false, inputLockedUntilMs: now + 1_010 });
    expect(() => match.guess("p1", "enchanted-forest", { x: 0.2, y: 0.2 }, now + 500)).toThrowError(GameRuleError);
    expect(match.guess("p1", "enchanted-forest", { x: 0.2, y: 0.2 }, now + 1_011).correct).toBe(true);
  });

  it("keeps unseen answers private and restores active progress", () => {
    const match = createMatch();
    const now = startPlaying(match);
    match.guess("p1", "enchanted-forest", { x: 0.2, y: 0.2 }, now + 10);
    const snapshot = match.snapshot("p1");
    expect(snapshot.revealedDifferences).toBeNull();
    expect(snapshot.foundMarks).toHaveLength(1);
    const restored = GameMatch.restore(match.serialize());
    expect(restored.snapshot("p1")).toMatchObject({ state: "PLAYING", myFoundIds: ["a"] });
  });

  it("exposes full progress only for the snapshot viewer", () => {
    const match = createMatch();
    const now = startPlaying(match);
    match.guess("p1", "enchanted-forest", { x: 0.95, y: 0.1 }, now + 10);
    match.guess("p2", "enchanted-forest", { x: 0.2, y: 0.2 }, now + 10);
    const snapshot = match.snapshot("p1");
    const self = snapshot.players.find((player) => player.playerId === "p1")!;
    const opponent = snapshot.players.find((player) => player.playerId === "p2")!;
    expect(self).toMatchObject({ perspective: "SELF", puzzleIndex: 0, totalFoundCount: 0, wrongAnswerCount: 1 });
    expect(opponent).toMatchObject({ perspective: "OPPONENT", completedPuzzleCount: 0, foundCount: 1 });
    expect(opponent).toMatchObject({ totalFoundCount: 1, currentDifferenceCount: 3 });
    for (const field of ["puzzleIndex", "wrongAnswerCount", "inputLockedUntilMs"]) {
      expect(opponent).not.toHaveProperty(field);
    }
  });

  it("returns DUPLICATE without changing match state", () => {
    const match = createMatch();
    const now = startPlaying(match);
    expect(match.guess("p1", "enchanted-forest", { x: 0.2, y: 0.2 }, now + 10).outcome).toBe("CORRECT");
    const version = match.version;
    expect(match.guess("p1", "enchanted-forest", { x: 0.2, y: 0.2 }, now + 20)).toMatchObject({
      outcome: "DUPLICATE",
      correct: true,
    });
    expect(match.version).toBe(version);
  });

  it("rejects invalid puzzle identities and answer regions", () => {
    const invalidPuzzles: MatchPuzzle[] = [{
      id: "enchanted-forest",
      assetVersion: "forest-v1",
      differences: [
        { id: "same", label: "A", regions: [{ x: 0.2, y: 0.2, radius: 0.05 }] },
        { id: "same", label: "B", regions: [{ x: 0.5, y: 0.5, radius: 0.05 }] },
        { id: "c", label: "C", regions: [{ x: 0.8, y: 0.8, radius: 0.05 }] },
      ],
    }];
    expect(() => new GameMatch("bad-id", invalidPuzzles, [
      { playerId: "p1", nickname: "첫째" },
      { playerId: "p2", nickname: "둘째" },
    ])).toThrowError(GameRuleError);

    invalidPuzzles[0]!.differences[1] = {
      id: "b",
      label: "B",
      regions: [{ x: 0.2, y: 0.2, radius: 0.05 }, { x: 0.5, y: 0.5, radius: 0.05 }],
    };
    expect(() => new GameMatch("bad-regions", invalidPuzzles, [
      { playerId: "p1", nickname: "첫째" },
      { playerId: "p2", nickname: "둘째" },
    ])).toThrowError(GameRuleError);
  });
  it("awards a forfeit win to the connected opponent", () => {
    const match = createMatch();
    startPlaying(match);
    match.forfeit("p1");
    expect(match.snapshot("p2")).toMatchObject({ state: "FINISHED", winnerId: "p2", endReason: "FORFEIT" });
  });

  it("uses the selected mode duration", () => {
    const match = new GameMatch("sprint", puzzles, [
      { playerId: "p1", nickname: "첫째" },
      { playerId: "p2", nickname: "둘째" },
    ], 1_000, { mode: "SPRINT" });
    const startedAt = startPlaying(match);
    expect(match.snapshot("p1").settings).toEqual({ mode: "SPRINT" });
    expect(match.expire(startedAt + 59_999)).toBe(false);
    expect(match.expire(startedAt + 60_000)).toBe(true);
    expect(match.snapshot("p1")).toMatchObject({ state: "FINISHED", endReason: "TIMEOUT" });
  });

  it("ends survival mode when a player reaches three wrong answers", () => {
    const match = new GameMatch("survival", puzzles, [
      { playerId: "p1", nickname: "첫째" },
      { playerId: "p2", nickname: "둘째" },
    ], 1_000, { mode: "SURVIVAL" });
    const now = startPlaying(match);
    match.guess("p1", "enchanted-forest", { x: 0.95, y: 0.1 }, now + 10);
    match.guess("p1", "enchanted-forest", { x: 0.95, y: 0.1 }, now + 1_011);
    const finalWrong = match.guess("p1", "enchanted-forest", { x: 0.95, y: 0.1 }, now + 2_012);
    expect(finalWrong.matchFinished).toBe(true);
    expect(match.snapshot("p1")).toMatchObject({ state: "FINISHED", winnerId: "p2", endReason: "MISTAKE_LIMIT" });
  });

  it("uses one hit radius and a one-second wrong-answer lock, and drops the difficulty of old saved matches", () => {
    const players = [
      { playerId: "p1", nickname: "첫째" },
      { playerId: "p2", nickname: "둘째" },
    ] as [{ playerId: string; nickname: string }, { playerId: string; nickname: string }];
    const match = new GameMatch("one-rule", puzzles, players, 1_000, { mode: "STANDARD" });
    const now = startPlaying(match);
    // 예전 '쉬움'에서만 맞던 자리는 이제 오답이고 잠금은 1초다.
    expect(match.guess("p1", "enchanted-forest", { x: 0.255, y: 0.2 }, now + 10)).toMatchObject({ correct: false, inputLockedUntilMs: now + 1_010 });
    const saved = { ...match.serialize(), settings: { mode: "SPRINT", difficulty: "HARD" } } as unknown as ReturnType<GameMatch["serialize"]>;
    expect(GameMatch.restore(saved).snapshot("p1").settings).toEqual({ mode: "SPRINT" });
  });
});
