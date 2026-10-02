import cors from "@fastify/cors";
import { GameMatch, GameRuleError, type MatchPuzzle } from "@spot-battle/game-core";
import {
  DEFAULT_MATCH_SETTINGS,
  GAME_CONFIG,
  GAME_DIFFICULTIES,
  GAME_MODES,
  buyCosmetic,
  emptyGrowth,
  equipCosmetic,
  grantRankingReward,
  grantSoloReward,
  growthView,
  matchJourney,
  publicCosmetics,
  settleMatch,
  type ClientToServerEvents,
  type MatchSettings,
  type PlayerGrowth,
  type PlayerGrowthPayload,
  type PublicCosmetics,
  type ServerToClientEvents,
  type SoloRun,
} from "@spot-battle/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { Server, type Socket } from "socket.io";
import {
  GuestSessionRegistry,
  type GuestSession,
} from "./sessions/guest-session-registry.js";
import { MatchRegistry } from "./game/match-registry.js";
import { InMemoryMatchStore, type MatchStore } from "./persistence/match-store.js";
import { operationalLogFields } from "./observability/operational-logging.js";
import { GAME_PUZZLES } from "./game/puzzle-catalog.js";
import { CatalogService, codeCatalog } from "./game/catalog-service.js";
import { SoloLeague } from "./game/solo-league.js";

export interface GameServerOptions {
  webOrigin?: string | RegExp;
  logger?: boolean;
  reconnectGraceMs?: number;
  inputCooldownMs?: number;
  /** 종료 결과 재조회·신고를 허용한 뒤 서버 메모리에서 경기를 제거하기까지의 시간. */
  finishedMatchRetentionMs?: number;
  /** 연결과 경기 활동이 없는 게스트 세션을 보존하는 시간. */
  guestSessionRetentionMs?: number;
  /** 비활성 게스트 세션을 확인하는 주기. */
  guestSessionCleanupIntervalMs?: number;
  matchStore?: MatchStore;
  puzzles?: readonly MatchPuzzle[];
  /** DB 카탈로그 등 외부에서 만든 카탈로그. 없으면 puzzles(또는 코드 카탈로그)로 만든다. */
  catalog?: CatalogService;
  /** 통합 테스트 등에서 특정 장면으로 매칭을 고정한다. */
  sceneId?: string;
  /** 솔로 판의 시계. 통합 테스트에서 카운트다운을 기다리지 않으려고 바꾼다. */
  soloClock?: () => number;
}

interface SocketData {
  playerId: string;
  guestToken: string;
}

function requirePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GameRuleError("INVALID_PAYLOAD", "요청 형식이 올바르지 않습니다.");
  }
  return value as Record<string, unknown>;
}

function requireStringField(payload: unknown, field: string): string {
  const value = requirePayload(payload)[field];
  if (typeof value !== "string") {
    throw new GameRuleError("INVALID_PAYLOAD", `${field} 값이 올바르지 않습니다.`);
  }
  return value;
}

function requireActionContext(payload: unknown): { expectedState: string; expectedStateVersion: number } {
  const input = requirePayload(payload);
  if (typeof input.expectedState !== "string" || !Number.isInteger(input.expectedStateVersion)) {
    throw new GameRuleError("INVALID_PAYLOAD", "경기 상태 정보가 올바르지 않습니다.");
  }
  return {
    expectedState: input.expectedState,
    expectedStateVersion: input.expectedStateVersion as number,
  };
}

function requirePoint(payload: unknown): { x: number; y: number } {
  const point = requirePayload(payload).point;
  if (!point || typeof point !== "object" || Array.isArray(point)) {
    throw new GameRuleError("INVALID_POINT", "선택 좌표가 올바르지 않습니다.");
  }
  const { x, y } = point as Record<string, unknown>;
  if (
    typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1 ||
    typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1
  ) {
    throw new GameRuleError("INVALID_POINT", "선택 좌표가 올바르지 않습니다.");
  }
  return { x, y };
}

type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

export async function createGameServer(options: GameServerOptions): Promise<FastifyInstance> {
  const catalogService = options.catalog ?? new CatalogService(codeCatalog(options.puzzles ?? GAME_PUZZLES));
  const catalog = catalogService.catalog.battle;
  if (!catalog.length) throw new Error("Puzzle catalog is empty.");
  const requestedPuzzle = options.sceneId ? catalog.find((puzzle) => puzzle.id === options.sceneId) : undefined;
  if (options.sceneId && !requestedPuzzle) throw new Error(`GAME_SCENE_ID "${options.sceneId}" is absent from the active catalog.`);
  const app = Fastify({ logger: options.logger ?? false });
  if (options.webOrigin) {
    await app.register(cors, { origin: options.webOrigin });
  }
  const matchStore = options.matchStore ?? new InMemoryMatchStore();
  app.get("/catalog", async (_request, reply) => {
    const current = await catalogService.fresh();
    reply.header("Cache-Control", "public, max-age=60");
    return { puzzles: current.cards };
  });

  app.get("/health", async (_request, reply) => {
    const database = await matchStore.health();
    if (!database) reply.code(503);
    return { status: database ? "ok" : "degraded", server: "ok", database };
  });

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(app.server, {
    cors: options.webOrigin ? { origin: options.webOrigin } : undefined,
  });
  const registry = new MatchRegistry(requestedPuzzle ? [requestedPuzzle] : catalog);
  const deckFor = (match: GameMatch) => catalogService.deckCards(match.serialize().puzzles);
  const guestSessionRetentionMs = options.guestSessionRetentionMs ?? 7 * 24 * 60 * 60 * 1_000;
  const guestSessionCleanupIntervalMs = options.guestSessionCleanupIntervalMs ?? 60 * 1_000;
  const sessions = new GuestSessionRegistry(guestSessionRetentionMs);
  const growthByPlayer = new Map<string, PlayerGrowth>();
  // 로컬 개발 서버의 솔로 랭킹은 메모리에만 둔다. 운영 Worker는 Durable Object에 저장한다.
  const soloClock = options.soloClock ?? Date.now;
  const league = new SoloLeague(catalogService, undefined, soloClock);
  const soloRuns = new Map<string, SoloRun>();
  /** 레벨·코인이 있는 게스트는 오래 보존한다. */
  const growthRetentionMs = 180 * 24 * 60 * 60 * 1_000;
  const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const finishedMatchCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const persistedMatches = new Set<string>();
  const runtimeWrites = new Map<string, Promise<void>>();
  const guestWrites = new Set<Promise<void>>();
  const reconnectGraceMs =
    options.reconnectGraceMs ?? GAME_CONFIG.reconnectGraceSeconds * 1_000;
  const inputCooldownMs = options.inputCooldownMs ?? 120;
  const finishedMatchRetentionMs = options.finishedMatchRetentionMs ?? 5 * 60 * 1_000;
  type WaitingPlayer = { playerId: string; socketId: string; nickname: string; settings: MatchSettings };
  const waitingPlayers = new Map<string, WaitingPlayer>();
  const queueKey = ({ mode, difficulty }: MatchSettings) => `${mode}:${difficulty}`;
  const removeWaitingPlayer = (playerId: string) => {
    for (const [key, player] of waitingPlayers) {
      if (player.playerId === playerId) waitingPlayers.delete(key);
    }
  };
  let closing = false;

  function logOperationError(
    event: string,
    error: unknown,
    context: Parameters<typeof operationalLogFields>[1] = {},
  ): void {
    app.log.error(operationalLogFields(event, context, error), event);
  }

  function logOperationWarning(
    event: string,
    context: Parameters<typeof operationalLogFields>[1] = {},
  ): void {
    app.log.warn(operationalLogFields(event, context), event);
  }

  function trackGuestWrite(write: Promise<void>): void {
    const handled = write.catch((error) =>
      logOperationError("database.guest_write_failed", error),
    );
    guestWrites.add(handled);
    void handled.finally(() => guestWrites.delete(handled));
  }

  function persistGuest(session: GuestSession): void {
    trackGuestWrite(matchStore.upsertGuest(session));
  }

  function deleteGuest(session: GuestSession): void {
    growthByPlayer.delete(session.playerId);
    trackGuestWrite(matchStore.deleteGuest(session.playerId));
  }

  function growthOf(playerId: string): PlayerGrowth {
    return growthByPlayer.get(playerId) ?? emptyGrowth();
  }

  function storeGrowth(playerId: string, growth: PlayerGrowth): void {
    growthByPlayer.set(playerId, growth);
    trackGuestWrite(matchStore.saveGrowth(playerId, growth));
  }

  function growthPayload(playerId: string, extra: Omit<PlayerGrowthPayload, "progress"> = {}): PlayerGrowthPayload {
    return { progress: growthView(growthOf(playerId)), ...extra };
  }

  /** 지난주 솔로 랭킹 보상을 한 번만 나눠 준다. 접속 중이면 바로 알린다. */
  function settleRanking(): void {
    for (const grant of league.settle()) {
      if (growthByPlayer.has(grant.playerId)) giveRankingReward(grant.playerId, [grant]);
      else league.hold(grant);
    }
  }

  function giveRankingReward(playerId: string, grants: ReturnType<SoloLeague["takePending"]>): void {
    for (const grant of grants) {
      const granted = grantRankingReward(growthOf(playerId), grant, Date.now());
      if (!granted) continue;
      storeGrowth(playerId, granted.progress);
      io.to(playerId).emit("player:growth", growthPayload(playerId, { reward: granted.reward }));
    }
  }

  function onlineCosmetics(): Map<string, PublicCosmetics> {
    return new Map([...growthByPlayer].map(([id, growth]) => [id, publicCosmetics(growth.loadout)]));
  }

  function opponentCosmetics(opponentId: string | undefined) {
    return publicCosmetics(growthOf(opponentId ?? "").loadout);
  }

  function hasProtectedGrowth(playerId: string, now: number): boolean {
    const session = sessions.getByPlayer(playerId);
    return (growthByPlayer.get(playerId)?.totalXp ?? 0) > 0 && !!session && now - session.lastSeenAt < growthRetentionMs;
  }

  /** 종료된 경기의 보상을 한 번만 지급한다. 여러 종료 경로에서 불려도 안전하다. */
  function rewardIfFinished(match: GameMatch): void {
    if (match.currentState !== "FINISHED") return;
    const snapshot = match.snapshot();
    const state = match.serialize();
    for (const player of snapshot.players) {
      const settled = settleMatch(growthOf(player.playerId), match.matchId, snapshot, player.playerId, matchJourney(state, player.playerId));
      if (!settled) continue;
      storeGrowth(player.playerId, settled.progress);
      io.to(player.playerId).emit("player:growth", growthPayload(player.playerId, { ...(settled.reward ? { reward: settled.reward } : {}), matchId: match.matchId }));
    }
  }

  function createSession(): GuestSession {
    const session = sessions.create();
    persistGuest(session);
    return session;
  }

  io.use((socket, next) => {
    const requestedToken = socket.handshake.auth.guestToken;
    const session =
      typeof requestedToken === "string" ? sessions.getByToken(requestedToken) : undefined;
    const activeSession = session ?? createSession();
    socket.data.playerId = activeSession.playerId;
    socket.data.guestToken = activeSession.guestToken;
    next();
  });

  function emitSnapshots(match: GameMatch): void {
    for (const player of match.snapshot().players) {
      io.to(player.playerId).emit("game:snapshot", { ...match.snapshot(player.playerId), serverNowMs: Date.now() });
    }
    if (match.currentState !== "FINISHED" && match.currentState !== "CANCELLED") {
      void persistRuntime(match).catch((error) => app.log.error(error));
    }
  }

  function persistRuntime(match: GameMatch): Promise<void> {
    const matchId = match.matchId;
    const state =
      match.currentState === "FINISHED" || match.currentState === "CANCELLED"
        ? null
        : match.serialize();
    const previous = runtimeWrites.get(matchId) ?? Promise.resolve();
    const next = previous
      .catch((error) => app.log.error(error))
      .then(async () => {
        if (state) await matchStore.saveActiveMatch(state);
        else await matchStore.deleteActiveMatch(matchId);
      });
    runtimeWrites.set(matchId, next);
    const clearWrite = () => {
      if (runtimeWrites.get(matchId) === next) runtimeWrites.delete(matchId);
    };
    void next.then(clearWrite, clearWrite);
    return next;
  }

  function scheduleFinishedMatchCleanup(match: GameMatch): void {
    if (finishedMatchCleanupTimers.has(match.matchId)) return;

    const timer = setTimeout(() => {
      finishedMatchCleanupTimers.delete(match.matchId);
      registry.remove(match.matchId);
      persistedMatches.delete(match.matchId);
    }, finishedMatchRetentionMs);
    timer.unref();
    finishedMatchCleanupTimers.set(match.matchId, timer);
  }

  async function persistIfFinished(match: GameMatch): Promise<boolean> {
    rewardIfFinished(match);
    if (
      persistedMatches.has(match.matchId) ||
      (match.currentState !== "FINISHED" && match.currentState !== "CANCELLED")
    ) {
      return true;
    }
    try {
      await matchStore.saveMatch(match.snapshot(), match.serialize());
      await persistRuntime(match);
      persistedMatches.add(match.matchId);
      scheduleFinishedMatchCleanup(match);
      return true;
    } catch (error) {
      logOperationError("database.finished_match_save_failed", error, { matchId: match.matchId, state: match.currentState });
      return false;
    }
  }
  function emitGameError(socket: GameSocket, error: unknown): void {
    if (error instanceof GameRuleError) {
      socket.emit("game:error", { code: error.code, message: error.message });
      return;
    }
    socket.emit("game:error", {
      code: "INTERNAL_ERROR",
      message: "경기 처리 중 오류가 발생했습니다.",
    });
    logOperationError("game.internal_error", error, { playerId: socket.data.playerId });
  }

  function handleActionError(socket: GameSocket, matchId: string, error: unknown): void {
    if (error instanceof GameRuleError) {
      const match = registry.getCurrentForPlayer(socket.data.playerId);
      if (
        match?.matchId === matchId &&
        (match.currentState === "FINISHED" || match.currentState === "CANCELLED")
      ) {
        emitSnapshots(match);
        void persistIfFinished(match);
      }
      logOperationWarning("game.action_rejected", {
        matchId,
        playerId: socket.data.playerId,
        code: error.code,
      });
      emitGameError(socket, error);
      return;
    }
    const match = registry.getCurrentForPlayer(socket.data.playerId);
    if (match?.matchId === matchId) {
      match.cancel();
      emitSnapshots(match);
      void persistIfFinished(match);
    }
    emitGameError(socket, error);
  }

  function assertClientState(
    match: GameMatch,
    playerId: string,
    expectedState: string,
    expectedStateVersion: number,
    allowConcurrentState = false,
  ): void {
    const current = match.snapshot(playerId);
    if (
      current.state !== expectedState ||
      !Number.isInteger(expectedStateVersion) ||
      expectedStateVersion < 0 ||
      (allowConcurrentState
        ? expectedStateVersion > current.stateVersion
        : expectedStateVersion !== current.stateVersion)
    ) {
      throw new GameRuleError("STALE_STATE", "경기 상태가 변경되었습니다. 최신 상태에서 다시 시도해주세요.");
    }
  }

  function resumeMatch(socket: GameSocket, session: GuestSession): void {
    const match = registry.getCurrentForPlayer(session.playerId);
    if (!match) return;
    const snapshot = match.snapshot(session.playerId);
    const opponent = snapshot.players.find((player) => player.playerId !== session.playerId);
    socket.join(`match:${match.matchId}`);
    match.setConnectionStatus(session.playerId, "CONNECTED");
    socket.emit("match:found", {
      matchId: match.matchId,
      playerId: session.playerId,
      opponentNickname: opponent?.nickname ?? "상대",
      opponentCosmetics: opponentCosmetics(opponent?.playerId),
      deck: deckFor(match),
    });
    emitSnapshots(match);
  }

  function scheduleForfeit(session: GuestSession): void {
    const previous = reconnectTimers.get(session.playerId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      reconnectTimers.delete(session.playerId);
      if (session.socketId) return;
      const match = registry.getCurrentForPlayer(session.playerId);
      if (!match) return;
      logOperationWarning("match.reconnect_timeout", {
        matchId: match.matchId,
        playerId: session.playerId,
        state: match.currentState,
      });
      match.forfeit(session.playerId);
      emitSnapshots(match);
      void persistIfFinished(match);
    }, reconnectGraceMs);
    timer.unref();
    reconnectTimers.set(session.playerId, timer);
  }

  try {
    const restoredGuests = await matchStore.loadGuests();
    for (const guest of restoredGuests) sessions.restore(guest);
    for (const { playerId, growth } of await matchStore.loadGrowth()) growthByPlayer.set(playerId, growth);

    const restoredMatches = await matchStore.loadActiveMatches();
    for (const state of restoredMatches) {
      try {
        const match = registry.restore(state);
        if (match.expire(Date.now())) {
          await persistIfFinished(match);
          continue;
        }
        const missingSession = state.players.some((player) => !sessions.getByPlayer(player.playerId));
        if (missingSession) {
          match.cancel("복구할 수 없는 참가자 세션이 있어 경기를 취소했습니다.");
          await persistIfFinished(match);
          continue;
        }
        for (const player of state.players) {
          match.setConnectionStatus(player.playerId, "RECONNECTING");
          scheduleForfeit(sessions.getByPlayer(player.playerId)!);
        }
        await persistRuntime(match);
      } catch (error) {
        app.log.error(error);
        const matchId = (state as { matchId?: unknown }).matchId;
        if (typeof matchId === "string") await matchStore.deleteActiveMatch(matchId);
      }
    }
  } catch (error) {
    app.log.error(error);
  }

  io.on("connection", (socket) => {
    const lastInputAt = new Map<string, number>();
    const enforceCooldown = (action: string) => {
      if (inputCooldownMs <= 0) return;
      const now = Date.now();
      const previous = lastInputAt.get(action) ?? 0;
      if (now - previous < inputCooldownMs) {
        throw new GameRuleError("INPUT_RATE_LIMITED", "입력이 너무 빠릅니다. 잠시 후 다시 시도해주세요.");
      }
      lastInputAt.set(action, now);
    };
    const session = sessions.getByPlayer(socket.data.playerId)!;
    sessions.touch(session);
    persistGuest(session);
    const oldSocketId = session.socketId;
    if (oldSocketId && oldSocketId !== socket.id) {
      io.sockets.sockets.get(oldSocketId)?.disconnect(true);
    }
    session.socketId = socket.id;
    const reconnectTimer = reconnectTimers.get(session.playerId);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimers.delete(session.playerId);
    socket.join(session.playerId);
    socket.emit("session:ready", {
      guestToken: session.guestToken,
      playerId: session.playerId,
    });
    socket.emit("player:growth", growthPayload(session.playerId));
    settleRanking();
    giveRankingReward(session.playerId, league.takePending(session.playerId));
    resumeMatch(socket, session);

    socket.on("queue:join", (payload) => {
      try {
        if (registry.getCurrentForPlayer(session.playerId)) {
          throw new GameRuleError("ALREADY_IN_MATCH", "진행 중인 경기를 먼저 마쳐주세요.");
        }
        const normalizedNickname = requireStringField(payload, "nickname").trim().slice(0, 16);
        if (normalizedNickname.length < 2) {
          throw new GameRuleError("INVALID_NICKNAME", "닉네임은 2자 이상이어야 합니다.");
        }
        const input = requirePayload(payload);
        if (input.settings !== undefined && (typeof input.settings !== "object" || Array.isArray(input.settings))) {
          throw new GameRuleError("INVALID_SETTINGS", "게임 설정 형식이 올바르지 않습니다.");
        }
        const rawSettings = (input.settings ?? DEFAULT_MATCH_SETTINGS) as Record<string, unknown>;
        if (!GAME_MODES.includes(rawSettings.mode as never) || !GAME_DIFFICULTIES.includes(rawSettings.difficulty as never)) {
          throw new GameRuleError("INVALID_SETTINGS", "지원하지 않는 게임 모드 또는 난이도입니다.");
        }
        const settings: MatchSettings = {
          mode: rawSettings.mode as MatchSettings["mode"],
          difficulty: rawSettings.difficulty as MatchSettings["difficulty"],
        };
        const key = queueKey(settings);
        session.nickname = normalizedNickname;
        persistGuest(session);

        const waitingPlayer = waitingPlayers.get(key);
        if (!waitingPlayer || waitingPlayer.playerId === session.playerId) {
          removeWaitingPlayer(session.playerId);
          waitingPlayers.set(key, {
            playerId: session.playerId,
            socketId: socket.id,
            nickname: normalizedNickname,
            settings,
          });
          return;
        }

        const opponentSocket = io.sockets.sockets.get(waitingPlayer.socketId);
        if (!opponentSocket || registry.getCurrentForPlayer(waitingPlayer.playerId)) {
          waitingPlayers.set(key, {
            playerId: session.playerId,
            socketId: socket.id,
            nickname: normalizedNickname,
            settings,
          });
          return;
        }

        const matchId = randomUUID();
        const room = `match:${matchId}`;
        socket.join(room);
        opponentSocket.join(room);
        const match = registry.create(matchId, [
          { playerId: waitingPlayer.playerId, nickname: waitingPlayer.nickname },
          { playerId: session.playerId, nickname: normalizedNickname },
        ], settings, requestedPuzzle ? [structuredClone(requestedPuzzle)] : catalogService.pickDeck());
        // 다음 경기를 위해 오래된 카탈로그를 백그라운드에서 다시 읽는다.
        void catalogService.fresh();
        const deck = deckFor(match);

        socket.emit("match:found", {
          matchId,
          playerId: session.playerId,
          opponentNickname: waitingPlayer.nickname,
          opponentCosmetics: opponentCosmetics(waitingPlayer.playerId),
          deck,
        });
        opponentSocket.emit("match:found", {
          matchId,
          playerId: waitingPlayer.playerId,
          opponentNickname: normalizedNickname,
          opponentCosmetics: opponentCosmetics(session.playerId),
          deck,
        });
        emitSnapshots(match);
        waitingPlayers.delete(key);
      } catch (error) {
        emitGameError(socket, error);
      }
    });
    socket.on("queue:leave", () => {
      removeWaitingPlayer(session.playerId);
      socket.emit("queue:left");
    });

    socket.on("game:ready", (payload) => {
      let matchId = "";
      try {
        matchId = requireStringField(payload, "matchId");
        const match = registry.getForPlayer(matchId, session.playerId);
        match.markReady(session.playerId, Date.now());
        emitSnapshots(match);
      } catch (error) {
        handleActionError(socket, matchId, error);
      }
    });

    socket.on("game:loaded", (payload) => {
      let matchId = "";
      try {
        matchId = requireStringField(payload, "matchId");
        const puzzleId = requireStringField(payload, "puzzleId");
        const puzzleVersion = requireStringField(payload, "puzzleVersion");
        const match = registry.getForPlayer(matchId, session.playerId);
        match.markLoaded(session.playerId, puzzleId as Parameters<GameMatch["markLoaded"]>[1], puzzleVersion, Date.now());
        emitSnapshots(match);
      } catch (error) {
        handleActionError(socket, matchId, error);
      }
    });

    socket.on("game:guess", (payload) => {
      let matchId = "";
      try {
        matchId = requireStringField(payload, "matchId");
        const puzzleId = requireStringField(payload, "puzzleId");
        const point = requirePoint(payload);
        const { expectedState, expectedStateVersion } = requireActionContext(payload);
        const match = registry.getForPlayer(matchId, session.playerId);
        assertClientState(match, session.playerId, expectedState, expectedStateVersion, true);
        enforceCooldown("guess");
        const versionBeforeGuess = match.version;
        const result = match.guess(
          session.playerId,
          puzzleId as Parameters<GameMatch["guess"]>[1],
          point,
          Date.now(),
        );
        socket.emit("game:guess-result", result);
        if (match.version !== versionBeforeGuess) {
          emitSnapshots(match);
          void persistIfFinished(match);
        }
      } catch (error) {
        handleActionError(socket, matchId, error);
      }
    });

    socket.on("game:dismiss", (payload) => {
      let matchId = "";
      try {
        matchId = requireStringField(payload, "matchId");
        registry.release(matchId, session.playerId);
      } catch (error) {
        handleActionError(socket, matchId, error);
      }
    });

    socket.on("game:forfeit", (payload) => {
      let matchId = "";
      try {
        matchId = requireStringField(payload, "matchId");
        const { expectedState, expectedStateVersion } = requireActionContext(payload);
        const match = registry.getForPlayer(matchId, session.playerId);
        assertClientState(match, session.playerId, expectedState, expectedStateVersion);
        match.forfeit(session.playerId);
        emitSnapshots(match);
        void persistIfFinished(match);
      } catch (error) {
        handleActionError(socket, matchId, error);
      }
    });

    socket.on("game:report", async (payload) => {
      try {
        const input = requirePayload(payload);
        const matchId = requireStringField(payload, "matchId");
        const { expectedState, expectedStateVersion } = requireActionContext(payload);
        const allowedReasons = new Set(["UNFAIR", "INAPPROPRIATE", "SYSTEM_ERROR", "OTHER"]);
        if (typeof input.reason !== "string" || !allowedReasons.has(input.reason)) {
          throw new GameRuleError("INVALID_REPORT", "신고 사유가 올바르지 않습니다.");
        }
        if (input.details !== undefined && typeof input.details !== "string") {
          throw new GameRuleError("INVALID_REPORT", "신고 내용이 올바르지 않습니다.");
        }
        const match = registry.getForPlayer(matchId, session.playerId);
        assertClientState(match, session.playerId, expectedState, expectedStateVersion);
        if (match.currentState !== "FINISHED" && match.currentState !== "CANCELLED") {
          throw new GameRuleError("MATCH_NOT_FINISHED", "경기 종료 후 신고할 수 있습니다.");
        }
        if (!await persistIfFinished(match)) {
          throw new Error("MATCH_PERSISTENCE_FAILED");
        }
        const reportId = await matchStore.createReport({
          matchId,
          reporterPlayerId: session.playerId,
          reason: input.reason as Parameters<MatchStore["createReport"]>[0]["reason"],
          details: typeof input.details === "string" ? input.details.trim().slice(0, 500) : undefined,
        });
        socket.emit("game:report-result", { reportId });
      } catch (error) {
        if ((error as Error).message === "DUPLICATE_REPORT") {
          socket.emit("game:error", {
            code: "DUPLICATE_REPORT",
            message: "이미 이 경기를 신고했습니다.",
          });
        } else {
          emitGameError(socket, error);
        }
      }
    });
    socket.on("solo:start", (payload) => {
      try {
        const nickname = requireStringField(payload, "nickname").trim().slice(0, 16);
        if (nickname.length < 2) throw new GameRuleError("INVALID_NICKNAME", "닉네임은 2자 이상이어야 합니다.");
        enforceCooldown("solo-start");
        session.nickname = nickname;
        persistGuest(session);
        settleRanking();
        const started = league.start(requireStringField(payload, "puzzleId"), randomUUID());
        soloRuns.set(session.playerId, started.run);
        socket.emit("solo:started", started.payload);
      } catch (error) {
        emitGameError(socket, error);
      }
    });

    socket.on("solo:guess", (payload) => {
      try {
        const input = requirePayload(payload);
        const runId = requireStringField(payload, "runId");
        const guessed = league.guess(soloRuns.get(session.playerId), runId, {
          point: input.point as never,
          pointerType: typeof input.pointerType === "string" ? input.pointerType : undefined,
          boardSizePx: typeof input.boardSizePx === "number" ? input.boardSizePx : undefined,
        });
        if (!guessed.finish) {
          soloRuns.set(session.playerId, guessed.run);
          socket.emit("solo:guess-result", guessed.payload);
          return;
        }
        soloRuns.delete(session.playerId);
        const { puzzleId, elapsedMs } = guessed.finish;
        const before = growthOf(session.playerId);
        const result = grantSoloReward(before, elapsedMs, soloClock(), puzzleId);
        if (result.progress !== before) storeGrowth(session.playerId, result.progress);
        const ranks = league.record({ playerId: session.playerId, nickname: session.nickname ?? "손님", ...publicCosmetics(result.progress.loadout) }, guessed.finish);
        socket.emit("solo:guess-result", {
          ...guessed.payload,
          finished: {
            elapsedMs,
            personalBestMs: result.progress.soloBests[puzzleId] ?? elapsedMs,
            newPersonalBest: result.progress.soloBests[puzzleId] !== before.soloBests[puzzleId],
            ...ranks,
          },
        });
        socket.emit("player:growth", growthPayload(session.playerId, {
          ...(result.reward ? { reward: result.reward } : {}),
          ...(result.limitReached ? { soloLimitReached: true } : {}),
        }));
      } catch (error) {
        emitGameError(socket, error);
      }
    });

    socket.on("ranking:get", (payload) => {
      try {
        const puzzleId = requireStringField(payload, "puzzleId");
        const period = requireStringField(payload, "period");
        if (period !== "week" && period !== "all") throw new GameRuleError("INVALID_PAYLOAD", "랭킹 기간이 올바르지 않습니다.");
        enforceCooldown("ranking");
        settleRanking();
        socket.emit("ranking:list", league.ranking(puzzleId, period, {
          playerId: session.playerId,
          personalBestMs: growthOf(session.playerId).soloBests[puzzleId] ?? null,
          cosmetics: onlineCosmetics(),
        }));
      } catch (error) {
        emitGameError(socket, error);
      }
    });

    for (const event of ["shop:buy", "shop:equip"] as const) {
      socket.on(event, (payload) => {
        try {
          const itemId = requireStringField(payload, "itemId");
          enforceCooldown("shop");
          const growth = growthOf(session.playerId);
          const level = growthView(growth).level;
          const result = event === "shop:buy" ? buyCosmetic(growth, level, itemId) : equipCosmetic(growth, level, itemId);
          if (!result.ok) throw new GameRuleError(result.code, result.message);
          storeGrowth(session.playerId, result.growth);
          socket.emit("player:growth", growthPayload(session.playerId));
        } catch (error) {
          emitGameError(socket, error);
        }
      });
    }

    socket.on("disconnect", () => {
      if (session.socketId !== socket.id) return;
      session.socketId = null;
      sessions.touch(session);
      persistGuest(session);
      removeWaitingPlayer(session.playerId);
      const match = registry.getCurrentForPlayer(session.playerId);
      if (!match || match.currentState === "FINISHED" || match.currentState === "CANCELLED") {
        return;
      }
      match.setConnectionStatus(session.playerId, "RECONNECTING");
      emitSnapshots(match);
      if (!closing) scheduleForfeit(session);
    });
  });

  const expiryTimer = setInterval(() => {
    for (const match of registry.expire(Date.now())) {
      emitSnapshots(match);
      void persistIfFinished(match);
    }
  }, 250);
  expiryTimer.unref();

  const guestSessionCleanupTimer = setInterval(() => {
    const expired = sessions.removeExpired(
      Date.now(),
      (playerId) =>
        [...waitingPlayers.values()].some((player) => player.playerId === playerId) ||
        reconnectTimers.has(playerId) ||
        registry.getCurrentForPlayer(playerId) !== null ||
        hasProtectedGrowth(playerId, Date.now()),
    );
    for (const session of expired) deleteGuest(session);
  }, guestSessionCleanupIntervalMs);
  guestSessionCleanupTimer.unref();

  app.addHook("onClose", async () => {
    closing = true;
    clearInterval(expiryTimer);
    clearInterval(guestSessionCleanupTimer);
    for (const timer of reconnectTimers.values()) clearTimeout(timer);
    for (const timer of finishedMatchCleanupTimers.values()) clearTimeout(timer);
    finishedMatchCleanupTimers.clear();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.allSettled([...runtimeWrites.values(), ...guestWrites]);
    await matchStore.close();
  });

  return app;
}
