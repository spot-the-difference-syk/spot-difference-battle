import { GameMatch } from "@spot-battle/game-core";
import { GAME_PUZZLES } from "../../src/game/puzzle-catalog.js";
import type { ClientToServerEvents, GameErrorPayload, GameSnapshot, MatchFoundPayload, ServerToClientEvents } from "@spot-battle/shared";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import { InMemoryMatchStore } from "../../src/persistence/match-store.js";
import { createGameServer } from "../../src/server.js";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function waitForEvent<T>(socket: TestSocket, event: string, predicate: (value: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve) => {
    const listener = (value: T) => {
      if (!predicate(value)) return;
      socket.off(event as never, listener as never);
      resolve(value);
    };
    socket.on(event as never, listener as never);
  });
}

function waitForState(socket: TestSocket, state: GameSnapshot["state"]): Promise<GameSnapshot> {
  return waitForEvent<GameSnapshot>(socket, "game:snapshot", (snapshot) => snapshot.state === state);
}

describe("simultaneous game server", () => {
  it("reports an unavailable database as HTTP 503", async () => {
    const store = new class extends InMemoryMatchStore {
      override async health() { return false; }
    }();
    const app = await createGameServer({ matchStore: store });
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "degraded", server: "ok", database: false });
    } finally {
      await app.close();
    }
  });

  let app: Awaited<ReturnType<typeof createGameServer>>;
  const sockets: TestSocket[] = [];

  beforeEach(async () => {
    app = await createGameServer({ sceneId: "enchanted-forest", inputCooldownMs: 0 });
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    for (const socket of sockets) socket.disconnect();
    await app.close();
  });

  async function connect(): Promise<TestSocket> {
    const { port } = app.server.address() as AddressInfo;
    const socket: TestSocket = createClient(`http://127.0.0.1:${port}`, { forceNew: true, transports: ["websocket"], autoConnect: false });
    sockets.push(socket);
    const ready = waitForEvent(socket, "session:ready");
    socket.connect();
    await ready;
    return socket;
  }

  it("does not accept a report when finished-match cleanup persistence fails", async () => {
    await app.close();
    const store = new class extends InMemoryMatchStore {
      override async deleteActiveMatch(): Promise<void> {
        throw new Error("DELETE_FAILED");
      }
    }();
    app = await createGameServer({ matchStore: store, inputCooldownMs: 0 });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const first = await connect();
    const second = await connect();
    const firstFound = waitForEvent<MatchFoundPayload>(first, "match:found");
    const secondFound = waitForEvent<MatchFoundPayload>(second, "match:found");
    const firstReadySnapshot = waitForState(first, "READY");
    first.emit("queue:join", { nickname: "first" });
    second.emit("queue:join", { nickname: "second" });
    const [firstMatch] = await Promise.all([firstFound, secondFound]);
    const ready = await firstReadySnapshot;
    const finished = waitForState(first, "FINISHED");
    first.emit("game:forfeit", {
      matchId: firstMatch.matchId,
      expectedState: ready.state,
      expectedStateVersion: ready.stateVersion,
    });
    const result = await finished;
    const persistenceError = waitForEvent<GameErrorPayload>(
      first,
      "game:error",
      (error) => error.code === "INTERNAL_ERROR",
    );
    first.emit("game:report", {
      matchId: firstMatch.matchId,
      expectedState: result.state,
      expectedStateVersion: result.stateVersion,
      reason: "SYSTEM_ERROR",
    });
    await persistenceError;
    expect(store.reports.size).toBe(0);
  });
  it("keeps a cleared player waiting until timeout or forfeit", async () => {
    const first = await connect();
    const second = await connect();
    const firstFound = waitForEvent<MatchFoundPayload>(first, "match:found");
    const secondFound = waitForEvent<MatchFoundPayload>(second, "match:found");
    first.emit("queue:join", { nickname: "첫째" });
    second.emit("queue:join", { nickname: "둘째" });
    const [firstMatch, secondMatch] = await Promise.all([firstFound, secondFound]);
    expect(firstMatch.matchId).toBe(secondMatch.matchId);

    const firstPreloading = waitForState(first, "PRELOADING");
    const secondPreloading = waitForState(second, "PRELOADING");
    first.emit("game:ready", { matchId: firstMatch.matchId });
    second.emit("game:ready", { matchId: firstMatch.matchId });
    const [firstLoad, secondLoad] = await Promise.all([firstPreloading, secondPreloading]);
    expect(firstLoad.currentPuzzleId).toBe("enchanted-forest");

    const versionError = waitForEvent<GameErrorPayload>(first, "game:error", (error) => error.code === "PUZZLE_VERSION_MISMATCH");
    first.emit("game:loaded", { matchId: firstMatch.matchId, puzzleId: "enchanted-forest", puzzleVersion: "stale-version" });
    await expect(versionError).resolves.toMatchObject({ code: "PUZZLE_VERSION_MISMATCH" });
    const firstCountdown = waitForState(first, "COUNTDOWN");
    const secondCountdown = waitForState(second, "COUNTDOWN");
    first.emit("game:loaded", { matchId: firstMatch.matchId, puzzleId: "enchanted-forest", puzzleVersion: firstLoad.currentPuzzleVersion! });
    second.emit("game:loaded", { matchId: firstMatch.matchId, puzzleId: "enchanted-forest", puzzleVersion: secondLoad.currentPuzzleVersion! });
    await Promise.all([firstCountdown, secondCountdown]);

    const [firstPlaying, secondPlaying] = await Promise.all([waitForState(first, "PLAYING"), waitForState(second, "PLAYING")]);
    const context = { expectedState: "PLAYING" as const, expectedStateVersion: firstPlaying.stateVersion };
    const malformedError = waitForEvent<GameErrorPayload>(first, "game:error", (error) => error.code === "INVALID_POINT");
    first.emit("game:guess", {
      matchId: firstMatch.matchId,
      puzzleId: "enchanted-forest",
      point: null,
      ...context,
    } as never);
    await expect(malformedError).resolves.toMatchObject({ code: "INVALID_POINT" });

    const requeueError = waitForEvent<GameErrorPayload>(first, "game:error", (error) => error.code === "ALREADY_IN_MATCH");
    first.emit("queue:join", { nickname: "재매칭시도" });
    await expect(requeueError).resolves.toMatchObject({ code: "ALREADY_IN_MATCH" });
    second.emit("game:guess", { matchId: firstMatch.matchId, puzzleId: "enchanted-forest", point: { x: 0.31, y: 0.33 }, ...context });
    const secondProgress = await waitForEvent<GameSnapshot>(second, "game:snapshot", (snapshot) => snapshot.players.some((player) => player.playerId === secondMatch.playerId && player.foundCount === 1));
    expect(secondProgress.foundMarks).toHaveLength(1);
    expect(firstPlaying.foundMarks).toHaveLength(0);

    const exhaustedFirst = waitForEvent<GameSnapshot>(first, "game:snapshot", (snapshot) => snapshot.state === "PLAYING" && snapshot.currentPuzzleId === null);
    for (const point of [{ x: 0.31, y: 0.33 }, { x: 0.27, y: 0.78 }, { x: 0.79, y: 0.17 }]) {
      first.emit("game:guess", { matchId: firstMatch.matchId, puzzleId: "enchanted-forest", point, ...context });
    }
    const stillPlaying = await exhaustedFirst;
    expect(stillPlaying).toMatchObject({ state: "PLAYING", currentPuzzleId: null, winnerId: null });

    const finishedFirst = waitForState(first, "FINISHED");
    const finishedSecond = waitForState(second, "FINISHED");
    second.emit("game:forfeit", {
      matchId: firstMatch.matchId,
      expectedState: "PLAYING",
      expectedStateVersion: stillPlaying.stateVersion,
    });
    const [firstResult, secondResult] = await Promise.all([finishedFirst, finishedSecond]);
    expect(firstResult).toMatchObject({ winnerId: firstMatch.playerId, endReason: "FORFEIT" });
    expect(secondResult.winnerId).toBe(firstMatch.playerId);
  }, 15_000);

  it("keeps private progress scoped to each client and emits one authoritative result", async () => {
    const first = await connect();
    const second = await connect();
    const firstFound = waitForEvent<MatchFoundPayload>(first, "match:found");
    const secondFound = waitForEvent<MatchFoundPayload>(second, "match:found");
    const firstReady = waitForState(first, "READY");
    const secondReady = waitForState(second, "READY");

    first.emit("queue:join", { nickname: "첫째" });
    second.emit("queue:join", { nickname: "둘째" });
    const [firstMatch, secondMatch, firstReadySnapshot, secondReadySnapshot] = await Promise.all([
      firstFound,
      secondFound,
      firstReady,
      secondReady,
    ]);

    expect(firstMatch.matchId).toBe(secondMatch.matchId);
    expect(firstReadySnapshot).toMatchObject({
      currentPuzzleId: "enchanted-forest",
      currentPuzzleVersion: secondReadySnapshot.currentPuzzleVersion,
      nextPuzzleId: secondReadySnapshot.nextPuzzleId,
      totalPuzzleCount: secondReadySnapshot.totalPuzzleCount,
    });

    const firstOpponent = firstReadySnapshot.players.find(
      (player) => player.playerId === secondMatch.playerId,
    )!;
    expect(firstOpponent.perspective).toBe("OPPONENT");
    expect(firstOpponent).not.toHaveProperty("puzzleIndex");
    expect(firstOpponent).not.toHaveProperty("wrongAnswerCount");
    expect(firstOpponent).not.toHaveProperty("inputLockedUntilMs");
    expect(firstReadySnapshot).toMatchObject({
      problemImage: null,
      myFoundIds: [],
      foundMarks: [],
      revealedDifferences: null,
    });

    const firstPreloading = waitForState(first, "PRELOADING");
    const secondPreloading = waitForState(second, "PRELOADING");
    first.emit("game:ready", { matchId: firstMatch.matchId });
    second.emit("game:ready", { matchId: firstMatch.matchId });
    const [firstLoad, secondLoad] = await Promise.all([firstPreloading, secondPreloading]);

    const firstCountdown = waitForState(first, "COUNTDOWN");
    const secondCountdown = waitForState(second, "COUNTDOWN");
    first.emit("game:loaded", {
      matchId: firstMatch.matchId,
      puzzleId: firstLoad.currentPuzzleId!,
      puzzleVersion: firstLoad.currentPuzzleVersion!,
    });
    second.emit("game:loaded", {
      matchId: secondMatch.matchId,
      puzzleId: secondLoad.currentPuzzleId!,
      puzzleVersion: secondLoad.currentPuzzleVersion!,
    });
    await Promise.all([firstCountdown, secondCountdown]);

    const [firstPlaying, secondPlaying] = await Promise.all([
      waitForState(first, "PLAYING"),
      waitForState(second, "PLAYING"),
    ]);
    expect(firstPlaying.deadlineMs).toBe(secondPlaying.deadlineMs);

    const firstProgress = waitForEvent<GameSnapshot>(
      first,
      "game:snapshot",
      (snapshot) => snapshot.myFoundIds.includes("forest-lantern"),
    );
    const secondView = waitForEvent<GameSnapshot>(
      second,
      "game:snapshot",
      (snapshot) => snapshot.players.some(
        (player) => player.playerId === firstMatch.playerId && player.foundCount === 1,
      ),
    );
    first.emit("game:guess", {
      matchId: firstMatch.matchId,
      puzzleId: "enchanted-forest",
      point: { x: 0.31, y: 0.33 },
      expectedState: "PLAYING",
      expectedStateVersion: firstPlaying.stateVersion,
    });
    const [privateProgress, opponentView] = await Promise.all([firstProgress, secondView]);

    expect(privateProgress.myFoundIds).toEqual(["forest-lantern"]);
    expect(privateProgress.foundMarks).toHaveLength(1);
    expect(privateProgress.revealedDifferences).toBeNull();
    expect(opponentView.myFoundIds).toEqual([]);
    expect(opponentView.foundMarks).toEqual([]);
    expect(opponentView.revealedDifferences).toBeNull();

    const firstFinished = waitForState(first, "FINISHED");
    const secondFinished = waitForState(second, "FINISHED");
    second.emit("game:forfeit", {
      matchId: secondMatch.matchId,
      expectedState: "PLAYING",
      expectedStateVersion: opponentView.stateVersion,
    });
    const [firstResult, secondResult] = await Promise.all([firstFinished, secondFinished]);

    expect(firstResult).toMatchObject({
      state: "FINISHED",
      winnerId: firstMatch.playerId,
      endReason: "FORFEIT",
      deadlineMs: null,
    });
    expect(secondResult).toMatchObject({
      state: firstResult.state,
      stateVersion: firstResult.stateVersion,
      winnerId: firstResult.winnerId,
      endReason: firstResult.endReason,
      deadlineMs: firstResult.deadlineMs,
    });
    expect(firstResult.revealedDifferences).toHaveLength(3);
    expect(secondResult.revealedDifferences).toHaveLength(3);
  }, 15_000);
  it("uses injected catalog answers and snapshots them for an active match", async () => {
    await app.close();
    const store = new InMemoryMatchStore();
    const source = structuredClone(GAME_PUZZLES.find((item) => item.id === "home-office")!);
    source.differences = [{ id: "db-answer", label: "DB answer", regions: [{ x: 0.5, y: 0.5, radius: 0.08 }] }];
    app = await createGameServer({ matchStore: store, puzzles: [source], inputCooldownMs: 0 });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const first = await connect();
    const second = await connect();
    const found = waitForEvent<MatchFoundPayload>(first, "match:found");
    first.emit("queue:join", { nickname: "first" });
    second.emit("queue:join", { nickname: "second" });
    const { matchId } = await found;
    source.differences[0]!.regions[0]!.x = 0.9;

    const firstPreload = waitForState(first, "PRELOADING");
    const secondPreload = waitForState(second, "PRELOADING");
    first.emit("game:ready", { matchId });
    second.emit("game:ready", { matchId });
    const [a, b] = await Promise.all([firstPreload, secondPreload]);
    expect(a.currentPuzzleId).toBe("home-office");
    const firstCountdown = waitForState(first, "COUNTDOWN");
    const secondCountdown = waitForState(second, "COUNTDOWN");
    first.emit("game:loaded", { matchId, puzzleId: "home-office", puzzleVersion: a.currentPuzzleVersion! });
    second.emit("game:loaded", { matchId, puzzleId: "home-office", puzzleVersion: b.currentPuzzleVersion! });
    await Promise.all([firstCountdown, secondCountdown]);
    const playing = await waitForState(first, "PLAYING");
    const result = waitForEvent<{ correct: boolean; differenceId: string | null }>(first, "game:guess-result");
    first.emit("game:guess", {
      matchId, puzzleId: "home-office", point: { x: 0.5, y: 0.5 },
      expectedState: "PLAYING", expectedStateVersion: playing.stateVersion,
    });
    expect(await result).toMatchObject({ correct: true, differenceId: "db-answer" });
  }, 15_000);
  it("keeps the persisted answer snapshot when the active catalog changes", async () => {
    await app.close();
    const store = new InMemoryMatchStore();
    const savedPuzzle = structuredClone(GAME_PUZZLES.find((item) => item.id === "home-office")!);
    const state = new GameMatch("restored-match", [savedPuzzle], [
      { playerId: "p1", nickname: "first" }, { playerId: "p2", nickname: "second" },
    ]).serialize();
    store.activeMatches.set(state.matchId, state);
    store.guests.set("p1", { guestToken: "token-1", nickname: "first", updatedAt: Date.now() });
    store.guests.set("p2", { guestToken: "token-2", nickname: "second", updatedAt: Date.now() });
    const currentPuzzle = structuredClone(savedPuzzle);
    currentPuzzle.differences[0]!.regions[0]!.x = 0.8;
    app = await createGameServer({ matchStore: store, puzzles: [currentPuzzle], reconnectGraceMs: 10_000, inputCooldownMs: 0 });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const first = createClient(`http://127.0.0.1:${port}`, {
      auth: { guestToken: "token-1" }, autoConnect: false, forceNew: true, transports: ["websocket"],
    }) as TestSocket;
    const second = createClient(`http://127.0.0.1:${port}`, {
      auth: { guestToken: "token-2" }, autoConnect: false, forceNew: true, transports: ["websocket"],
    }) as TestSocket;
    sockets.push(first, second);
    const firstFound = waitForEvent<MatchFoundPayload>(first, "match:found");
    const secondFound = waitForEvent<MatchFoundPayload>(second, "match:found");
    first.connect();
    second.connect();
    await Promise.all([firstFound, secondFound]);

    const firstPreload = waitForState(first, "PRELOADING");
    const secondPreload = waitForState(second, "PRELOADING");
    first.emit("game:ready", { matchId: state.matchId });
    second.emit("game:ready", { matchId: state.matchId });
    const [a, b] = await Promise.all([firstPreload, secondPreload]);
    const firstCountdown = waitForState(first, "COUNTDOWN");
    const secondCountdown = waitForState(second, "COUNTDOWN");
    first.emit("game:loaded", { matchId: state.matchId, puzzleId: "home-office", puzzleVersion: a.currentPuzzleVersion! });
    second.emit("game:loaded", { matchId: state.matchId, puzzleId: "home-office", puzzleVersion: b.currentPuzzleVersion! });
    await Promise.all([firstCountdown, secondCountdown]);
    const playing = await waitForState(first, "PLAYING");
    const result = waitForEvent<{ correct: boolean; differenceId: string | null }>(first, "game:guess-result");
    first.emit("game:guess", {
      matchId: state.matchId, puzzleId: "home-office", point: { x: 0.56, y: 0.16 },
      expectedState: "PLAYING", expectedStateVersion: playing.stateVersion,
    });
    expect(await result).toMatchObject({ correct: true, differenceId: "office-wall-decor" });
  }, 15_000);
  it("keeps GAME_SCENE_ID deterministic with an injected catalog", async () => {
    await app.close();
    const selected = GAME_PUZZLES.filter((item) =>
      item.id === "home-office" || item.id === "enchanted-forest");
    app = await createGameServer({ puzzles: selected, sceneId: "enchanted-forest" });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const first = await connect();
    const second = await connect();
    const found = waitForEvent<MatchFoundPayload>(first, "match:found");
    first.emit("queue:join", { nickname: "first" });
    second.emit("queue:join", { nickname: "second" });
    const { matchId } = await found;
    const preload = waitForState(first, "PRELOADING");
    first.emit("game:ready", { matchId });
    second.emit("game:ready", { matchId });
    expect((await preload).currentPuzzleId).toBe("enchanted-forest");
  });
});
