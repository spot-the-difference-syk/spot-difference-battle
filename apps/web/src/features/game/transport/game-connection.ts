import { io } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@spot-battle/shared";

type Incoming = ServerToClientEvents & { connect: () => void; disconnect: () => void };
export interface GameConnection {
  auth: { guestToken: string | null };
  on<K extends keyof Incoming>(event: K, listener: Incoming[K]): void;
  emit<K extends keyof ClientToServerEvents>(event: K, ...args: Parameters<ClientToServerEvents[K]>): void;
  disconnect(): void;
}

export function websocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error("Game server must be an HTTPS origin (HTTP is allowed for localhost).");
  if (url.pathname !== "/") throw new Error("Game server must be an origin without a path.");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

/** Uses the existing event contract over native WebSocket for Cloudflare. */
export class CloudflareConnection implements GameConnection {
  auth: { guestToken: string | null };
  private listeners = new Map<string, Array<(payload?: unknown) => void>>();
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private requeueTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingQueue: unknown;
  private retry = 0;
  constructor(private url: string, token: string | null) {
    this.auth = { guestToken: token };
    // Let the hook register listeners before a connection can deliver events.
    queueMicrotask(() => { if (!this.stopped) this.open(); });
  }
  on<K extends keyof Incoming>(event: K, listener: Incoming[K]): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as (payload?: unknown) => void);
    this.listeners.set(event, list);
  }
  private notify(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
  private open(): void {
    const socket = new WebSocket(websocketUrl(this.url));
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ event: "session:authenticate", payload: this.auth }));
    socket.onmessage = (message) => {
      if (this.stopped || this.socket !== socket) return;
      let frame: { event: string; payload?: unknown };
      try { frame = JSON.parse(message.data as string); } catch { return; }
      if (frame.event === "session:ready") {
        this.auth = { guestToken: (frame.payload as { guestToken: string }).guestToken };
        this.retry = 0;
        this.notify("session:ready", frame.payload);
        this.notify("connect");
        // Resume a queue only if the server has not restored a match.
        this.requeueTimer = setTimeout(() => { if (this.pendingQueue) this.send("queue:join", this.pendingQueue); }, 200);
      } else {
        if (frame.event === "match:found" || frame.event === "queue:left") {
          this.pendingQueue = undefined;
          clearTimeout(this.requeueTimer);
        }
        this.notify(frame.event, frame.payload);
      }
    };
    socket.onclose = (event) => {
      if (this.stopped || this.socket !== socket) return;
      clearTimeout(this.requeueTimer);
      this.notify("disconnect");
      if (event.code === 4001) {
        this.stopped = true;
        this.notify("game:error", { code: "SESSION_REPLACED", message: "다른 창에서 게임에 연결했습니다. 이 창을 새로고침하면 다시 연결됩니다." });
        return;
      }
      this.reconnectTimer = setTimeout(() => this.open(), Math.min(500 * 2 ** this.retry++, 3000));
    };
    socket.onerror = () => socket.close();
  }
  private send(event: string, payload?: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ event, payload }));
  }
  emit<K extends keyof ClientToServerEvents>(event: K, ...args: Parameters<ClientToServerEvents[K]>): void {
    if (event === "queue:join") this.pendingQueue = args[0];
    if (event === "queue:leave") this.pendingQueue = undefined;
    this.send(event, args[0]);
  }
  disconnect(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.requeueTimer);
    this.socket?.close();
    this.listeners.clear();
  }
}

export function createGameConnection(serverUrl: string, token: string | null, transport: string | undefined): GameConnection {
  if (transport === "cloudflare") return new CloudflareConnection(serverUrl, token);
  if (transport && transport !== "socketio") throw new Error("Unsupported game transport.");
  return io(serverUrl, { reconnection: true, auth: { guestToken: token } }) as unknown as GameConnection;
}
