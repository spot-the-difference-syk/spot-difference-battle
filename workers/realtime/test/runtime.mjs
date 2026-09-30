import assert from "node:assert/strict";
import WebSocket from "ws";
import { GAME_PUZZLES } from "../../../apps/server/dist/game/puzzle-catalog.js";

const origin = process.env.GAME_TEST_ORIGIN ?? "http://127.0.0.1:8787";
const url = new URL("/ws", origin); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
const clients = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect(token) {
  const ws = new WebSocket(url, { headers: { Origin: origin } });
  const client = { ws, frames: [], send(event, payload) { ws.send(JSON.stringify({ event, payload })); } };
  clients.push(client);
  ws.on("message", (data) => client.frames.push(JSON.parse(String(data))));
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  client.send("session:authenticate", { guestToken: token });
  await wait(client, "session:ready");
  return client;
}
async function wait(client, event, predicate = () => true) {
  for (let i = 0; i < 100; i++) {
    const frame = client.frames.find((f) => f.event === event && predicate(f.payload));
    if (frame) return frame.payload;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${event}: ${JSON.stringify(client.frames.slice(-3))}`);
}
const snapshot = (client) => client.frames.filter((f) => f.event === "game:snapshot").at(-1).payload;
function action(client, event, payload = {}) {
  const current = snapshot(client);
  client.send(event, { matchId: current.matchId, expectedState: current.state, expectedStateVersion: current.stateVersion, ...payload });
}
try {
  const health = await fetch(new URL("/health", origin)).then((r) => r.json());
  assert.equal(health.runtime, "cloudflare-durable-object");
  const a = await connect(); const b = await connect();
  for (const client of [a, b]) client.send("queue:join", { nickname: "검증플레이어" });
  await Promise.all([wait(a, "match:found"), wait(b, "match:found")]);
  await Promise.all([wait(a, "game:snapshot"), wait(b, "game:snapshot")]);
  assert.equal(snapshot(a).matchId, snapshot(b).matchId);
  for (const client of [a, b]) action(client, "game:ready");
  await Promise.all([wait(a, "game:snapshot", (s) => s.state === "PRELOADING"), wait(b, "game:snapshot", (s) => s.state === "PRELOADING")]);
  for (const client of [a, b]) action(client, "game:loaded", { puzzleId: snapshot(client).currentPuzzleId, puzzleVersion: snapshot(client).currentPuzzleVersion });
  await Promise.all([wait(a, "game:snapshot", (s) => s.state === "PLAYING"), wait(b, "game:snapshot", (s) => s.state === "PLAYING")]);
  const puzzle = GAME_PUZZLES.find((p) => p.id === snapshot(a).currentPuzzleId);
  action(a, "game:guess", { puzzleId: puzzle.id, point: puzzle.differences[0].regions[0] });
  await wait(a, "game:guess-result", (r) => r.outcome === "CORRECT");
  await wait(a, "game:snapshot", (s) => s.foundMarks.length === 1);
  assert.equal(snapshot(b).foundMarks.length, 0);
  assert.equal(snapshot(b).revealedDifferences, null);
  const token = a.frames.find((f) => f.event === "session:ready").payload.guestToken;
  a.ws.close();
  await wait(b, "game:snapshot", (s) => s.players.some((p) => p.connectionStatus === "RECONNECTING"));
  const resumed = await connect(token);
  await wait(resumed, "game:snapshot", (s) => s.foundMarks.length === 1);
  assert.equal(snapshot(resumed).matchId, snapshot(b).matchId);
  // Wait for both recipients to observe the new state version before exact-state actions.
  await wait(b, "game:snapshot", (s) => s.stateVersion === snapshot(resumed).stateVersion);
  action(b, "game:forfeit");
  await Promise.all([wait(resumed, "game:snapshot", (s) => s.state === "FINISHED"), wait(b, "game:snapshot", (s) => s.state === "FINISHED")]);
  assert.equal(snapshot(resumed).winnerId, resumed.frames.find((f) => f.event === "session:ready").payload.playerId);
  action(resumed, "game:report", { reason: "OTHER", details: "Local runtime verification" });
  await wait(resumed, "game:report-result");
  console.log("Cloudflare workerd E2E PASS: session, matching, countdown, private judgement, reconnect, forfeit, report.");
} finally {
  for (const { ws } of clients) ws.close();
}
