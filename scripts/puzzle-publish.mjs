#!/usr/bin/env node
// 그림 등록 도구: 원본·수정본 그림과 puzzle.json을 R2와 puzzle_catalog에 올린다.
// 사용법은 docs/GAME_ASSETS.md "새 그림 등록" 절을 본다.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIZE = 1024;
const IMAGE_EXTENSIONS = [".webp", ".png", ".jpg", ".jpeg"];
const ANSWER_COUNT = { battle: 3, solo: 5 };
const DIFFICULTIES = ["UNRATED", "EASY", "MEDIUM", "HARD"];
const R2_ENV = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME", "R2_ENDPOINT"];
const USAGE = `사용법:
  pnpm puzzle suggest <폴더> [--count N]          차이 위치 자동 추천 (differences.suggested.json, preview.png)
  pnpm puzzle publish <폴더...> [--upload] [--activate] [--version YYYY-MM-DD.N]
                                                  기본은 미리 점검만, --upload 로 R2·DB 등록
  pnpm puzzle activate <id> <version>             해당 버전을 게임에 노출
  pnpm puzzle deactivate <id>                     게임에서 내리기
  pnpm puzzle export-bundled <폴더>               앱에 들어 있는 기존 그림을 등록용 폴더로 내보내기`;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex").toUpperCase();
const isMissing = (e) => e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey";
/** jsonb는 키 순서를 바꾸므로 키를 정렬해 비교한다. */
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const objectKey = (id, version, kind) => `puzzles/${id}/${version}/runtime/${kind}.webp`;

/** 한국 날짜 YYYY-MM-DD */
export function koreanDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** 같은 날짜의 기존 버전 다음 번호 */
export function nextVersion(existing, now = new Date()) {
  const day = koreanDate(now);
  const used = existing
    .filter((version) => version.startsWith(`${day}.`))
    .map((version) => Number.parseInt(version.slice(day.length + 1), 10))
    .filter(Number.isFinite);
  return `${day}.${used.length ? Math.max(...used) + 1 : 1}`;
}

async function loadSharp() {
  return (await import("sharp")).default;
}

/** 서버와 같은 규칙으로 행을 검증한다. */
async function loadValidator() {
  return import(path.join(ROOT, "apps/server/src/persistence/puzzle-catalog.ts"));
}

async function findImage(dir, kind) {
  for (const extension of IMAGE_EXTENSIONS) {
    const file = path.join(dir, `${kind}${extension}`);
    if (await stat(file).then((info) => info.isFile(), () => false)) return file;
  }
  throw new Error(`${kind} 그림이 없어요 (${kind}.png / .jpg / .webp)`);
}

/**
 * 두 그림을 1024×1024 WebP로 맞춘다. 정사각형이 아니면 가운데를 잘라낸다.
 * 이미 1024×1024 WebP면 다시 압축하지 않는다.
 */
export async function normalizeImages(dir, sharp) {
  const sources = { original: await findImage(dir, "original"), modified: await findImage(dir, "modified") };
  const metas = {};
  for (const kind of ["original", "modified"]) metas[kind] = await sharp(sources[kind]).metadata();
  if (metas.original.width !== metas.modified.width || metas.original.height !== metas.modified.height) {
    throw new Error(`원본(${metas.original.width}×${metas.original.height})과 수정본(${metas.modified.width}×${metas.modified.height}) 크기가 달라요`);
  }
  const warnings = [];
  if (metas.original.width !== metas.original.height) warnings.push("정사각형이 아니라 가운데를 잘라 1024×1024로 맞췄어요");
  if (Math.min(metas.original.width, metas.original.height) < SIZE) warnings.push(`그림이 ${SIZE}px보다 작아 확대했어요`);
  const images = {};
  for (const kind of ["original", "modified"]) {
    const meta = metas[kind];
    const bytes = meta.format === "webp" && meta.width === SIZE && meta.height === SIZE
      ? await readFile(sources[kind])
      : await sharp(sources[kind]).rotate().resize(SIZE, SIZE, { fit: "cover", position: "centre" }).webp({ quality: 88, effort: 6 }).toBuffer();
    images[kind] = { bytes, sha: sha256(bytes) };
  }
  return { images, warnings };
}

// ---------- 차이 위치 추천 ----------

const GRID = 256;

/** 두 그림의 픽셀 차이에서 덩어리를 찾아 정답 원 후보를 만든다. */
export async function suggestRegions(originalBytes, modifiedBytes, sharp, { count = 3, threshold = 48 } = {}) {
  // 가까운 차이가 한 덩어리로 합쳐져 개수가 모자라면 더 촘촘하게 다시 묶는다.
  let best;
  for (const grow of [3, 2, 1]) {
    best = await suggestWith(originalBytes, modifiedBytes, sharp, { count, threshold, grow });
    if (best.regions.length >= count) break;
  }
  return best;
}

async function suggestWith(originalBytes, modifiedBytes, sharp, { count, threshold, grow: R }) {
  const raw = (bytes) => sharp(bytes).resize(GRID, GRID, { fit: "fill" }).blur(1.2).removeAlpha().raw().toBuffer();
  const [a, b] = await Promise.all([raw(originalBytes), raw(modifiedBytes)]);
  const mask = new Uint8Array(GRID * GRID);
  for (let i = 0; i < mask.length; i += 1) {
    const d = Math.max(Math.abs(a[i * 3] - b[i * 3]), Math.abs(a[i * 3 + 1] - b[i * 3 + 1]), Math.abs(a[i * 3 + 2] - b[i * 3 + 2]));
    mask[i] = d >= threshold ? 1 : 0;
  }
  // 가까운 점들을 한 덩어리로 묶기 위해 넓힌다.
  const grown = new Uint8Array(mask.length);
  for (let y = 0; y < GRID; y += 1) for (let x = 0; x < GRID; x += 1) {
    if (!mask[y * GRID + x]) continue;
    for (let dy = -R; dy <= R; dy += 1) for (let dx = -R; dx <= R; dx += 1) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID) grown[ny * GRID + nx] = 1;
    }
  }
  const label = new Int32Array(mask.length);
  const blobs = [];
  for (let start = 0; start < grown.length; start += 1) {
    if (!grown[start] || label[start]) continue;
    const blob = { minX: GRID, minY: GRID, maxX: 0, maxY: 0, pixels: 0 };
    const stack = [start];
    label[start] = blobs.length + 1;
    while (stack.length) {
      const index = stack.pop();
      const x = index % GRID, y = (index - x) / GRID;
      if (mask[index]) {
        blob.pixels += 1;
        blob.minX = Math.min(blob.minX, x); blob.maxX = Math.max(blob.maxX, x);
        blob.minY = Math.min(blob.minY, y); blob.maxY = Math.max(blob.maxY, y);
      }
      for (const next of [index - 1, index + 1, index - GRID, index + GRID]) {
        if (next < 0 || next >= grown.length || label[next] || !grown[next]) continue;
        if ((next === index - 1 && x === 0) || (next === index + 1 && x === GRID - 1)) continue;
        label[next] = blobs.length + 1;
        stack.push(next);
      }
    }
    if (blob.pixels >= 6) blobs.push(blob);
  }
  blobs.sort((left, right) => right.pixels - left.pixels);
  const round = (n) => Math.round(n * 1000) / 1000;
  const regions = [];
  for (const blob of blobs) {
    if (regions.length >= count) break;
    let radius = Math.max(0.035, Math.min(0.2, (Math.max(blob.maxX - blob.minX, blob.maxY - blob.minY) / 2 + 3) / GRID));
    let x = (blob.minX + blob.maxX + 1) / 2 / GRID;
    let y = (blob.minY + blob.maxY + 1) / 2 / GRID;
    x = Math.min(1 - radius, Math.max(radius, x));
    y = Math.min(1 - radius, Math.max(radius, y));
    const region = { x: round(x), y: round(y), radius: round(radius) };
    if (regions.some((other) => Math.hypot(other.x - region.x, other.y - region.y) < other.radius + region.radius)) continue;
    regions.push(region);
  }
  return { regions, candidates: blobs.length };
}

async function previewPng(modifiedBytes, regions, sharp) {
  const circles = regions.map((region, index) => {
    const cx = region.x * SIZE, cy = region.y * SIZE, r = region.radius * SIZE;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ff2d55" stroke-width="6"/>` +
      `<text x="${cx}" y="${cy - r - 10}" font-size="40" font-family="sans-serif" font-weight="700" fill="#ff2d55" text-anchor="middle">${index + 1}</text>`;
  }).join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${circles}</svg>`);
  return sharp(modifiedBytes).composite([{ input: svg }]).png().toBuffer();
}

export async function suggest(dir, { count, log, sharp }) {
  const meta = await readPuzzleJson(dir).catch(() => null);
  const target = count ?? ANSWER_COUNT[meta?.mode] ?? ANSWER_COUNT.battle;
  const { images, warnings } = await normalizeImages(dir, sharp);
  warnings.forEach((warning) => log(`주의: ${warning}`));
  const { regions, candidates } = await suggestRegions(images.original.bytes, images.modified.bytes, sharp, { count: target });
  const differences = regions.map((region, index) => ({ id: `d${index + 1}`, label: `차이 ${index + 1}`, regions: [region] }));
  await writeFile(path.join(dir, "differences.suggested.json"), `${JSON.stringify(differences, null, 2)}\n`);
  await writeFile(path.join(dir, "preview.png"), await previewPng(images.modified.bytes, regions, sharp));
  log(`${path.basename(dir)}: 바뀐 곳 ${candidates}군데 중 ${regions.length}개를 추천했어요 → differences.suggested.json, preview.png`);
  if (regions.length < target) log(`주의: ${target}개가 필요한데 ${regions.length}개만 찾았어요. preview.png를 보고 직접 채워 주세요.`);
  return differences;
}

// ---------- 등록 ----------

async function readPuzzleJson(dir) {
  const text = await readFile(path.join(dir, "puzzle.json"), "utf8");
  return JSON.parse(text);
}

/** puzzle.json을 DB 행으로 만들고 서버 규칙으로 검증한다. */
export function buildRow(meta, version, images, parseCatalogRow) {
  if (!meta || typeof meta !== "object") throw new Error("puzzle.json 형식이 올바르지 않아요");
  const mode = meta.mode ?? "battle";
  if (!(mode in ANSWER_COUNT)) throw new Error(`mode는 battle 또는 solo여야 해요 (${mode})`);
  if (typeof meta.title !== "string" || !meta.title.trim()) throw new Error("title(제목)이 필요해요");
  if (typeof meta.alt !== "string" || !meta.alt.trim()) throw new Error("alt(그림 설명)가 필요해요");
  if (typeof meta.genre !== "string" || !meta.genre) throw new Error("genre(화풍)가 필요해요: 실사/애니/회화/카툰/게임");
  const difficulty = meta.difficulty ?? "UNRATED";
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`difficulty는 ${DIFFICULTIES.join("/")} 중 하나예요`);
  if (!Array.isArray(meta.differences) || meta.differences.length !== ANSWER_COUNT[mode]) {
    throw new Error(`${mode === "battle" ? "대결" : "솔로"} 그림은 차이가 정확히 ${ANSWER_COUNT[mode]}개여야 해요`);
  }
  const row = {
    pair_id: meta.id,
    asset_version: version,
    title: meta.title.trim(),
    difficulty,
    original_asset_key: objectKey(meta.id, version, "original"),
    modified_asset_key: objectKey(meta.id, version, "modified"),
    differences: meta.differences,
    metadata: {
      mode,
      genre: meta.genre,
      alt: meta.alt.trim(),
      original_sha256: images.original.sha,
      modified_sha256: images.modified.sha,
      ...(meta.tags ? { tags: meta.tags } : {}),
      ...(meta.source ? { source: meta.source } : {}),
    },
  };
  parseCatalogRow(row);
  return row;
}

function r2Client(env, clientFactory) {
  if (R2_ENV.some((name) => !env[name])) throw new Error(`R2 환경변수가 필요해요: ${R2_ENV.join(", ")}`);
  const endpoint = new URL(env.R2_ENDPOINT);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname !== "/" || !endpoint.hostname.endsWith(".r2.cloudflarestorage.com") ||
      !endpoint.hostname.startsWith(`${env.R2_ACCOUNT_ID}.`)) throw new Error("R2_ENDPOINT/R2_ACCOUNT_ID 설정이 올바르지 않아요");
  return clientFactory();
}

async function defaultR2Factory(env) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return () => new S3Client({
    region: "auto", endpoint: env.R2_ENDPOINT, forcePathStyle: true, maxAttempts: 2,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
}

/** 없으면 올리고, 이미 있으면 같은 내용인지 확인한다(재시도해도 안전). */
async function uploadObject(client, bucket, key, bytes, sha) {
  const { HeadObjectCommand, PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  let exists = true;
  try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); } catch (cause) {
    if (!isMissing(cause)) throw cause;
    exists = false;
  }
  if (!exists) {
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: bytes, ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable", IfNoneMatch: "*",
    }));
  }
  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!got.Body) throw new Error(`${key} 내려받기 실패`);
  const downloaded = Buffer.from(await got.Body.transformToByteArray());
  if (sha256(downloaded) !== sha) throw new Error(`${key}: R2에 다른 내용의 파일이 이미 있어요`);
  return exists ? "already" : "uploaded";
}

async function defaultDbFactory(env) {
  const url = env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error("SUPABASE_DB_URL 환경변수가 필요해요");
  const { default: pg } = await import("pg");
  return async () => {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000, query_timeout: 20_000 });
    await client.connect();
    return client;
  };
}

/**
 * 활성 목록을 바꾼 뒤 서버 규칙으로 다시 읽어 보고, 깨지면 되돌린다.
 * 잘못된 행 하나가 라이브 게임 전체를 멈추지 않게 한다.
 */
async function inTransactionWithCatalogCheck(db, work, validator) {
  await db.query("BEGIN");
  try {
    const result = await work();
    const active = await db.query(validator.ACTIVE_CATALOG_SQL);
    validator.parseCatalog(active.rows);
    await db.query("COMMIT");
    return result;
  } catch (cause) {
    await db.query("ROLLBACK").catch(() => {});
    throw cause;
  }
}

async function expandDirs(paths) {
  const dirs = [];
  for (const input of paths) {
    const dir = path.resolve(input);
    if (await stat(path.join(dir, "puzzle.json")).then(() => true, () => false)) { dirs.push(dir); continue; }
    const children = (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name)).sort();
    for (const child of children) {
      if (await stat(path.join(child, "puzzle.json")).then(() => true, () => false)) dirs.push(child);
    }
  }
  if (!dirs.length) throw new Error("puzzle.json이 있는 폴더를 찾지 못했어요");
  return dirs;
}

export async function publish(paths, { upload = false, activate = false, version: forcedVersion, env, now, log, sharp, validator, r2Factory, dbFactory }) {
  if (activate && !upload) throw new Error("--activate는 --upload와 함께 써야 해요");
  const dirs = await expandDirs(paths);
  let db, r2;
  const bucket = env.R2_BUCKET_NAME || "spot-difference-assets";
  if (upload) {
    r2 = r2Client(env, r2Factory ?? await defaultR2Factory(env));
    db = await (dbFactory ?? await defaultDbFactory(env))();
  }
  const results = [];
  try {
    for (const dir of dirs) {
      const name = path.basename(dir);
      try {
        const meta = await readPuzzleJson(dir);
        const { images, warnings } = await normalizeImages(dir, sharp);
        warnings.forEach((warning) => log(`${name}: 주의: ${warning}`));
        let version = forcedVersion;
        let existing = [];
        if (db) {
          existing = (await db.query("SELECT asset_version, is_active, metadata, differences, title FROM puzzle_catalog WHERE pair_id = $1", [meta.id])).rows;
          const same = existing.find((row) => row.metadata?.original_sha256 === images.original.sha &&
            row.metadata?.modified_sha256 === images.modified.sha &&
            canonical(row.differences) === canonical(meta.differences) && row.title === meta.title?.trim());
          if (same && !forcedVersion) version = same.asset_version;
        }
        version ??= nextVersion(existing.map((row) => row.asset_version), now);
        if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(version)) throw new Error(`버전 형식은 YYYY-MM-DD.N이에요 (${version})`);
        const row = buildRow(meta, version, images, validator.parseCatalogRow);
        const outDir = path.join(dir, "runtime");
        await mkdir(outDir, { recursive: true });
        for (const kind of ["original", "modified"]) await writeFile(path.join(outDir, `${kind}.webp`), images[kind].bytes);
        const label = `${row.pair_id}@${version} (${row.metadata.mode}, ${row.metadata.genre})`;
        if (!upload) {
          log(`점검 통과 ${label} — ${row.original_asset_key} ${images.original.bytes.length}B, ${row.modified_asset_key} ${images.modified.bytes.length}B`);
          results.push({ id: row.pair_id, version, status: "checked" });
          continue;
        }
        for (const kind of ["original", "modified"]) {
          await uploadObject(r2, bucket, row[`${kind}_asset_key`], images[kind].bytes, images[kind].sha);
        }
        const known = existing.find((candidate) => candidate.asset_version === version);
        if (!known) {
          await db.query(
            `INSERT INTO puzzle_catalog (pair_id, asset_version, title, difficulty, original_asset_key, modified_asset_key, differences, metadata, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, FALSE)`,
            [row.pair_id, version, row.title, row.difficulty, row.original_asset_key, row.modified_asset_key, JSON.stringify(row.differences), JSON.stringify(row.metadata)],
          );
        }
        let status = known ? "already" : "registered";
        if (activate && !known?.is_active) {
          await inTransactionWithCatalogCheck(db, () => db.query("SELECT activate_puzzle_version($1, $2)", [row.pair_id, version]), validator);
          status = "activated";
        }
        log({ registered: `등록 완료 ${label} — 아직 게임에는 안 보여요`, already: `이미 등록됨 ${label}`, activated: `게임에 노출 ${label}` }[status]);
        results.push({ id: row.pair_id, version, status });
      } catch (cause) {
        // SDK 오류 원문에는 요청·인증 정보가 섞일 수 있어 메시지만 남긴다.
        const message = cause instanceof Error && !cause.$metadata ? cause.message : "저장소 요청 실패";
        log(`${name}: 실패 — ${message}`);
        results.push({ id: name, status: "failed", error: message });
      }
    }
  } finally {
    r2?.destroy?.();
    await db?.end?.();
  }
  const failed = results.filter((result) => result.status === "failed").length;
  log(`총 ${results.length}개 중 ${results.length - failed}개 성공${failed ? `, ${failed}개 실패` : ""}${upload ? "" : " (미리 점검만 했어요. 올리려면 --upload)"}`);
  return results;
}

export async function setActive(id, version, { env, log, validator, dbFactory }) {
  const db = await (dbFactory ?? await defaultDbFactory(env))();
  try {
    if (version) {
      await inTransactionWithCatalogCheck(db, () => db.query("SELECT activate_puzzle_version($1, $2)", [id, version]), validator);
      log(`게임에 노출 ${id}@${version}`);
    } else {
      const result = await inTransactionWithCatalogCheck(db, () => db.query("UPDATE puzzle_catalog SET is_active = FALSE WHERE pair_id = $1 AND is_active", [id]), validator);
      log(result.rowCount ? `게임에서 내림 ${id}` : `${id}는 노출 중이 아니에요`);
    }
  } finally {
    await db.end?.();
  }
}

// ---------- 기존 번들 그림 내보내기 ----------

export async function exportBundled(outDir, { log }) {
  const shared = await import(path.join(ROOT, "packages/shared/dist/index.js"));
  const { GAME_PUZZLES } = await import(path.join(ROOT, "apps/server/src/game/puzzle-catalog.ts"));
  // 솔로 정답은 서버 코드에만 있다(웹 번들에는 싣지 않는다).
  const { BUNDLED_SOLO_ANSWERS } = await import(path.join(ROOT, "apps/server/src/game/solo-puzzles.ts"));
  const assets = path.join(ROOT, "apps/web/src/assets/puzzles");
  const write = async (id, meta, files) => {
    const dir = path.join(outDir, `${meta.mode}-${id}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "puzzle.json"), `${JSON.stringify({ id, ...meta }, null, 2)}\n`);
    await copyFile(files.original, path.join(dir, "original.webp"));
    await copyFile(files.modified, path.join(dir, "modified.webp"));
  };
  for (const puzzle of GAME_PUZZLES) {
    const info = shared.BUNDLED_BATTLE_INFO[puzzle.id];
    const manifest = shared.GAME_PUZZLE_ASSET_MANIFEST[puzzle.id];
    await write(puzzle.id, {
      mode: "battle", title: info.title, genre: info.genre, alt: info.alt, difficulty: manifest.difficulty,
      source: { bundledVersion: puzzle.assetVersion }, differences: puzzle.differences,
    }, { original: path.join(assets, manifest.original.fileName), modified: path.join(assets, manifest.modified.fileName) });
  }
  for (const puzzle of shared.BUNDLED_SOLO_PUZZLES) {
    await write(puzzle.id, {
      mode: "solo", title: puzzle.title, genre: puzzle.genre, alt: puzzle.alt,
      source: { bundledVersion: puzzle.version },
      differences: BUNDLED_SOLO_ANSWERS.find((solo) => solo.id === puzzle.id).answers.map((answer) => ({ id: answer.id, label: answer.label, regions: [answer.region, ...(answer.extraRegions ?? [])] })),
    }, { original: path.join(assets, "solo", `${puzzle.id}-original.webp`), modified: path.join(assets, "solo", `${puzzle.id}-modified.webp`) });
  }
  const total = GAME_PUZZLES.length + shared.BUNDLED_SOLO_PUZZLES.length;
  log(`대결 ${GAME_PUZZLES.length}개, 솔로 ${shared.BUNDLED_SOLO_PUZZLES.length}개(총 ${total}개)를 ${outDir}에 내보냈어요`);
  return total;
}

// ---------- CLI ----------

function parseArgs(args) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--upload" || arg === "--activate") flags[arg.slice(2)] = true;
    else if (arg === "--version" || arg === "--count") flags[arg.slice(2)] = args[++index];
    else if (arg.startsWith("--")) throw new Error(`알 수 없는 옵션: ${arg}`);
    else positional.push(arg);
  }
  return { positional, flags };
}

export async function main({ args = process.argv.slice(2), env = process.env, now = new Date(), log = console.log, error = console.error, deps = {} } = {}) {
  const [command, ...rest] = args;
  try {
    const { positional, flags } = parseArgs(rest);
    const sharp = deps.sharp ?? (command === "suggest" || command === "publish" ? await loadSharp() : undefined);
    const validator = deps.validator ?? (["publish", "activate", "deactivate"].includes(command) ? await loadValidator() : undefined);
    if (command === "suggest" && positional.length === 1) {
      const count = flags.count === undefined ? undefined : Number.parseInt(flags.count, 10);
      if (count !== undefined && !(count >= 1 && count <= 10)) throw new Error("--count는 1~10이에요");
      await suggest(path.resolve(positional[0]), { count, log, sharp });
      return 0;
    }
    if (command === "publish" && positional.length) {
      const results = await publish(positional, { ...flags, env, now, log, sharp, validator, r2Factory: deps.r2Factory, dbFactory: deps.dbFactory });
      return results.some((result) => result.status === "failed") ? 1 : 0;
    }
    if (command === "activate" && positional.length === 2) {
      await setActive(positional[0], positional[1], { env, log, validator, dbFactory: deps.dbFactory });
      return 0;
    }
    if (command === "deactivate" && positional.length === 1) {
      await setActive(positional[0], undefined, { env, log, validator, dbFactory: deps.dbFactory });
      return 0;
    }
    if (command === "export-bundled" && positional.length === 1) {
      await exportBundled(path.resolve(positional[0]), { log });
      return 0;
    }
    error(USAGE);
    return 2;
  } catch (cause) {
    error(`실패 — ${cause instanceof Error && !cause.$metadata ? cause.message : "요청 실패"}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
