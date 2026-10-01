import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@spot-battle/shared";
import { GAME_PUZZLES } from "../../../apps/server/src/game/puzzle-catalog.js";
import { RealtimeGame, type Archive, type Peer, type Storage } from "../src/game.js";
import { allowedOrigin } from "../src/index.js";

class MemoryStorage implements Storage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  async get<T>(key: string) { return structuredClone(this.data.get(key)) as T | undefined; }
  async list<T>({ prefix }: { prefix: string }) { return new Map([...this.data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as T])); }
  async put(key: string, value: unknown) { this.data.set(key, structuredClone(value)); }
  async delete(key: string) { this.data.delete(key); }
  async setAlarm(time: number) { this.alarm = time; }
  async deleteAlarm() { this.alarm = null; }
}
interface TestPeer extends Peer { frames: Array<{ event: string; payload: unknown }> }
async function harness(archive?: Archive, catalog = [GAME_PUZZLES[0]!]) {
  const storage = new MemoryStorage();
  let now = 1_000_000;
  const peers: TestPeer[] = [];
  let game = new RealtimeGame(storage, () => peers, catalog, archive, () => now);
  await game.restore();
  const add = async (token?: string) => {
    const peer: TestPeer = { id: crypto.randomUUID(), frames: [], send(event, payload) { this.frames.push({ event, payload }); }, close() { const i = peers.indexOf(this); if (i >= 0) peers.splice(i, 1); } };
    peers.push(peer);
    await game.authenticate(peer, token);
    return peer;
  };
  const snapshot = (p: TestPeer) => p.frames.filter((f) => f.event === "game:snapshot").at(-1)!.payload as GameSnapshot;
  const token = (p: TestPeer) => (p.frames.find((f) => f.event === "session:ready")!.payload as { guestToken: string }).guestToken;
  const action = (p: TestPeer, event: string, payload: Record<string, unknown> = {}) => game.action(p, event, { ...snapshot(p), expectedState: snapshot(p).state, expectedStateVersion: snapshot(p).stateVersion, ...payload });
  const join = (p: TestPeer, settings = { mode: "STANDARD", difficulty: "NORMAL" }) => game.action(p, "queue:join", { nickname: "테스터", settings });
  const start = async () => {
    const first = await add(); const second = await add();
    await join(first); await join(second);
    await action(first, "game:ready"); await action(second, "game:ready");
    const firstPuzzle = catalog.find((puzzle) => puzzle.id === snapshot(first).currentPuzzleId)!;
    for (const p of [first, second]) await action(p, "game:loaded", { puzzleId: firstPuzzle.id, puzzleVersion: firstPuzzle.assetVersion });
    now += 3000; await game.alarm();
    return { first, second };
  };
  return { storage, peers, add, snapshot, token, action, join, start, get game() { return game; }, advance(ms: number) { now += ms; }, async restore() { game = new RealtimeGame(storage, () => peers, catalog, archive, () => now); await game.restore(); }, async disconnect(p: TestPeer) { p.close(); await game.disconnect(p); } };
}

describe("Cloudflare authoritative game", () => {
  it("broadcasts and archives the first ten-puzzle finisher immediately", async () => {
    const saved: unknown[] = [];
    const h = await harness({ async save(state) { saved.push(state); }, async report() { return "report"; } }, [...GAME_PUZZLES]);
    const { first, second } = await h.start();
    expect(h.snapshot(first).totalPuzzleCount).toBe(10);
    for (let index = 0; index < 10; index += 1) {
      const id = h.snapshot(first).currentPuzzleId;
      const puzzle = GAME_PUZZLES.find((candidate) => candidate.id === id)!;
      for (const difference of puzzle.differences) {
        h.advance(150);
        await h.action(first, "game:guess", { puzzleId: id, point: difference.regions[0] });
      }
    }
    for (const peer of [first, second]) {
      expect(h.snapshot(peer)).toMatchObject({ state: "FINISHED", endReason: "COMPLETED", winnerId: first.playerId });
    }
    expect(h.snapshot(second).players.find((player) => player.playerId === second.playerId)).toMatchObject({ totalFoundCount: 0, completedAllPuzzles: false });
    await h.game.flushArchive();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ state: "FINISHED", winnerId: first.playerId, endReason: "COMPLETED" });
  });
  it("matches only identical settings and can leave a queue", async () => {
    const h = await harness(); const a = await h.add(); const b = await h.add();
    await h.join(a); await h.join(b, { mode: "SPRINT", difficulty: "NORMAL" });
    expect(a.frames.some((f) => f.event === "match:found")).toBe(false);
    await h.game.action(b, "queue:leave");
    await h.join(b);
    expect(h.snapshot(a).matchId).toBe(h.snapshot(b).matchId);
  });
  it("runs countdown, judges a guess privately, rejects a forged match ID", async () => {
    const h = await harness(); const { first, second } = await h.start();
    expect(h.snapshot(first).state).toBe("PLAYING");
    expect(h.snapshot(first).revealedDifferences).toBeNull();
    await h.action(first, "game:guess", { puzzleId: GAME_PUZZLES[0]!.id, point: GAME_PUZZLES[0]!.differences[0]!.regions[0] });
    expect(h.snapshot(first).foundMarks).toHaveLength(1);
    expect(h.snapshot(second).foundMarks).toHaveLength(0);
    expect(h.snapshot(second).players.find((p) => p.playerId === first.playerId)).not.toHaveProperty("puzzleIndex");
    await h.action(first, "game:forfeit", { matchId: crypto.randomUUID() });
    expect(first.frames.at(-1)?.payload).toMatchObject({ code: "MATCH_NOT_FOUND" });
    expect(h.snapshot(first).state).toBe("PLAYING");
  });
  it("restores sessions, queue, progress and input cooldown after hibernation", async () => {
    const h = await harness(); const { first } = await h.start();
    const guess = { puzzleId: GAME_PUZZLES[0]!.id, point: GAME_PUZZLES[0]!.differences[0]!.regions[0] };
    await h.action(first, "game:guess", guess);
    await h.restore();
    await h.action(first, "game:guess", guess);
    expect(first.frames.at(-1)?.payload).toMatchObject({ code: "INPUT_RATE_LIMITED" });
    expect(h.snapshot(first).foundMarks).toHaveLength(1);
  });
  it("resumes within the grace period and preserves progress", async () => {
    const h = await harness(); const { first, second } = await h.start();
    const token = h.token(first);
    await h.action(first, "game:guess", { puzzleId: GAME_PUZZLES[0]!.id, point: GAME_PUZZLES[0]!.differences[0]!.regions[0] });
    await h.disconnect(first);
    expect(h.snapshot(second).players.find((p) => p.playerId === first.playerId)?.connectionStatus).toBe("RECONNECTING");
    await h.restore(); h.advance(1000);
    const resumed = await h.add(token);
    expect(resumed.playerId).toBe(first.playerId);
    expect(h.snapshot(resumed).foundMarks).toHaveLength(1);
    expect(h.snapshot(resumed).state).toBe("PLAYING");
  });
  it("does not let a late reconnect bypass forfeit before an alarm fires", async () => {
    const h = await harness(); const { first, second } = await h.start();
    const token = h.token(first);
    await h.disconnect(first); h.advance(10_001);
    const resumed = await h.add(token);
    expect(h.snapshot(resumed)).toMatchObject({ state: "FINISHED", winnerId: second.playerId, endReason: "FORFEIT" });
  });
  it("expires a match with no client activity", async () => {
    const h = await harness(); const { first } = await h.start();
    h.advance(180_001); await h.game.alarm();
    expect(h.snapshot(first)).toMatchObject({ state: "FINISHED", endReason: "TIMEOUT" });
  });
  it("retains failed Supabase writes, retries, and allows the next game", async () => {
    let fail = true; const saved: string[] = [];
    const h = await harness({ async save(state) { if (fail) throw new Error("offline"); saved.push(state.matchId); }, async report() { return "report"; } });
    const { first, second } = await h.start(); const originalId = h.snapshot(first).matchId;
    await h.action(first, "game:forfeit"); await h.game.flushArchive();
    expect(h.storage.data.has(`match:${originalId}`)).toBe(true);
    await h.join(first); await h.join(second);
    expect(h.snapshot(first).matchId).not.toBe(originalId);
    await h.restore(); fail = false; await h.game.flushArchive();
    expect(saved).toContain(originalId);
    expect(h.storage.data.has(`history:${originalId}`)).toBe(true);
    await h.action(first, "game:ready");
    expect(h.snapshot(first).players.find((p) => p.playerId === first.playerId)?.ready).toBe(true);
  });
  it("allows the opponent to report after one participant returns to queue", async () => {
    const h = await harness(); const { first, second } = await h.start();
    await h.action(first, "game:forfeit"); await h.join(first);
    await h.action(second, "game:report", { reason: "OTHER" });
    expect(second.frames.some((f) => f.event === "game:report-result")).toBe(true);
    await h.action(second, "game:report", { reason: "OTHER" });
    expect(second.frames.at(-1)?.payload).toMatchObject({ code: "DUPLICATE_REPORT" });
  });
  it("keeps deadlines anchored when a countdown alarm is delayed", async () => {
    const h = await harness(); const a = await h.add(); const b = await h.add();
    await h.join(a); await h.join(b);
    await h.action(a, "game:ready"); await h.action(b, "game:ready");
    for (const p of [a, b]) await h.action(p, "game:loaded", { puzzleId: GAME_PUZZLES[0]!.id, puzzleVersion: GAME_PUZZLES[0]!.assetVersion });
    const countdownDeadline = h.snapshot(a).deadlineMs!;
    h.advance(15_000); await h.game.alarm();
    expect(h.snapshot(a).deadlineMs).toBe(countdownDeadline + 180_000);
  });
});

it("rejects cross-site and missing origins but accepts first party and AIT", () => {
  const request = (origin?: string) => new Request("https://game.example/ws", { headers: origin ? { Origin: origin } : {} });
  const env = { ALLOWED_ORIGINS: "https://spot-difference-syk.web.tossmini.com" };
  expect(allowedOrigin(request("https://evil.example"), env)).toBe(false);
  expect(allowedOrigin(request(), env)).toBe(false);
  expect(allowedOrigin(request("https://game.example"), env)).toBe(true);
  expect(allowedOrigin(request(env.ALLOWED_ORIGINS), env)).toBe(true);
});
