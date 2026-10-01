import { describe, expect, it } from "vitest";
import type { GameSnapshot, MatchFoundPayload, PlayerGrowthPayload } from "@spot-battle/shared";
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
  it("does not resume a finished match after the player dismissed it", async () => {
    const h = await harness(); const { first } = await h.start();
    await h.action(first, "game:forfeit");
    const matchId = h.snapshot(first).matchId;
    await h.game.action(first, "game:dismiss", { matchId });
    const token = h.token(first);
    await h.disconnect(first);
    const resumed = await h.add(token);
    expect(resumed.frames.map((f) => f.event)).toEqual(["session:ready", "player:growth"]);
  });
  it("ignores dismissal of an active match", async () => {
    const h = await harness(); const { first } = await h.start();
    const matchId = h.snapshot(first).matchId;
    await h.game.action(first, "game:dismiss", { matchId });
    const token = h.token(first);
    await h.disconnect(first);
    const resumed = await h.add(token);
    expect(resumed.frames.some((f) => f.event === "match:found")).toBe(true);
    expect(h.snapshot(resumed).state).toBe("PLAYING");
  });
  it("rewards a finished match once and skips the player who forfeited", async () => {
    const h = await harness(); const { first, second } = await h.start();
    await h.action(first, "game:forfeit");
    await h.game.alarm();
    const growth = (p: TestPeer) => p.frames.filter((f) => f.event === "player:growth").map((f) => f.payload as PlayerGrowthPayload);
    const winnerRewards = growth(second).filter((g) => g.reward);
    expect(winnerRewards).toHaveLength(1);
    expect(winnerRewards[0]!.reward).toMatchObject({ reason: "WIN", xp: 100, coins: 120, leveledUp: true });
    expect(winnerRewards[0]!.progress).toMatchObject({ level: 2, coins: 120 });
    expect(growth(first).some((g) => g.reward)).toBe(false);
    const token = h.token(second);
    await h.restore();
    const back = await h.add(token);
    expect(growth(back).at(-1)!.progress).toMatchObject({ level: 2, totalXp: 100, coins: 120 });
  });
  it("rewards solo completions up to the daily limit", async () => {
    const h = await harness(); const player = await h.add();
    for (let i = 0; i < 6; i += 1) await h.game.action(player, "solo:complete", { puzzleId: "observatory", elapsedMs: 40_000 });
    await h.game.action(player, "solo:complete", { puzzleId: "observatory", elapsedMs: 500 });
    const payloads = player.frames.filter((f) => f.event === "player:growth").map((f) => f.payload as PlayerGrowthPayload);
    expect(payloads.filter((p) => p.reward)).toHaveLength(5);
    expect(payloads.at(-2)!.soloLimitReached).toBe(true);
    expect(payloads.at(-1)!.progress).toMatchObject({ totalXp: 150, coins: 100 });
  });
  it("sells and equips cosmetics with server-side coin checks and shows them to the opponent", async () => {
    const h = await harness();
    const buyer = await h.add();
    const growthFrames = (p: TestPeer) => p.frames.filter((f) => f.event === "player:growth").map((f) => f.payload as PlayerGrowthPayload);
    await h.game.action(buyer, "shop:buy", { itemId: "frame-wood" });
    expect(buyer.frames.at(-1)).toMatchObject({ event: "game:error", payload: { code: "NOT_ENOUGH_COINS" } });
    const token = h.token(buyer);
    const [key, session] = [...h.storage.data].find(([k]) => k.startsWith("session:"))!;
    h.storage.data.set(key, { ...(session as object), growth: { totalXp: 0, coins: 1_000 } });
    await h.disconnect(buyer);
    await h.restore();
    const rich = await h.add(token);
    await h.game.action(rich, "shop:buy", { itemId: "profile-sage" });
    expect(growthFrames(rich).at(-1)!.progress).toMatchObject({ coins: 700, loadout: { profile: "profile-sage" } });
    await h.game.action(rich, "shop:equip", { itemId: "title-curator" });
    expect(rich.frames.at(-1)).toMatchObject({ event: "game:error", payload: { code: "ITEM_LOCKED" } });
    const opponent = await h.add();
    await h.join(rich); await h.join(opponent);
    const found = opponent.frames.find((f) => f.event === "match:found")!.payload as MatchFoundPayload;
    expect(found.opponentCosmetics).toEqual({ profile: "profile-sage", title: "title-visitor" });
  });
  it("stamps snapshots with the server clock", async () => {
    const h = await harness(); const { first } = await h.start();
    expect(typeof h.snapshot(first).serverNowMs).toBe("number");
  });
  it("expires anonymous sessions after an hour but keeps named ones", async () => {
    const h = await harness();
    const anonymous = await h.add(); const named = await h.add();
    await h.join(named);
    await h.game.action(named, "queue:leave");
    await h.disconnect(anonymous); await h.disconnect(named);
    h.advance(60 * 60_000 + 1); await h.game.alarm();
    expect(h.storage.data.has(`session:${anonymous.playerId}`)).toBe(false);
    expect(h.storage.data.has(`session:${named.playerId}`)).toBe(true);
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
