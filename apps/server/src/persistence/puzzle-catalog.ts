import { GameMatch, type MatchPuzzle } from "@spot-battle/game-core";
import { GAME_PUZZLE_ASSET_MANIFEST, GAME_PUZZLE_IDS, type GamePuzzleId } from "@spot-battle/shared";
import { Pool } from "pg";

export interface CatalogRow {
  pair_id: string;
  asset_version: string;
  original_asset_key: string;
  modified_asset_key: string;
  differences: unknown;
}

export function parseCatalog(rows: readonly CatalogRow[]): MatchPuzzle[] {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Active puzzle_catalog is empty.");
  const seen = new Set<string>();
  return rows.map((row) => {
    if (!row || typeof row.pair_id !== "string" || !row.pair_id.trim()) {
      throw new Error("Invalid catalog pair_id.");
    }
    const id = row.pair_id as GamePuzzleId;
    if (!GAME_PUZZLE_IDS.includes(id) || seen.has(id)) throw new Error("Unsupported or duplicate catalog puzzle.");
    seen.add(id);
    if (typeof row.asset_version !== "string" || !row.asset_version.trim() ||
      GAME_PUZZLE_ASSET_MANIFEST[id].version !== row.asset_version) throw new Error(`Catalog asset version mismatch: ${id}`);
    for (const kind of ["original", "modified"] as const) {
      if (row[`${kind}_asset_key`] !== `puzzles/${id}/${row.asset_version}/runtime/${kind}.webp`) {
        throw new Error(`Catalog object key mismatch: ${id}`);
      }
    }
    const differences = row.differences;
    if (!Array.isArray(differences) || !differences.length) throw new Error(`Invalid differences: ${id}`);
    const ids = new Set<string>();
    for (const difference of differences) {
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
    }
    const puzzle = { id, assetVersion: row.asset_version, differences: structuredClone(differences) } as MatchPuzzle;
    new GameMatch("catalog-validation", [puzzle], [
      { playerId: "catalog-validator-1", nickname: "validator" },
      { playerId: "catalog-validator-2", nickname: "validator" },
    ]);
    return puzzle;
  });
}

export interface CatalogClient {
  query(sql: string): Promise<{ rows: CatalogRow[] }>;
  end(): Promise<void>;
}

export async function loadDatabasePuzzles(
  connectionString: string,
  createClient: (url: string) => CatalogClient =
    (url) => new Pool({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 10000 }),
): Promise<MatchPuzzle[]> {
  const pool = createClient(connectionString);
  try {
    const result = await pool.query("SELECT pair_id, asset_version, original_asset_key, modified_asset_key, differences FROM puzzle_catalog WHERE is_active ORDER BY pair_id");
    return parseCatalog(result.rows);
  } finally {
    await pool.end();
  }
}
