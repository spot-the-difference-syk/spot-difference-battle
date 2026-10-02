import { GameMatch, type MatchPuzzle } from "@spot-battle/game-core";
import {
  ART_GENRES,
  ASSET_VERSION_PATTERN,
  PUZZLE_ID_PATTERN,
  puzzleObjectKey,
  type ArtGenre,
  type PuzzleCard,
  type SoloAnswer,
} from "@spot-battle/shared";
import type { SoloPuzzle } from "../game/solo-puzzles.js";
import { Pool } from "pg";
import type { LoadedCatalog } from "../game/catalog-service.js";

export interface CatalogRow {
  pair_id: string;
  asset_version: string;
  original_asset_key: string;
  modified_asset_key: string;
  differences: unknown;
  title?: string;
  metadata?: unknown;
}

const SOLO_ANSWER_COUNT = 5;

interface Region { x: number; y: number; radius: number }

function parseDifferences(id: string, value: unknown): Array<{ id: string; label: string; regions: Region[] }> {
  if (!Array.isArray(value) || !value.length) throw new Error(`Invalid differences: ${id}`);
  const ids = new Set<string>();
  return value.map((difference) => {
    if (!difference || typeof difference !== "object" || Array.isArray(difference) ||
      typeof difference.id !== "string" || !difference.id.trim() || ids.has(difference.id) ||
      typeof difference.label !== "string" || !difference.label.trim() || !Array.isArray(difference.regions) || !difference.regions.length) {
      throw new Error(`Invalid difference: ${id}`);
    }
    ids.add(difference.id);
    for (const region of difference.regions) {
      if (!region || typeof region !== "object" || Array.isArray(region) ||
        ![region.x, region.y, region.radius].every((n) => typeof n === "number" && Number.isFinite(n))
        || region.x < 0 || region.x > 1 || region.y < 0 || region.y > 1 || region.radius <= 0 || region.radius > 1) {
        throw new Error(`Invalid answer region: ${id}`);
      }
    }
    return structuredClone(difference) as { id: string; label: string; regions: Region[] };
  });
}

function metadataOf(row: CatalogRow): { mode: "battle" | "solo"; genre: ArtGenre; alt: string } {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
  const mode = metadata.mode === undefined ? "battle" : metadata.mode;
  if (mode !== "battle" && mode !== "solo") throw new Error(`Invalid catalog mode: ${row.pair_id}`);
  const genre = metadata.genre === undefined ? "실사" : metadata.genre;
  if (!ART_GENRES.includes(genre as ArtGenre)) throw new Error(`Invalid catalog genre: ${row.pair_id}`);
  const alt = typeof metadata.alt === "string" && metadata.alt.trim() ? metadata.alt.trim() : (row.title ?? row.pair_id);
  return { mode, genre: genre as ArtGenre, alt };
}

export interface ParsedCatalogRow {
  card: PuzzleCard;
  /** 정답이 들어 있어 서버 밖으로 보내지 않는다. 대결·솔로 중 하나만 있다. */
  battle?: MatchPuzzle;
  solo?: SoloPuzzle;
}

/**
 * 카탈로그 행 하나를 검증한다. 새 그림은 코드 수정 없이 DB 행만으로 추가되므로
 * ID·버전은 형식만 검사한다. 등록 도구(scripts/puzzle-publish.mjs)도 이 함수를 쓴다.
 */
export function parseCatalogRow(row: CatalogRow, assetBaseUrl?: string): ParsedCatalogRow {
  if (!row || typeof row.pair_id !== "string" || !PUZZLE_ID_PATTERN.test(row.pair_id)) {
    throw new Error("Invalid catalog pair_id.");
  }
  const id = row.pair_id;
  if (typeof row.asset_version !== "string" || !ASSET_VERSION_PATTERN.test(row.asset_version)) {
    throw new Error(`Invalid catalog asset version: ${id}`);
  }
  for (const kind of ["original", "modified"] as const) {
    if (row[`${kind}_asset_key`] !== puzzleObjectKey(id, row.asset_version, kind)) {
      throw new Error(`Catalog object key mismatch: ${id}`);
    }
  }
  const differences = parseDifferences(id, row.differences);
  const { mode, genre, alt } = metadataOf(row);
  const base = assetBaseUrl?.replace(/\/+$/, "");
  const card: PuzzleCard = {
    id,
    version: row.asset_version,
    mode,
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : id,
    alt,
    genre,
    ...(base ? {
      originalUrl: `${base}/${row.original_asset_key}`,
      modifiedUrl: `${base}/${row.modified_asset_key}`,
    } : {}),
  };
  if (mode === "solo") {
    if (differences.length !== SOLO_ANSWER_COUNT) throw new Error(`Solo puzzle needs ${SOLO_ANSWER_COUNT} differences: ${id}`);
    const answers = differences.map(({ id: answerId, label, regions }): SoloAnswer => ({
      id: answerId,
      label,
      region: regions[0]!,
      ...(regions.length > 1 ? { extraRegions: regions.slice(1) } : {}),
    }));
    return { card, solo: { id, version: row.asset_version, answers } };
  }
  const puzzle = { id, assetVersion: row.asset_version, differences } as MatchPuzzle;
  new GameMatch("catalog-validation", [puzzle], [
    { playerId: "catalog-validator-1", nickname: "validator" },
    { playerId: "catalog-validator-2", nickname: "validator" },
  ]);
  return { card, battle: puzzle };
}

/** 활성 카탈로그 행을 검증해 대결 문제(정답 포함, 서버 전용)와 공개 카드로 나눈다. */
export function parseCatalog(rows: readonly CatalogRow[], assetBaseUrl?: string): LoadedCatalog {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Active puzzle_catalog is empty.");
  const seen = new Set<string>();
  const battle: MatchPuzzle[] = [];
  const solo: SoloPuzzle[] = [];
  const cards: PuzzleCard[] = [];
  for (const row of rows) {
    const parsed = parseCatalogRow(row, assetBaseUrl);
    if (seen.has(parsed.card.id)) throw new Error(`Duplicate active catalog puzzle: ${parsed.card.id}`);
    seen.add(parsed.card.id);
    if (parsed.battle) battle.push(parsed.battle);
    if (parsed.solo) solo.push(parsed.solo);
    cards.push(parsed.card);
  }
  if (!battle.length) throw new Error("Active puzzle_catalog has no battle puzzles.");
  return { battle, solo, cards };
}

export const ACTIVE_CATALOG_SQL =
  "SELECT pair_id, asset_version, title, original_asset_key, modified_asset_key, differences, metadata FROM puzzle_catalog WHERE is_active ORDER BY pair_id";

export interface CatalogClient {
  query(sql: string): Promise<{ rows: CatalogRow[] }>;
  end(): Promise<void>;
}

export async function loadDatabaseCatalog(
  connectionString: string,
  assetBaseUrl?: string,
  createClient: (url: string) => CatalogClient =
    (url) => new Pool({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 10000 }),
): Promise<LoadedCatalog> {
  const pool = createClient(connectionString);
  try {
    const result = await pool.query(ACTIVE_CATALOG_SQL);
    return parseCatalog(result.rows, assetBaseUrl);
  } finally {
    await pool.end();
  }
}
