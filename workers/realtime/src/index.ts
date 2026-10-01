import { GameMatch } from "@spot-battle/game-core";
import { loadDatabasePuzzles } from "../../../apps/server/src/persistence/puzzle-catalog.js";
import { SupabasePostgresMatchStore } from "../../../apps/server/src/persistence/match-store.js";
import { RealtimeGame, type Archive, type Peer, type Storage } from "./game.js";

interface GameWebSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): { id: string; playerId?: string; createdAt: number };
}
interface Context {
  storage: Storage;
  getWebSockets(): GameWebSocket[];
  acceptWebSocket(socket: GameWebSocket): void;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
interface Env {
  GAME_LOBBY: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
  ASSETS: { fetch(request: Request): Promise<Response> };
  ALLOWED_ORIGINS?: string;
  PUZZLE_CATALOG_SOURCE?: string;
  HYPERDRIVE?: { connectionString: string };
}
declare const WebSocketPair: { new(): { 0: GameWebSocket; 1: GameWebSocket } };
const MAX_CONNECTIONS = 200;
const MAX_FRAME = 4096;
const HEALTH_CACHE_MS = 15_000;
const DATABASE_OPTIONS = { connectionTimeoutMillis: 3000, query_timeout: 3000, max: 1 };

export function allowedOrigin(request: Request, env: Pick<Env, "ALLOWED_ORIGINS">): boolean {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  // First-party website, AIT production/QR origins, and localhost development.
  if (origin === url.origin) return true;
  if (["localhost", "127.0.0.1"].includes(url.hostname) && origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return !!origin && (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).includes(origin);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/ws") {
      if (!allowedOrigin(request, env)) return new Response("Forbidden", { status: 403 });
      if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
      return env.GAME_LOBBY.get(env.GAME_LOBBY.idFromName("mvp-v1")).fetch(request);
    }
    if (path === "/health") return env.GAME_LOBBY.get(env.GAME_LOBBY.idFromName("mvp-v1")).fetch(request);
    return env.ASSETS.fetch(request);
  },
};

/** Hibernating WebSockets and alarms replace the continuously running Node server. */
export class GameLobby {
  private game!: RealtimeGame;
  constructor(private ctx: Context, private env: Env) {
    ctx.blockConcurrencyWhile(async () => {
      const source = env.PUZZLE_CATALOG_SOURCE ?? "code";
      if (source !== "code" && source !== "database") throw new Error("Invalid puzzle catalog source.");
      if (source === "database" && !env.HYPERDRIVE) throw new Error("Database catalog requires HYPERDRIVE.");
      const catalog = source === "database" ? await loadDatabasePuzzles(env.HYPERDRIVE!.connectionString) : undefined;
      const archive: Archive | undefined = env.HYPERDRIVE ? {
        save: async (state) => {
          const store = new SupabasePostgresMatchStore(env.HYPERDRIVE!.connectionString, DATABASE_OPTIONS);
          try {
            await store.saveMatch(GameMatch.restore(state).snapshot(), state);
          } finally { await store.close(); }
        },
        report: async (input) => {
          const store = new SupabasePostgresMatchStore(env.HYPERDRIVE!.connectionString, DATABASE_OPTIONS);
          try { return await store.createReport(input); }
          finally { await store.close(); }
        },
        saveGrowth: async (rows) => {
          const store = new SupabasePostgresMatchStore(env.HYPERDRIVE!.connectionString, DATABASE_OPTIONS);
          try { await store.saveGrowthBatch(rows); }
          finally { await store.close(); }
        },
        findGrowth: async (hash) => {
          const store = new SupabasePostgresMatchStore(env.HYPERDRIVE!.connectionString, DATABASE_OPTIONS);
          try { return await store.findGrowthByTokenHash(hash); }
          finally { await store.close(); }
        },
      } : undefined;
      this.game = new RealtimeGame(ctx.storage, () => this.peers(), catalog, archive);
      await this.game.restore();
      await this.scheduleAuthDeadline();
    });
  }

  private healthCache: { checkedAt: number; pending: Promise<boolean | null> } | null = null;

  /** Public endpoint: reuse one DB probe for a short window so polling cannot open a connection per request. */
  private databaseHealth(): Promise<boolean | null> {
    if (!this.env.HYPERDRIVE) return Promise.resolve(null);
    const now = Date.now();
    if (this.healthCache && now - this.healthCache.checkedAt < HEALTH_CACHE_MS) return this.healthCache.pending;
    const connectionString = this.env.HYPERDRIVE.connectionString;
    const pending = (async () => {
      const store = new SupabasePostgresMatchStore(connectionString, DATABASE_OPTIONS);
      try { return await store.health(); } catch { return false; } finally { await store.close().catch(() => undefined); }
    })();
    this.healthCache = { checkedAt: now, pending };
    return pending;
  }

  private peer(ws: GameWebSocket): Peer {
    const attachment = ws.deserializeAttachment();
    return {
      id: attachment.id,
      get playerId() { return ws.deserializeAttachment().playerId; },
      set playerId(playerId) { ws.serializeAttachment({ ...ws.deserializeAttachment(), playerId }); },
      send: (event, payload) => ws.send(JSON.stringify({ event, payload })),
      close: () => { try { ws.close(4001, "Session replaced"); } catch { /* Already closed. */ } },
    };
  }
  private peers(): Peer[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === 1).map((ws) => this.peer(ws));
  }
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/health") {
      const database = await this.databaseHealth();
      return Response.json({ status: database === false ? "degraded" : "ok", runtime: "cloudflare-durable-object", database, catalog: this.env.PUZZLE_CATALOG_SOURCE ?? "code" }, { status: database === false ? 503 : 200, headers: { "Cache-Control": "no-store" } });
    }
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) return new Response("Lobby full", { status: 503 });
    const pair = new WebSocketPair();
    pair[1].serializeAttachment({ id: crypto.randomUUID(), createdAt: Date.now() });
    this.ctx.acceptWebSocket(pair[1]);
    // Evict connections that never authenticate, including across hibernation.
    await this.scheduleAuthDeadline();
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }

  async webSocketMessage(ws: GameWebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const peer = this.peer(ws);
      let frame: { event: string; payload?: unknown };
      try {
        if (typeof message !== "string" || new TextEncoder().encode(message).length > MAX_FRAME) throw new Error("Invalid frame");
        frame = JSON.parse(message) as { event: string; payload?: unknown };
        if (!frame || typeof frame !== "object" || typeof frame.event !== "string") throw new Error("Invalid frame");
        if (!peer.playerId && frame.event !== "session:authenticate") throw new Error("Authentication required");
      } catch {
        peer.send("game:error", { code: "INVALID_PAYLOAD", message: "요청 형식이 올바르지 않습니다." });
        return;
      }
      // A durable write failure must reset the object, not leave unsaved in-memory state.
      if (!peer.playerId) {
        const token = (frame.payload as { guestToken?: unknown } | undefined)?.guestToken;
        await this.game.authenticate(peer, token);
      } else {
        await this.game.action(peer, frame.event, frame.payload);
      }
      await this.scheduleAuthDeadline();
    });
  }
  async webSocketClose(ws: GameWebSocket, code: number, reason: string): Promise<void> {
    try { ws.close(code, reason); } catch { /* Already closed. */ }
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.game.disconnect(this.peer(ws));
      await this.scheduleAuthDeadline();
    });
  }
  async webSocketError(ws: GameWebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011, "Connection error");
  }
  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment();
        if (!attachment.playerId && Date.now() >= attachment.createdAt + 10_000) ws.close(4000, "Authentication timeout");
      }
      await this.game.alarm();
      await this.scheduleAuthDeadline();
    });
  }
  private async scheduleAuthDeadline(): Promise<void> {
    const unauthenticated = this.ctx.getWebSockets().filter((ws) => ws.readyState === 1 && !ws.deserializeAttachment().playerId);
    if (!unauthenticated.length) return;
    // Game checkpoint owns the game alarm. Only move it earlier for authentication.
    const storage = this.ctx.storage as Storage & { getAlarm(): Promise<number | null> };
    const alarm = await storage.getAlarm();
    const deadline = Math.min(...unauthenticated.map((ws) => ws.deserializeAttachment().createdAt + 10_000));
    if (alarm === null || deadline < alarm) await storage.setAlarm(Math.max(Date.now() + 1, deadline));
  }
}
