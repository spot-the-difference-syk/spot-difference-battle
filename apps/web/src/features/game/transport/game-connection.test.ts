import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloudflareConnection, websocketUrl } from "./game-connection.js";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 1;
  sent: Array<{ event: string; payload?: unknown }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  receive(event: string, payload?: unknown) { this.onmessage?.({ data: JSON.stringify({ event, payload }) }); }
}
beforeEach(() => { vi.useFakeTimers(); FakeWebSocket.instances = []; vi.stubGlobal("WebSocket", FakeWebSocket); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const flush = async () => { await vi.runAllTicks(); await Promise.resolve(); };

it("requires a secure origin and never sends guest tokens in URLs", () => {
  expect(websocketUrl("https://game.example")).toBe("wss://game.example/ws");
  expect(websocketUrl("http://127.0.0.1:8787")).toBe("ws://127.0.0.1:8787/ws");
  for (const url of ["http://game.example", "https://game.example/path", "https://game.example?token=secret", "https://user:secret@game.example"]) expect(() => websocketUrl(url)).toThrow();
});
it("authenticates before marking connected and keeps the event contract", async () => {
  const client = new CloudflareConnection("https://game.example", "old-token");
  const connected = vi.fn(); client.on("connect", connected);
  await flush(); const ws = FakeWebSocket.instances[0]!;
  ws.onopen?.();
  expect(ws.url).toBe("wss://game.example/ws");
  expect(ws.sent[0]).toEqual({ event: "session:authenticate", payload: { guestToken: "old-token" } });
  expect(connected).not.toHaveBeenCalled();
  ws.receive("session:ready", { guestToken: "new-token", playerId: "player" });
  expect(connected).toHaveBeenCalledOnce();
  expect(client.auth.guestToken).toBe("new-token");
  client.emit("game:ready", { matchId: "match" });
  expect(ws.sent.at(-1)).toEqual({ event: "game:ready", payload: { matchId: "match" } });
  client.disconnect();
});
it("reconnects with the restored token and resumes a waiting queue", async () => {
  const client = new CloudflareConnection("https://game.example", null);
  await flush(); const first = FakeWebSocket.instances[0]!;
  first.receive("session:ready", { guestToken: "token", playerId: "player" });
  client.emit("queue:join", { nickname: "테스터" }); first.close();
  await vi.advanceTimersByTimeAsync(500); const second = FakeWebSocket.instances[1]!;
  second.onopen?.(); expect(second.sent[0]?.payload).toEqual({ guestToken: "token" });
  second.receive("session:ready", { guestToken: "token", playerId: "player" });
  await vi.advanceTimersByTimeAsync(200);
  expect(second.sent.at(-1)).toEqual({ event: "queue:join", payload: { nickname: "테스터" } });
  client.disconnect();
});
it("does not requeue a restored match or reconnect a replaced session", async () => {
  const client = new CloudflareConnection("https://game.example", null);
  await flush(); const first = FakeWebSocket.instances[0]!;
  first.receive("session:ready", { guestToken: "token", playerId: "player" });
  client.emit("queue:join", { nickname: "테스터" }); first.close();
  await vi.advanceTimersByTimeAsync(500); const second = FakeWebSocket.instances[1]!;
  second.receive("session:ready", { guestToken: "token", playerId: "player" });
  second.receive("match:found", { matchId: "match", playerId: "player", opponentNickname: "상대" });
  await vi.advanceTimersByTimeAsync(200); expect(second.sent).toHaveLength(0);
  second.onclose?.({ code: 4001 });
  await vi.advanceTimersByTimeAsync(10_000); expect(FakeWebSocket.instances).toHaveLength(2);
  client.disconnect();
});
