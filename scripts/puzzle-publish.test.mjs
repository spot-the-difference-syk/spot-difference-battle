import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import * as validator from "../apps/server/src/persistence/puzzle-catalog.ts";
import { koreanDate, main, nextVersion, suggestRegions } from "./puzzle-publish.mjs";

const NOW = new Date("2026-10-01T20:00:00Z"); // 한국 시간 10월 2일 새벽

const DIFFS = [
  { id: "a", label: "빨간 상자", regions: [{ x: 0.2, y: 0.2, radius: 0.08 }] },
  { id: "b", label: "파란 상자", regions: [{ x: 0.7, y: 0.3, radius: 0.08 }] },
  { id: "c", label: "초록 상자", regions: [{ x: 0.5, y: 0.8, radius: 0.08 }] },
];

async function picture(width, height, boxes = []) {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 235, g: 225, b: 210 } } });
  const overlays = await Promise.all(boxes.map(async ({ x, y, size, color }) => ({
    input: await sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer(),
    left: Math.round(x * width - size / 2),
    top: Math.round(y * height - size / 2),
  })));
  return base.composite(overlays).png().toBuffer();
}

async function puzzleDir(root, name, { meta = {}, width = 1024, height = 1024, modifiedSize } = {}) {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  const boxes = [
    { x: 0.2, y: 0.2, size: 90, color: { r: 200, g: 30, b: 30 } },
    { x: 0.7, y: 0.3, size: 90, color: { r: 30, g: 30, b: 200 } },
    { x: 0.5, y: 0.8, size: 90, color: { r: 30, g: 160, b: 40 } },
  ];
  await writeFile(path.join(dir, "original.png"), await picture(width, height));
  const [mw, mh] = modifiedSize ?? [width, height];
  await writeFile(path.join(dir, "modified.png"), await picture(mw, mh, boxes));
  await writeFile(path.join(dir, "puzzle.json"), JSON.stringify({
    id: name, mode: "battle", title: "시험 그림", genre: "애니", alt: "상자 세 개", differences: DIFFS, ...meta,
  }));
  return dir;
}

async function withTemp(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "puzzle-publish-test-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function capture() {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) };
}

const ENV = {
  R2_ACCOUNT_ID: "testaccount", R2_ACCESS_KEY_ID: "not-a-real-key", R2_SECRET_ACCESS_KEY: "not-a-real-secret",
  R2_BUCKET_NAME: "test-bucket", R2_ENDPOINT: "https://testaccount.r2.cloudflarestorage.com",
};

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    factory: () => ({
      async send(command) {
        const name = command.constructor.name;
        const { Key, Body } = command.input;
        if (name === "HeadObjectCommand") {
          if (!objects.has(Key)) throw Object.assign(new Error("missing"), { name: "NotFound" });
          return {};
        }
        if (name === "PutObjectCommand") {
          if (objects.has(Key)) throw Object.assign(new Error("exists"), { $metadata: { httpStatusCode: 412 } });
          objects.set(Key, Buffer.from(Body));
          return {};
        }
        if (name === "GetObjectCommand") {
          const bytes = objects.get(Key);
          return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
        }
        throw new Error(`unexpected ${name}`);
      },
      destroy() {},
    }),
  };
}

/** puzzle_catalog 테이블과 activate_puzzle_version을 흉내 내는 DB */
function fakeDb(initial = []) {
  let rows = structuredClone(initial);
  let snapshot = null;
  const statements = [];
  const client = {
    async query(sql, params = []) {
      statements.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
      if (sql === "BEGIN") { snapshot = structuredClone(rows); return {}; }
      if (sql === "COMMIT") { snapshot = null; return {}; }
      if (sql === "ROLLBACK") { rows = snapshot; snapshot = null; return {}; }
      if (sql === validator.ACTIVE_CATALOG_SQL) return { rows: rows.filter((row) => row.is_active).sort((a, b) => a.pair_id.localeCompare(b.pair_id)) };
      if (sql.startsWith("SELECT asset_version")) return { rows: rows.filter((row) => row.pair_id === params[0]) };
      if (sql.startsWith("INSERT INTO puzzle_catalog")) {
        const [pair_id, asset_version, title, difficulty, original_asset_key, modified_asset_key, differences, metadata] = params;
        if (rows.some((row) => row.pair_id === pair_id && row.asset_version === asset_version)) throw new Error("duplicate key");
        rows.push({ pair_id, asset_version, title, difficulty, original_asset_key, modified_asset_key, differences: JSON.parse(differences), metadata: JSON.parse(metadata), is_active: false });
        return { rowCount: 1 };
      }
      if (sql.startsWith("SELECT activate_puzzle_version")) {
        const target = rows.find((row) => row.pair_id === params[0] && row.asset_version === params[1]);
        if (!target) throw new Error("Puzzle version not found");
        rows.forEach((row) => { if (row.pair_id === params[0]) row.is_active = false; });
        target.is_active = true;
        return { rows: [{}] };
      }
      if (sql.startsWith("UPDATE puzzle_catalog SET is_active = FALSE")) {
        const hits = rows.filter((row) => row.pair_id === params[0] && row.is_active);
        hits.forEach((row) => { row.is_active = false; });
        return { rowCount: hits.length };
      }
      throw new Error(`unexpected SQL ${sql}`);
    },
    async end() {},
  };
  return { client, statements, get rows() { return rows; }, factory: async () => client };
}

test("versions use the Korean date and the next free number", () => {
  assert.equal(koreanDate(NOW), "2026-10-02");
  assert.equal(nextVersion([], NOW), "2026-10-02.1");
  assert.equal(nextVersion(["2026-10-02.1", "2026-10-02.3", "2026-09-30.7"], NOW), "2026-10-02.4");
});

test("suggest finds changed spots as non-overlapping answer circles", async () => {
  const original = await picture(1024, 1024);
  const modified = await picture(1024, 1024, [
    { x: 0.2, y: 0.2, size: 90, color: { r: 200, g: 30, b: 30 } },
    { x: 0.7, y: 0.3, size: 60, color: { r: 30, g: 30, b: 200 } },
    { x: 0.5, y: 0.8, size: 40, color: { r: 30, g: 160, b: 40 } },
  ]);
  const { regions } = await suggestRegions(original, modified, sharp, { count: 3 });
  assert.equal(regions.length, 3);
  for (const [x, y] of [[0.2, 0.2], [0.7, 0.3], [0.5, 0.8]]) {
    assert.ok(regions.some((region) => Math.hypot(region.x - x, region.y - y) < 0.03), `${x},${y} 근처를 찾아야 함`);
  }
  for (const region of regions) assert.ok(region.radius >= 0.035 && region.radius <= 0.2);
});

test("suggest command writes a JSON draft and a preview", async () => withTemp(async (root) => {
  const dir = await puzzleDir(root, "box-room");
  const out = capture();
  assert.equal(await main({ args: ["suggest", dir], ...out }), 0);
  const draft = JSON.parse(await readFile(path.join(dir, "differences.suggested.json"), "utf8"));
  assert.equal(draft.length, 3);
  const preview = await sharp(path.join(dir, "preview.png")).metadata();
  assert.equal(preview.width, 1024);
}));

test("dry run converts to 1024 WebP, validates, and never touches R2 or the DB", async () => withTemp(async (root) => {
  await puzzleDir(root, "wide-room", { width: 1600, height: 900 });
  await puzzleDir(root, "square-room");
  const out = capture();
  const db = fakeDb();
  const code = await main({ args: ["publish", root], env: {}, now: NOW, ...out, deps: { dbFactory: db.factory } });
  assert.equal(code, 0, out.lines.join("\n"));
  assert.equal(db.statements.length, 0);
  assert.ok(out.lines.some((line) => line.includes("가운데를 잘라")));
  assert.ok(out.lines.some((line) => line.includes("square-room@2026-10-02.1")));
  const meta = await sharp(path.join(root, "wide-room", "runtime", "original.webp")).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 1024, 1024]);
}));

test("publish rejects bad folders and keeps going with the rest", async () => withTemp(async (root) => {
  await puzzleDir(root, "good-room");
  await puzzleDir(root, "two-answers", { meta: { differences: DIFFS.slice(0, 2) } });
  await puzzleDir(root, "overlap", { meta: { differences: [DIFFS[0], { ...DIFFS[1], regions: [{ x: 0.22, y: 0.2, radius: 0.08 }] }, DIFFS[2]] } });
  await puzzleDir(root, "no-genre", { meta: { genre: undefined } });
  await puzzleDir(root, "Bad_Id");
  await puzzleDir(root, "size-mismatch", { modifiedSize: [1000, 1000] });
  const out = capture();
  assert.equal(await main({ args: ["publish", root], env: {}, now: NOW, ...out }), 1);
  const text = out.lines.join("\n");
  assert.match(text, /two-answers: 실패 — 대결 그림은 차이가 정확히 3개/);
  assert.match(text, /overlap: 실패 — .*겹칩니다/);
  assert.match(text, /no-genre: 실패 — genre/);
  assert.match(text, /Bad_Id: 실패/);
  assert.match(text, /size-mismatch: 실패 — 원본\(1024×1024\)과 수정본\(1000×1000\)/);
  assert.match(text, /총 6개 중 1개 성공, 5개 실패/);
}));

test("upload stores immutable objects, registers inactive rows, and re-runs are safe", async () => withTemp(async (root) => {
  const dir = await puzzleDir(root, "box-room");
  const r2 = fakeR2();
  const db = fakeDb();
  const deps = { r2Factory: r2.factory, dbFactory: db.factory };
  const out = capture();
  assert.equal(await main({ args: ["publish", dir, "--upload"], env: ENV, now: NOW, ...out, deps }), 0, out.lines.join("\n"));
  assert.deepEqual([...r2.objects.keys()].sort(), [
    "puzzles/box-room/2026-10-02.1/runtime/modified.webp",
    "puzzles/box-room/2026-10-02.1/runtime/original.webp",
  ]);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].is_active, false);
  assert.deepEqual(db.rows[0].metadata.mode, "battle");
  assert.match(db.rows[0].metadata.original_sha256, /^[0-9A-F]{64}$/);

  // 같은 그림을 다시 올리면 새 버전을 만들지 않는다.
  const again = capture();
  assert.equal(await main({ args: ["publish", dir, "--upload"], env: ENV, now: NOW, ...again, deps }), 0);
  assert.equal(db.rows.length, 1);
  assert.ok(again.lines.some((line) => line.includes("이미 등록됨 box-room@2026-10-02.1")));

  // 정답을 고치면 같은 날 다음 버전이 된다.
  const json = JSON.parse(await readFile(path.join(dir, "puzzle.json"), "utf8"));
  json.differences[0].label = "붉은 상자";
  await writeFile(path.join(dir, "puzzle.json"), JSON.stringify(json));
  assert.equal(await main({ args: ["publish", dir, "--upload"], env: ENV, now: NOW, ...capture(), deps }), 0);
  assert.deepEqual(db.rows.map((row) => row.asset_version), ["2026-10-02.1", "2026-10-02.2"]);
}));

test("activate swaps the live version, and a change that would break the live catalog is rolled back", async () => withTemp(async (root) => {
  const dir = await puzzleDir(root, "box-room");
  const r2 = fakeR2();
  const db = fakeDb();
  const deps = { r2Factory: r2.factory, dbFactory: db.factory };
  assert.equal(await main({ args: ["publish", dir, "--upload", "--activate"], env: ENV, now: NOW, ...capture(), deps }), 0);
  assert.equal(db.rows[0].is_active, true);
  assert.ok(db.statements.includes("BEGIN") && db.statements.includes("COMMIT"));

  // 마지막 대결 그림을 내리면 게임이 멈추므로 되돌린다.
  const out = capture();
  assert.equal(await main({ args: ["deactivate", "box-room"], env: ENV, ...out, deps }), 1);
  assert.match(out.lines.join("\n"), /empty|no battle/);
  assert.equal(db.rows[0].is_active, true);
  assert.ok(db.statements.includes("ROLLBACK"));

  const missing = capture();
  assert.equal(await main({ args: ["activate", "box-room", "2026-01-01.1"], env: ENV, ...missing, deps }), 1);
  assert.match(missing.lines.join("\n"), /not found/);
}));

test("upload refuses missing or foreign R2 settings before doing anything", async () => withTemp(async (root) => {
  const dir = await puzzleDir(root, "box-room");
  const db = fakeDb();
  for (const env of [{}, { ...ENV, R2_ENDPOINT: "https://evil.example.com" }]) {
    const out = capture();
    assert.equal(await main({ args: ["publish", dir, "--upload"], env, now: NOW, ...out, deps: { r2Factory: fakeR2().factory, dbFactory: db.factory } }), 1);
    assert.doesNotMatch(out.lines.join("\n"), /not-a-real/);
  }
  assert.equal(db.statements.length, 0);
  assert.equal(await main({ args: ["publish", dir, "--activate"], env: ENV, ...capture() }), 1);
}));

test("export-bundled writes every bundled puzzle and they all pass the dry run", async () => withTemp(async (root) => {
  const out = capture();
  assert.equal(await main({ args: ["export-bundled", root], ...out }), 0);
  const folders = await readdir(root);
  assert.equal(folders.length, 15);
  assert.equal(folders.filter((name) => name.startsWith("solo-")).length, 5);
  const check = capture();
  assert.equal(await main({ args: ["publish", root], env: {}, now: NOW, ...check }), 0, check.lines.join("\n"));
}));

test("unknown commands print usage", async () => {
  const out = capture();
  assert.equal(await main({ args: ["launch"], ...out }), 2);
  assert.match(out.lines[0], /사용법/);
});
