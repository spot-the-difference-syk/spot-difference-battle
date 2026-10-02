import { describe, expect, it } from "vitest";
import type { GameSnapshot, MatchFoundPayload, PlayerGrowthPayload, RankingPayload, SoloGuessResultPayload, SoloStartedPayload } from "@spot-battle/shared";
import { GAME_PUZZLES } from "../../../apps/server/src/game/puzzle-catalog.js";
import { BUNDLED_SOLO_ANSWERS } from "../../../apps/server/src/game/solo-puzzles.js";
import { RealtimeGame, tokenHash, type Archive, type GrowthBackup, type Peer, type Storage } from "../src/game.js";
import { readFileSync } from "node:fs";
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
  const join = (p: TestPeer, settings: Record<string, unknown> = { mode: "STANDARD" }) => game.action(p, "queue:join", { nickname: "테스터", settings });
  const start = async () => {
    const first = await add(); const second = await add();
    await join(first); await join(second);
    await action(first, "game:ready"); await action(second, "game:ready");
    const firstPuzzle = catalog.find((puzzle) => puzzle.id === snapshot(first).currentPuzzleId)!;
    for (const p of [first, second]) await action(p, "game:loaded", { puzzleId: firstPuzzle.id, puzzleVersion: firstPuzzle.assetVersion });
    now += 3000; await game.alarm();
    return { first, second };
  };
  /** 서버 판정으로 솔로 한 판을 끝낸다. 걸린 시간 = 3초 대기 후 extraMs + 정답마다 150ms */
  const playSolo = async (p: TestPeer, puzzleId = "observatory", extraMs = 0) => {
    await game.action(p, "solo:start", { puzzleId, nickname: "테스터" });
    const started = p.frames.filter((f) => f.event === "solo:started").at(-1)!.payload as SoloStartedPayload;
    now += 3000 + extraMs;
    for (const answer of BUNDLED_SOLO_ANSWERS.find((puzzle) => puzzle.id === puzzleId)!.answers) {
      now += 150;
      await game.action(p, "solo:guess", { runId: started.runId, point: { x: answer.region.x, y: answer.region.y } });
    }
    return p.frames.filter((f) => f.event === "solo:guess-result").at(-1)!.payload as SoloGuessResultPayload;
  };
  return { storage, peers, add, snapshot, token, action, join, start, playSolo, get game() { return game; }, get now() { return now; }, advance(ms: number) { now += ms; }, async restore() { game = new RealtimeGame(storage, () => peers, catalog, archive, () => now); await game.restore(); }, async disconnect(p: TestPeer) { p.close(); await game.disconnect(p); } };
}

describe("Cloudflare authoritative game", () => {
  it("deals a single-genre deck and broadcasts and archives the first finisher immediately", async () => {
    const saved: unknown[] = [];
    const h = await harness({ async save(state) { saved.push(state); }, async report() { return "report"; } }, [...GAME_PUZZLES]);
    const { first, second } = await h.start();
    // 번들 대결 그림은 실사 5·카툰 3점이라 한 경기는 그중 한 화풍만 쓴다.
    const total = h.snapshot(first).totalPuzzleCount;
    const deck = (first.frames.find((f) => f.event === "match:found")!.payload as MatchFoundPayload).deck!;
    expect(deck).toHaveLength(total);
    expect([3, 5]).toContain(total);
    expect(new Set(deck.map((card) => card.genre)).size).toBe(1);
    for (let index = 0; index < total; index += 1) {
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
    await h.join(a); await h.join(b, { mode: "SPRINT" });
    expect(a.frames.some((f) => f.event === "match:found")).toBe(false);
    await h.game.action(b, "queue:leave");
    // 예전 앱이 보내는 난이도는 무시하고 같은 모드끼리 매칭한다.
    await h.join(b, { mode: "STANDARD", difficulty: "HARD" });
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
    expect(growth(first).at(-1)!.progress.stats).toMatchObject({ matches: 1, losses: 1, wins: 0 });
    expect(growth(second).at(-1)!.progress.stats).toMatchObject({ matches: 1, wins: 1 });
    const token = h.token(second);
    await h.restore();
    const back = await h.add(token);
    expect(growth(back).at(-1)!.progress).toMatchObject({ level: 2, totalXp: 100, coins: 120 });
  });
  it("rewards solo completions up to the daily limit", async () => {
    const h = await harness(); const player = await h.add();
    for (let i = 0; i < 6; i += 1) await h.playSolo(player, "observatory", 40_000);
    // 3초 안에 다 찾은 기록은 보상·순위 없이 끝난다.
    const tooFast = await h.playSolo(player, "observatory");
    expect(tooFast.finished).toMatchObject({ elapsedMs: 750, newPersonalBest: false, weekRank: null, allRank: null });
    const payloads = player.frames.filter((f) => f.event === "player:growth").map((f) => f.payload as PlayerGrowthPayload);
    expect(payloads.filter((p) => p.reward)).toHaveLength(5);
    expect(payloads.at(-2)!.soloLimitReached).toBe(true);
    expect(payloads.at(-1)!.progress).toMatchObject({ totalXp: 150, coins: 100 });
  });
  it("ranks server-timed solo runs and pays the weekly reward once after Monday", async () => {
    const h = await harness();
    const players = [];
    for (let i = 0; i < 5; i += 1) {
      const player = await h.add();
      const done = await h.playSolo(player, "observatory", 10_000 - i * 1_000);
      expect(done.finished).toMatchObject({ newPersonalBest: true, weekRank: 1, allRank: 1 });
      players.push(player);
    }
    // 기록은 서버가 잰다: 클라이언트가 보낸 시간 값은 받지 않는다.
    await h.game.action(players[0]!, "ranking:get", { puzzleId: "observatory", period: "week" });
    const week = players[0]!.frames.filter((f) => f.event === "ranking:list").at(-1)!.payload as RankingPayload;
    expect(week).toMatchObject({ period: "week", participants: 5, me: { rank: 5, elapsedMs: 10_750 } });
    expect(week.rows.map((row) => row.elapsedMs)).toEqual([6_750, 7_750, 8_750, 9_750, 10_750]);
    expect(week.rows[4]).toMatchObject({ me: true, nickname: "테스터", avatar: "avatar-initial" });
    // 같은 그림을 더 느리게 다시 해도 순위표의 내 기록은 그대로다.
    const slower = await h.playSolo(players[4]!, "observatory", 30_000);
    expect(slower.finished).toMatchObject({ newPersonalBest: false, weekRank: 1, allRank: 1 });

    h.advance(8 * 86_400_000);
    await h.restore();
    await h.add();
    const rankingRewards = (p: TestPeer) => p.frames.map((f) => f.payload as PlayerGrowthPayload).filter((g) => g?.reward?.reason === "RANKING");
    expect(rankingRewards(players[4]!)).toHaveLength(1);
    expect(rankingRewards(players[4]!)[0]!.reward).toMatchObject({ coins: 600, ranking: { rank: 1, titleId: "title-weekly-champion", newTitle: true } });
    expect(rankingRewards(players[4]!)[0]!.progress.ownedItemIds).toContain("title-weekly-champion");
    expect(rankingRewards(players[3]!)[0]!.reward).toMatchObject({ coins: 300, ranking: { rank: 2, titleId: "title-weekly-top" } });
    expect(rankingRewards(players[1]!)).toHaveLength(0);
    // 정산은 한 번뿐이고, 새 주의 주간 순위표는 비어 있다. 전체 순위는 남는다.
    await h.restore();
    await h.add();
    expect(rankingRewards(players[4]!)).toHaveLength(1);
    await h.game.action(players[0]!, "ranking:get", { puzzleId: "observatory", period: "week" });
    expect((players[0]!.frames.at(-1)!.payload as RankingPayload).participants).toBe(0);
    await h.game.action(players[0]!, "ranking:get", { puzzleId: "observatory", period: "all" });
    expect((players[0]!.frames.at(-1)!.payload as RankingPayload)).toMatchObject({ participants: 5, me: { rank: 5 } });
  });
  it("rejects solo guesses for another run and solo starts for unknown puzzles", async () => {
    const h = await harness(); const player = await h.add();
    await h.game.action(player, "solo:start", { puzzleId: "nope", nickname: "테스터" });
    expect(player.frames.at(-1)).toMatchObject({ event: "game:error", payload: { code: "PUZZLE_NOT_FOUND" } });
    await h.game.action(player, "solo:start", { puzzleId: "observatory", nickname: "테스터" });
    await h.game.action(player, "solo:guess", { runId: "forged", point: { x: 0.5, y: 0.5 } });
    expect(player.frames.at(-1)).toMatchObject({ event: "game:error", payload: { code: "SOLO_NOT_FOUND" } });
    const runId = (player.frames.find((f) => f.event === "solo:started")!.payload as SoloStartedPayload).runId;
    await h.game.action(player, "solo:guess", { runId, point: { x: 0.5, y: 0.5 } });
    expect(player.frames.at(-1)).toMatchObject({ event: "game:error", payload: { code: "SOLO_NOT_STARTED" } });
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
    expect(growthFrames(rich).at(-1)!.progress).toMatchObject({ coins: 200, loadout: { profile: "profile-sage" } });
    await h.game.action(rich, "shop:equip", { itemId: "title-curator" });
    expect(rich.frames.at(-1)).toMatchObject({ event: "game:error", payload: { code: "ITEM_LOCKED" } });
    const opponent = await h.add();
    await h.join(rich); await h.join(opponent);
    const found = opponent.frames.find((f) => f.event === "match:found")!.payload as MatchFoundPayload;
    expect(found.opponentCosmetics).toEqual({ avatar: "avatar-initial", profile: "profile-sage", title: "title-visitor" });
  });
  it("publishes the catalog without battle answers and sends each match its deck", async () => {
    const h = await harness();
    const payload = await h.game.catalogPayload();
    expect(payload.puzzles.some((card) => card.mode === "solo")).toBe(true);
    // 솔로 정답도 이제 서버만 안다(랭킹 기록을 서버가 재므로).
    expect(JSON.stringify(payload.puzzles)).not.toContain('"answers"');
    const { first } = await h.start();
    const found = first.frames.find((f) => f.event === "match:found")!.payload as MatchFoundPayload;
    expect(found.deck?.map((card) => card.id)).toEqual([GAME_PUZZLES[0]!.id]);
    expect(found.deck?.[0]).toMatchObject({ version: GAME_PUZZLES[0]!.assetVersion, mode: "battle" });
  });
  it("stamps snapshots with the server clock", async () => {
    const h = await harness(); const { first } = await h.start();
    expect(typeof h.snapshot(first).serverNowMs).toBe("number");
  });
  describe("Supabase growth backup", () => {
    function backupArchive() {
      const rows = new Map<string, GrowthBackup>();
      const state = { failSave: false, failFind: false, saves: 0 };
      const archive: Archive = {
        async save() {}, async report() { return "report"; },
        async saveGrowth(batch) {
          state.saves += 1;
          if (state.failSave) throw new Error("offline");
          for (const row of batch) rows.set(row.playerId, structuredClone(row));
        },
        async findGrowth(hash) {
          if (state.failFind) throw new Error("offline");
          const row = [...rows.values()].find((candidate) => candidate.tokenHash === hash);
          return row ? { playerId: row.playerId, growth: row.growth } : null;
        },
      };
      return { rows, state, archive };
    }
    const solo = (h: Awaited<ReturnType<typeof harness>>, peer: TestPeer) => h.playSolo(peer, "observatory", 3_000);
    const lastGrowth = (peer: TestPeer) => peer.frames.filter((f) => f.event === "player:growth").at(-1)!.payload as PlayerGrowthPayload;

    it("backs up changed growth in batches with a token hash, and retries after a failure", async () => {
      const db = backupArchive(); const h = await harness(db.archive);
      const a = await h.add(); const b = await h.add();
      await solo(h, a); const firstChange = h.now;
      await solo(h, b);
      expect(h.storage.alarm).toBe(firstChange + 10_000);
      await h.game.alarm();
      expect(db.state.saves).toBe(0);
      // 백업 전에 또 바뀐 기록은 같은 묶음으로 올라간다.
      await solo(h, a);
      h.advance(10_000); await h.game.alarm();
      expect(db.state.saves).toBe(1);
      expect(db.rows.get(a.playerId!)!.growth).toMatchObject({ totalXp: 60, coins: 40 });
      expect(db.rows.get(a.playerId!)!.tokenHash).toBe(await tokenHash(h.token(a)));
      expect(JSON.stringify([...db.rows.values()])).not.toContain(h.token(a));
      h.advance(60_000); await h.game.alarm();
      expect(db.state.saves).toBe(1);

      db.state.failSave = true;
      await solo(h, b);
      h.advance(10_000); await h.game.alarm();
      expect(db.state.saves).toBe(2);
      expect(db.rows.get(b.playerId!)!.growth.totalXp).toBe(30);
      // 실패하면 1분 뒤에 다시 시도한다(쉬지 않고 반복하지 않음).
      expect(h.storage.alarm).toBe(h.now + 60_000);
      h.advance(30_000); await h.game.alarm();
      expect(db.state.saves).toBe(2);
      db.state.failSave = false;
      await h.restore();
      h.advance(30_000); await h.game.alarm();
      expect(db.rows.get(b.playerId!)!.growth.totalXp).toBe(60);
    });

    it("restores a player removed from the Durable Object by their device token", async () => {
      const db = backupArchive(); const h = await harness(db.archive);
      const player = await h.add(); const token = h.token(player); const playerId = player.playerId!;
      await solo(h, player);
      h.advance(10_000); await h.game.alarm();
      await h.disconnect(player);
      h.advance(181 * 24 * 60 * 60_000); await h.game.alarm();
      expect(h.storage.data.has(`session:${playerId}`)).toBe(false);

      db.state.failFind = true;
      const blocked = await h.add(token);
      expect(blocked.frames.map((f) => f.event)).toEqual(["game:error"]);
      db.state.failFind = false;
      const back = await h.add(token);
      expect(back.playerId).toBe(playerId);
      expect(h.token(back)).toBe(token);
      expect(lastGrowth(back).progress).toMatchObject({ totalXp: 30, coins: 20 });

      const stranger = await h.add(crypto.randomUUID());
      expect(stranger.playerId).not.toBe(playerId);
      expect(lastGrowth(stranger).progress.totalXp).toBe(0);
    });

    it("never expires growth that is not backed up yet", async () => {
      const db = backupArchive(); db.state.failSave = true;
      const h = await harness(db.archive);
      const player = await h.add(); await solo(h, player); await h.disconnect(player);
      h.advance(181 * 24 * 60 * 60_000); await h.game.alarm();
      expect(h.storage.data.has(`session:${player.playerId}`)).toBe(true);
      expect(h.storage.alarm).toBe(h.now + 60_000);
      db.state.failSave = false;
      h.advance(60_000); await h.game.alarm();
      expect(db.rows.get(player.playerId!)!.growth.totalXp).toBe(30);
      h.advance(1); await h.game.alarm();
      expect(h.storage.data.has(`session:${player.playerId}`)).toBe(false);
    });
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

it("lets the Apps in Toss, Android and iOS apps connect with the deployed origin list", () => {
  for (const file of ["wrangler.toml", "wrangler.local.toml"]) {
    const toml = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const env = { ALLOWED_ORIGINS: /^ALLOWED_ORIGINS = "([^"]+)"/m.exec(toml)![1] };
    const request = (origin: string) => new Request("https://game.example/ws", { headers: { Origin: origin } });
    for (const origin of [
      "https://spot-difference-syk.web.tossmini.com",
      "https://spot-difference-syk.private-web.tossmini.com",
      "https://appassets.androidplatform.net",
      "capacitor://localhost",
    ]) expect(allowedOrigin(request(origin), env), `${file}: ${origin}`).toBe(true);
    expect(allowedOrigin(request("https://evil.example"), env)).toBe(false);
  }
});
