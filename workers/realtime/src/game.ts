import { GameMatch, GameRuleError, type MatchPuzzle, type PersistedMatchState } from "@spot-battle/game-core";
import { DEFAULT_MATCH_SETTINGS, GAME_CONFIG, GAME_DIFFICULTIES, GAME_MODES, buyCosmetic, emptyGrowth, equipCosmetic, SOLO_PUZZLE_IDS, grantSoloReward, growthView, matchJourney, settleMatch, normalizeGrowth, publicCosmetics, type MatchSettings, type PlayerGrowth, type PlayerGrowthPayload } from "@spot-battle/shared";
import { GAME_PUZZLES } from "../../../apps/server/src/game/puzzle-catalog.js";

export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  transaction?<T>(callback: (storage: Storage) => Promise<T>): Promise<T>;
}
interface Session {
  playerId: string;
  guestToken: string;
  nickname: string | null;
  lastSeenAt: number;
  reconnectAt: number | null;
  lastGuessAt?: number;
  /** 레벨·코인. 보상은 이 객체에만 기록해 세션과 함께 저장된다. */
  growth?: PlayerGrowth;
}
interface StoredMatch { state: PersistedMatchState; finishedAt: number | null; archived: boolean; retiredPlayers?: string[] }
interface LiveMatch { match: GameMatch; finishedAt: number | null; archived: boolean; retiredPlayers?: string[] }
interface Waiting { playerId: string; nickname: string; settings: MatchSettings }
export interface Peer { id: string; playerId?: string; send(event: string, payload?: unknown): void; close(): void }
export interface Archive {
  save(state: PersistedMatchState): Promise<void>;
  report(input: { matchId: string; reporterPlayerId: string; reason: "UNFAIR" | "INAPPROPRIATE" | "SYSTEM_ERROR" | "OTHER"; details?: string }): Promise<string>;
}
const terminal = (match: GameMatch) => match.isTerminal;
const RETENTION = 5 * 60_000;
const SESSION_RETENTION = 7 * 24 * 60 * 60_000;
/** Sessions that never queued (no nickname) are cheap to recreate, so keep them briefly. */
const ANONYMOUS_SESSION_RETENTION = 60 * 60_000;
/** Players with levels or coins are kept much longer than plain guests. */
const GROWTH_SESSION_RETENTION = 180 * 24 * 60 * 60_000;
const MAX_SESSIONS = 5_000;
const MAX_MATCHES = 100;
/** Bound external database I/O per alarm. */
const ARCHIVE_BATCH = 10;
const GUESS_INTERVAL_MS = 120;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GameRuleError("INVALID_PAYLOAD", "요청 형식이 올바르지 않습니다.");
  return value as Record<string, unknown>;
}
function string(input: Record<string, unknown>, key: string): string {
  if (typeof input[key] !== "string") throw new GameRuleError("INVALID_PAYLOAD", "요청 값이 올바르지 않습니다.");
  return input[key];
}

/** One bounded MVP lobby; only this object owns its queue and authoritative matches. */
export class RealtimeGame {
  private sessions = new Map<string, Session>();
  private matches = new Map<string, LiveMatch>();
  private waiting = new Map<string, Waiting>();
  private emissions: Array<() => void> = [];
  private persisted = new Map<string, string>();
  private evicted: string[] = [];

  constructor(
    private storage: Storage,
    private peers: () => Peer[],
    private catalog: readonly MatchPuzzle[] = GAME_PUZZLES,
    private archive?: Archive,
    private now: () => number = Date.now,
  ) {}

  async restore(): Promise<void> {
    this.sessions = new Map([...await this.storage.list<Session>({ prefix: "session:" })].map(([, s]) => [s.playerId, s]));
    for (const [, saved] of await this.storage.list<StoredMatch>({ prefix: "match:" })) {
      this.matches.set(saved.state.matchId, { match: GameMatch.restore(saved.state), finishedAt: saved.finishedAt, archived: saved.archived, retiredPlayers: saved.retiredPlayers });
    }
    // Queues are ephemeral. Clients rejoin after connection loss; hibernating sockets survive.
    this.waiting = new Map(await this.storage.get<Array<[string, Waiting]>>("waiting") ?? []);
    const liveIds = new Set(this.peers().map((p) => p.playerId));
    for (const [key, waiting] of this.waiting) if (!liveIds.has(waiting.playerId)) this.waiting.delete(key);
    for (const live of this.matches.values()) {
      if (terminal(live.match)) continue;
      for (const playerId of live.match.playerIds) {
        const session = this.sessions.get(playerId);
        if (!session) {
          // A missing session must not brick the whole lobby; the match cannot resume for that player.
          console.error(JSON.stringify({ event: "game.missing_participant_session", matchId: live.match.matchId }));
          live.match.forfeit(playerId);
          continue;
        }
        if (!liveIds.has(playerId)) {
          session.reconnectAt ??= this.now() + GAME_CONFIG.reconnectGraceSeconds * 1_000;
          live.match.setConnectionStatus(playerId, "RECONNECTING");
        }
      }
    }
    await this.checkpoint();
  }

  private emit(peer: Peer, event: string, payload?: unknown): void {
    this.emissions.push(() => peer.send(event, payload));
  }
  private current(playerId: string): LiveMatch | undefined {
    for (const live of this.matches.values()) {
      if (!live.retiredPlayers?.includes(playerId) && live.match.playerIds.includes(playerId)) return live;
    }
    return undefined;
  }
  private snapshotFor(match: GameMatch, playerId: string) {
    return { ...match.snapshot(playerId), serverNowMs: this.now() };
  }
  private broadcast(match: GameMatch): void {
    const live = this.matches.get(match.matchId);
    const recipients = match.playerIds.filter((id) => !live?.retiredPlayers?.includes(id));
    if (!recipients.length) return;
    for (const peer of this.peers()) {
      if (peer.playerId && recipients.includes(peer.playerId)) this.emit(peer, "game:snapshot", this.snapshotFor(match, peer.playerId));
    }
  }
  private removeWaiting(playerId: string): void {
    for (const [key, player] of this.waiting) if (player.playerId === playerId) this.waiting.delete(key);
  }

  async authenticate(peer: Peer, token: unknown): Promise<void> {
    const session = typeof token === "string" && token ? [...this.sessions.values()].find((s) => s.guestToken === token) : undefined;
    if (!session && this.sessions.size >= MAX_SESSIONS && !this.evictIdleSession()) {
      this.emit(peer, "game:error", { code: "SERVER_BUSY", message: "접속자가 많습니다. 잠시 후 다시 시도해주세요." });
      // The unauthenticated socket is closed by the auth deadline and the client retries later.
      await this.checkpoint();
      return;
    }
    const active = session ?? { playerId: crypto.randomUUID(), guestToken: crypto.randomUUID(), nickname: null, lastSeenAt: this.now(), reconnectAt: null };
    this.sessions.set(active.playerId, active);
    for (const old of this.peers()) if (old.id !== peer.id && old.playerId === active.playerId) old.close();
    peer.playerId = active.playerId;
    active.lastSeenAt = this.now();
    this.emit(peer, "session:ready", { playerId: active.playerId, guestToken: active.guestToken });
    this.emit(peer, "player:growth", this.growthPayload(active));
    await this.advance();
    active.reconnectAt = null;
    // A finished match the player has not dismissed is shown again (e.g. forfeited while offline).
    const live = this.current(active.playerId);
    if (live) {
      live.match.setConnectionStatus(active.playerId, "CONNECTED");
      const opponent = live.match.snapshot(active.playerId).players.find((p) => p.playerId !== active.playerId)!;
      this.emit(peer, "match:found", { matchId: live.match.matchId, playerId: active.playerId, opponentNickname: opponent.nickname, opponentCosmetics: this.cosmeticsOf(opponent.playerId) });
      this.broadcast(live.match);
    }
    await this.checkpoint();
  }

  async action(peer: Peer, event: string, payload?: unknown): Promise<void> {
    if (!peer.playerId) throw new GameRuleError("UNAUTHENTICATED", "다시 연결해주세요.");
    const session = this.sessions.get(peer.playerId);
    if (!session) throw new Error("Missing session.");
    session.lastSeenAt = this.now();
    try {
      await this.advance();
      if (event === "queue:leave") {
        this.removeWaiting(peer.playerId);
        this.emit(peer, "queue:left");
      } else if (event === "game:dismiss") {
        const input = object(payload);
        const live = this.current(peer.playerId);
        // Only finished matches can be dismissed; an active match must be forfeited instead.
        if (live && live.match.matchId === string(input, "matchId") && terminal(live.match)) {
          live.retiredPlayers = [...(live.retiredPlayers ?? []), peer.playerId];
        }
      } else if (event === "queue:join") {
        this.join(peer, session, object(payload));
      } else if (event === "shop:buy" || event === "shop:equip") {
        const itemId = string(object(payload), "itemId");
        const growth = this.growthOf(session);
        const level = growthView(growth, this.now()).level;
        const result = event === "shop:buy" ? buyCosmetic(growth, level, itemId) : equipCosmetic(growth, level, itemId);
        if (!result.ok) throw new GameRuleError(result.code, result.message);
        session.growth = result.growth;
        this.emit(peer, "player:growth", this.growthPayload(session));
      } else if (event === "solo:complete") {
        const input = object(payload);
        if (typeof input.puzzleId !== "string" || typeof input.elapsedMs !== "number") throw new GameRuleError("INVALID_PAYLOAD", "솔로 기록 형식이 올바르지 않습니다.");
        const before = this.growthOf(session);
        const soloId = (SOLO_PUZZLE_IDS as readonly string[]).includes(input.puzzleId) ? input.puzzleId : undefined;
        const result = grantSoloReward(before, input.elapsedMs, this.now(), soloId);
        if (result.progress !== before) session.growth = result.progress;
        this.emit(peer, "player:growth", this.growthPayload(session, {
          ...(result.reward ? { reward: result.reward } : {}),
          ...(result.limitReached ? { soloLimitReached: true } : {}),
        }));
      } else {
        const input = object(payload);
        const live = this.current(peer.playerId);
        if (!live || live.match.matchId !== string(input, "matchId")) throw new GameRuleError("MATCH_NOT_FOUND", "참가 중인 경기를 찾을 수 없습니다.");
        const match = live.match;
        if (event === "game:ready") match.markReady(peer.playerId, this.now());
        else if (event === "game:loaded") match.markLoaded(peer.playerId, string(input, "puzzleId") as MatchPuzzle["id"], string(input, "puzzleVersion"), this.now());
        else if (event === "game:guess") {
          this.assertState(match, peer.playerId, input, true);
          const point = object(input.point);
          if (![point.x, point.y].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) throw new GameRuleError("INVALID_POINT", "선택 좌표가 올바르지 않습니다.");
          const previous = session.lastGuessAt;
          if (previous !== undefined && this.now() - previous < GUESS_INTERVAL_MS) throw new GameRuleError("INPUT_RATE_LIMITED", "입력이 너무 빠릅니다. 잠시 후 다시 시도해주세요.");
          session.lastGuessAt = this.now();
          const result = match.guess(peer.playerId, string(input, "puzzleId") as MatchPuzzle["id"], { x: point.x as number, y: point.y as number }, this.now());
          this.emit(peer, "game:guess-result", result);
        } else if (event === "game:forfeit") {
          this.assertState(match, peer.playerId, input);
          match.forfeit(peer.playerId);
        } else if (event === "game:report") {
          this.assertState(match, peer.playerId, input);
          if (!terminal(match)) throw new GameRuleError("MATCH_NOT_FINISHED", "경기 종료 후 신고할 수 있습니다.");
          if (!["UNFAIR", "INAPPROPRIATE", "SYSTEM_ERROR", "OTHER"].includes(input.reason as string) || (input.details !== undefined && typeof input.details !== "string")) throw new GameRuleError("INVALID_REPORT", "신고 내용이 올바르지 않습니다.");
          const key = `report:${match.matchId}:${peer.playerId}`;
          if (await this.storage.get(key)) throw new GameRuleError("DUPLICATE_REPORT", "이미 이 경기를 신고했습니다.");
          const report = { matchId: match.matchId, reporterPlayerId: peer.playerId, reason: input.reason as Parameters<Archive["report"]>[0]["reason"], details: typeof input.details === "string" ? input.details.trim().slice(0, 500) : undefined };
          // Archive before a DB report because reports reference the completed match.
          if (this.archive && !live.archived) {
            await this.archive.save(match.serialize());
            live.archived = true;
          }
          const reportId = this.archive ? await this.archive.report(report) : crypto.randomUUID();
          await this.storage.put(key, { reportId, ...report });
          this.emit(peer, "game:report-result", { reportId });
        } else throw new GameRuleError("INVALID_EVENT", "지원하지 않는 요청입니다.");
        this.broadcast(match);
      }
    } catch (error) {
      const rule = error instanceof GameRuleError;
      this.emit(peer, "game:error", { code: rule ? error.code : "INTERNAL_ERROR", message: rule ? error.message : "경기 처리 중 오류가 발생했습니다." });
      if (!rule) console.error(JSON.stringify({ event: "game.internal_error" }));
    }
    await this.checkpoint();
  }

  private join(peer: Peer, session: Session, input: Record<string, unknown>): void {
    const old = this.current(session.playerId);
    if (old && !terminal(old.match)) throw new GameRuleError("ALREADY_IN_MATCH", "진행 중인 경기를 먼저 마쳐주세요.");
    const nickname = string(input, "nickname").trim().slice(0, 16);
    if (nickname.length < 2) throw new GameRuleError("INVALID_NICKNAME", "닉네임은 2자 이상이어야 합니다.");
    const raw = input.settings === undefined ? DEFAULT_MATCH_SETTINGS : object(input.settings);
    if (!GAME_MODES.includes(raw.mode as never) || !GAME_DIFFICULTIES.includes(raw.difficulty as never)) throw new GameRuleError("INVALID_SETTINGS", "지원하지 않는 게임 설정입니다.");
    const settings = { mode: raw.mode, difficulty: raw.difficulty } as MatchSettings;
    // Finished matches remain available for reports until the player queues again.
    if (old) old.retiredPlayers = [...new Set([...(old.retiredPlayers ?? []), session.playerId])];
    session.nickname = nickname;
    this.removeWaiting(session.playerId);
    const key = `${settings.mode}:${settings.difficulty}`;
    const waiting = this.waiting.get(key);
    const opponent = waiting && this.peers().find((p) => p.playerId === waiting.playerId);
    if (!waiting || !opponent) {
      this.waiting.set(key, { playerId: session.playerId, nickname, settings });
      return;
    }
    if ([...this.matches.values()].filter((m) => !terminal(m.match)).length >= MAX_MATCHES) throw new GameRuleError("SERVER_BUSY", "잠시 후 다시 시도해주세요.");
    const puzzles = [...this.catalog];
    for (let i = puzzles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [puzzles[i], puzzles[j]] = [puzzles[j]!, puzzles[i]!];
    }
    const match = new GameMatch(crypto.randomUUID(), puzzles, [{ playerId: waiting.playerId, nickname: waiting.nickname }, { playerId: session.playerId, nickname }], this.now(), settings);
    this.matches.set(match.matchId, { match, finishedAt: null, archived: false });
    this.waiting.delete(key);
    for (const [target, name, opponentId] of [[peer, waiting.nickname, waiting.playerId], [opponent, nickname, session.playerId]] as const) {
      this.emit(target, "match:found", { matchId: match.matchId, playerId: target.playerId, opponentNickname: name, opponentCosmetics: this.cosmeticsOf(opponentId) });
    }
    this.broadcast(match);
  }

  private assertState(match: GameMatch, playerId: string, input: Record<string, unknown>, concurrent = false): void {
    const snapshot = match.snapshot(playerId);
    const version = input.expectedStateVersion;
    if (snapshot.state !== input.expectedState || !Number.isInteger(version) || (version as number) < 0 || (concurrent ? (version as number) > snapshot.stateVersion : version !== snapshot.stateVersion)) throw new GameRuleError("STALE_STATE", "경기 상태가 변경되었습니다. 다시 시도해주세요.");
  }

  async disconnect(peer: Peer): Promise<void> {
    if (!peer.playerId || this.peers().some((p) => p.id !== peer.id && p.playerId === peer.playerId)) return;
    this.removeWaiting(peer.playerId);
    const session = this.sessions.get(peer.playerId);
    if (session) {
      session.lastSeenAt = this.now();
      const live = this.current(peer.playerId);
      if (live && !terminal(live.match)) {
        session.reconnectAt = this.now() + GAME_CONFIG.reconnectGraceSeconds * 1_000;
        live.match.setConnectionStatus(peer.playerId, "RECONNECTING");
        this.broadcast(live.match);
      }
    }
    await this.checkpoint();
  }

  private async advance(): Promise<void> {
    for (const live of this.matches.values()) {
      const { match } = live;
      // Use the intended countdown deadline, even if an alarm arrives late.
      if (terminal(match)) {
        live.finishedAt ??= this.now();
        continue;
      }
      const deadline = match.deadline;
      const before = match.version;
      if (match.currentState === "COUNTDOWN" && deadline !== null && this.now() >= deadline) match.expire(deadline);
      match.expire(this.now());
      for (const playerId of match.playerIds) {
        const session = this.sessions.get(playerId);
        if (session?.reconnectAt && this.now() >= session.reconnectAt) {
          session.reconnectAt = null;
          match.forfeit(playerId);
        }
      }
      if (match.version !== before) this.broadcast(match);
      if (terminal(match)) live.finishedAt ??= this.now();
    }
  }

  async alarm(): Promise<void> {
    await this.advance();
    await this.checkpoint();
    await this.flushArchive();
  }

  async flushArchive(): Promise<void> {
    let attempts = 0;
    for (const live of this.matches.values()) {
      if (!terminal(live.match) || live.archived) continue;
      // Bound external I/O per alarm; remaining durable records are retried next time.
      if (this.archive && attempts >= ARCHIVE_BATCH) break;
      attempts += 1;
      try {
        if (this.archive) await this.archive.save(live.match.serialize());
        live.archived = true;
        await this.storage.put(`match:${live.match.matchId}`, { state: live.match.serialize(), finishedAt: live.finishedAt, archived: true, retiredPlayers: live.retiredPlayers });
      } catch {
        // Keep the durable record and retry on the next alarm. Never log credentials.
        console.error(JSON.stringify({ event: "database.finished_match_save_failed", matchId: live.match.matchId }));
        // The database is likely down; stop and retry later instead of hammering it.
        break;
      }
    }
    await this.checkpoint();
  }

  private sessionRetention(session: Session): number {
    if ((session.growth?.totalXp ?? 0) > 0) return GROWTH_SESSION_RETENTION;
    return session.nickname === null ? ANONYMOUS_SESSION_RETENTION : SESSION_RETENTION;
  }

  private growthOf(session: Session): PlayerGrowth {
    return session.growth ? normalizeGrowth(session.growth) : emptyGrowth();
  }

  private cosmeticsOf(playerId: string) {
    const session = this.sessions.get(playerId);
    return publicCosmetics((session ? this.growthOf(session) : emptyGrowth()).loadout);
  }

  private growthPayload(session: Session, extra: Omit<PlayerGrowthPayload, "progress"> = {}): PlayerGrowthPayload {
    return { progress: growthView(this.growthOf(session), this.now()), ...extra };
  }

  /** Grants each finished match once; the growth record remembers rewarded match IDs. */
  private rewardFinished(): void {
    for (const live of this.matches.values()) {
      const { match } = live;
      if (match.currentState !== "FINISHED") continue;
      const snapshot = match.snapshot();
      const state = match.serialize();
      for (const player of snapshot.players) {
        const session = this.sessions.get(player.playerId);
        if (!session) continue;
        const settled = settleMatch(this.growthOf(session), match.matchId, snapshot, player.playerId, matchJourney(state, player.playerId), this.now());
        if (!settled) continue;
        session.growth = settled.progress;
        const payload = this.growthPayload(session, { ...(settled.reward ? { reward: settled.reward } : {}), matchId: match.matchId });
        for (const peer of this.peers()) if (peer.playerId === player.playerId) this.emit(peer, "player:growth", payload);
      }
    }
  }

  /** Frees the least recently seen offline session that is not in a match. */
  private evictIdleSession(): boolean {
    const activeIds = new Set(this.peers().map((p) => p.playerId));
    let oldest: Session | undefined;
    const hasGrowth = (session: Session) => (session.growth?.totalXp ?? 0) > 0;
    for (const session of this.sessions.values()) {
      if (activeIds.has(session.playerId) || this.current(session.playerId)) continue;
      // Evict guests without levels before anyone who has earned progress.
      if (!oldest || (hasGrowth(oldest) && !hasGrowth(session)) || (hasGrowth(oldest) === hasGrowth(session) && session.lastSeenAt < oldest.lastSeenAt)) oldest = session;
    }
    if (!oldest) return false;
    this.sessions.delete(oldest.playerId);
    this.evicted.push(oldest.playerId);
    return true;
  }

  private async putChanged(storage: Storage, key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (this.persisted.get(key) === serialized) return;
    await storage.put(key, value);
    this.persisted.set(key, serialized);
  }

  private async checkpoint(): Promise<void> {
    this.rewardFinished();
    const previous = new Map(this.persisted);
    try {
      if (this.storage.transaction) await this.storage.transaction((storage) => this.persistCheckpoint(storage));
      else await this.persistCheckpoint(this.storage);
    } catch (error) {
      this.persisted = previous;
      throw error;
    }
    const emissions = this.emissions.splice(0);
    for (const send of emissions) { try { send(); } catch { /* A closed socket is handled by disconnect. */ } }
  }

  private async persistCheckpoint(storage: Storage): Promise<void> {
    const now = this.now();
    for (const [id, live] of this.matches) {
      if (terminal(live.match)) live.finishedAt ??= now;
      if (live.finishedAt !== null && live.archived && (live.retiredPlayers?.length === 2 || now >= live.finishedAt + RETENTION)) {
        await this.putChanged(storage, `history:${id}`, live.match.serialize());
        await storage.delete(`match:${id}`);
        this.persisted.delete(`match:${id}`);
        this.matches.delete(id);
      }
    }
    // Removed finished matches are retained durably, including when users start another match.
    for (const [id, live] of this.matches) await this.putChanged(storage, `match:${id}`, { state: live.match.serialize(), finishedAt: live.finishedAt, archived: live.archived, retiredPlayers: live.retiredPlayers });
    await this.putChanged(storage, "waiting", [...this.waiting]);
    for (const id of this.evicted.splice(0)) {
      await storage.delete(`session:${id}`);
      this.persisted.delete(`session:${id}`);
    }
    const activeIds = new Set(this.peers().map((p) => p.playerId));
    for (const [id, session] of this.sessions) {
      if (!activeIds.has(id) && !this.current(id) && now >= session.lastSeenAt + this.sessionRetention(session)) {
        this.sessions.delete(id);
        await storage.delete(`session:${id}`);
      } else await this.putChanged(storage, `session:${id}`, session);
    }
    const deadlines: number[] = [];
    for (const live of this.matches.values()) {
      const deadline = live.match.deadline;
      if (!terminal(live.match) && deadline !== null) deadlines.push(deadline);
      if (live.finishedAt !== null) deadlines.push(live.archived ? live.finishedAt + RETENTION : now + 30_000);
    }
    for (const session of this.sessions.values()) {
      if (session.reconnectAt) deadlines.push(session.reconnectAt);
      if (!activeIds.has(session.playerId) && !this.current(session.playerId)) deadlines.push(session.lastSeenAt + this.sessionRetention(session));
    }
    if (deadlines.length) await storage.setAlarm(Math.max(now + 1, Math.min(...deadlines)));
    else await storage.deleteAlarm();
  }
}
