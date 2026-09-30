import { GameMatch, GameRuleError, type MatchPuzzle, type PersistedMatchState } from "@spot-battle/game-core";
import { DEFAULT_MATCH_SETTINGS, GAME_CONFIG, GAME_DIFFICULTIES, GAME_MODES, type MatchSettings } from "@spot-battle/shared";
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
}
interface StoredMatch { state: PersistedMatchState; finishedAt: number | null; archived: boolean; retiredPlayers?: string[] }
interface LiveMatch { match: GameMatch; finishedAt: number | null; archived: boolean; retiredPlayers?: string[] }
interface Waiting { playerId: string; nickname: string; settings: MatchSettings }
export interface Peer { id: string; playerId?: string; send(event: string, payload?: unknown): void; close(): void }
export interface Archive {
  save(state: PersistedMatchState): Promise<void>;
  report(input: { matchId: string; reporterPlayerId: string; reason: "UNFAIR" | "INAPPROPRIATE" | "SYSTEM_ERROR" | "OTHER"; details?: string }): Promise<string>;
}
const terminal = (match: GameMatch) => match.currentState === "FINISHED" || match.currentState === "CANCELLED";
const RETENTION = 5 * 60_000;
const SESSION_RETENTION = 7 * 24 * 60 * 60_000;
const MAX_MATCHES = 100;

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
      for (const player of live.match.snapshot().players) {
        const session = this.sessions.get(player.playerId);
        if (!session) throw new Error("Missing persisted participant session.");
        if (!liveIds.has(player.playerId)) {
          session.reconnectAt ??= this.now() + GAME_CONFIG.reconnectGraceSeconds * 1_000;
          live.match.setConnectionStatus(player.playerId, "RECONNECTING");
        }
      }
    }
    await this.checkpoint();
  }

  private emit(peer: Peer, event: string, payload?: unknown): void {
    this.emissions.push(() => peer.send(event, payload));
  }
  private current(playerId: string): LiveMatch | undefined {
    return [...this.matches.values()].find(({ match, retiredPlayers }) => !retiredPlayers?.includes(playerId) && match.snapshot().players.some((p) => p.playerId === playerId));
  }
  private broadcast(match: GameMatch): void {
    for (const peer of this.peers()) {
      if (peer.playerId && this.current(peer.playerId)?.match === match) this.emit(peer, "game:snapshot", match.snapshot(peer.playerId));
    }
  }
  private removeWaiting(playerId: string): void {
    for (const [key, player] of this.waiting) if (player.playerId === playerId) this.waiting.delete(key);
  }

  async authenticate(peer: Peer, token: unknown): Promise<void> {
    const session = typeof token === "string" ? [...this.sessions.values()].find((s) => s.guestToken === token) : undefined;
    const active = session ?? { playerId: crypto.randomUUID(), guestToken: crypto.randomUUID(), nickname: null, lastSeenAt: this.now(), reconnectAt: null };
    this.sessions.set(active.playerId, active);
    for (const old of this.peers()) if (old.id !== peer.id && old.playerId === active.playerId) old.close();
    peer.playerId = active.playerId;
    active.lastSeenAt = this.now();
    this.emit(peer, "session:ready", { playerId: active.playerId, guestToken: active.guestToken });
    await this.advance();
    active.reconnectAt = null;
    const live = this.current(active.playerId);
    if (live) {
      live.match.setConnectionStatus(active.playerId, "CONNECTED");
      const opponent = live.match.snapshot().players.find((p) => p.playerId !== active.playerId)!;
      this.emit(peer, "match:found", { matchId: live.match.matchId, playerId: active.playerId, opponentNickname: opponent.nickname });
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
      } else if (event === "queue:join") {
        this.join(peer, session, object(payload));
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
          if (previous !== undefined && this.now() - previous < 120) throw new GameRuleError("INPUT_RATE_LIMITED", "입력이 너무 빠릅니다. 잠시 후 다시 시도해주세요.");
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
    if (old) old.retiredPlayers = [...(old.retiredPlayers ?? []), session.playerId];
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
    for (const [target, name] of [[peer, waiting.nickname], [opponent, nickname]] as const) this.emit(target, "match:found", { matchId: match.matchId, playerId: target.playerId, opponentNickname: name });
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
      const deadline = match.snapshot().deadlineMs;
      if (match.currentState === "COUNTDOWN" && deadline !== null && this.now() >= deadline) match.expire(deadline);
      const changed = match.expire(this.now());
      for (const player of match.snapshot().players) {
        const session = this.sessions.get(player.playerId);
        if (session?.reconnectAt && this.now() >= session.reconnectAt) {
          session.reconnectAt = null;
          match.forfeit(player.playerId);
        }
      }
      if ((live.retiredPlayers?.length ?? 0) < 2 && (changed || terminal(match) || (deadline !== match.snapshot().deadlineMs))) this.broadcast(match);
      if (terminal(match)) live.finishedAt ??= this.now();
    }
  }

  async alarm(): Promise<void> {
    await this.advance();
    await this.checkpoint();
    await this.flushArchive();
  }

  async flushArchive(): Promise<void> {
    for (const live of this.matches.values()) {
      if (!terminal(live.match) || live.archived) continue;
      try {
        if (this.archive) await this.archive.save(live.match.serialize());
        live.archived = true;
        await this.storage.put(`match:${live.match.matchId}`, { state: live.match.serialize(), finishedAt: live.finishedAt, archived: true, retiredPlayers: live.retiredPlayers });
      } catch {
        // Keep the durable record and retry on the next alarm. Never log credentials.
        console.error(JSON.stringify({ event: "database.finished_match_save_failed", matchId: live.match.matchId }));
      }
      // Bound external I/O per alarm; remaining durable records are retried next time.
      if (this.archive) break;
    }
    await this.checkpoint();
  }

  private async putChanged(storage: Storage, key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    if (this.persisted.get(key) === serialized) return;
    await storage.put(key, value);
    this.persisted.set(key, serialized);
  }

  private async checkpoint(): Promise<void> {
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
    const activeIds = new Set(this.peers().map((p) => p.playerId));
    for (const [id, session] of this.sessions) {
      if (!activeIds.has(id) && !this.current(id) && now >= session.lastSeenAt + SESSION_RETENTION) {
        this.sessions.delete(id);
        await storage.delete(`session:${id}`);
      } else await this.putChanged(storage, `session:${id}`, session);
    }
    const deadlines: number[] = [];
    for (const live of this.matches.values()) {
      const deadline = live.match.snapshot().deadlineMs;
      if (!terminal(live.match) && deadline !== null) deadlines.push(deadline);
      if (live.finishedAt !== null) deadlines.push(live.archived ? live.finishedAt + RETENTION : now + 30_000);
    }
    for (const session of this.sessions.values()) {
      if (session.reconnectAt) deadlines.push(session.reconnectAt);
      if (!activeIds.has(session.playerId) && !this.current(session.playerId)) deadlines.push(session.lastSeenAt + SESSION_RETENTION);
    }
    if (deadlines.length) await storage.setAlarm(Math.max(now + 1, Math.min(...deadlines)));
    else await storage.deleteAlarm();
  }
}
