import { describe, expect, it, vi } from "vitest";
import { GAME_PUZZLES } from "../../src/game/puzzle-catalog.js";
import { loadDatabasePuzzles, parseCatalog, type CatalogRow } from "../../src/persistence/puzzle-catalog.js";

function row(): CatalogRow {
  const puzzle = GAME_PUZZLES.find((item) => item.id === "home-office")!;
  return {
    pair_id: puzzle.id,
    asset_version: puzzle.assetVersion,
    original_asset_key: `puzzles/${puzzle.id}/${puzzle.assetVersion}/runtime/original.webp`,
    modified_asset_key: `puzzles/${puzzle.id}/${puzzle.assetVersion}/runtime/modified.webp`,
    differences: structuredClone(puzzle.differences),
  };
}

describe("database puzzle contract", () => {
  it("loads valid rows and copies the answer snapshot", () => {
    const input = row();
    const parsed = parseCatalog([input]);
    expect(parsed[0]).toEqual(GAME_PUZZLES.find((item) => item.id === "home-office"));
    expect(parsed[0]!.differences).not.toBe(input.differences);
  });

  it("rejects empty, duplicate, unsupported, and invalid rows", () => {
    expect(() => parseCatalog([])).toThrow();
    expect(() => parseCatalog([row(), row()])).toThrow();
    const invalid: Partial<CatalogRow>[] = [
      { pair_id: "" }, { pair_id: "unknown" }, { asset_version: "" }, { asset_version: "wrong" },
      { original_asset_key: "https://wrong" }, { modified_asset_key: "../wrong" },
      { differences: null }, { differences: [] }, { differences: "bad" },
      { differences: [{ id: "a", label: "a", regions: [{ x: 2, y: 0, radius: 0.1 }] }] },
      { differences: [{ id: "a", label: "a", regions: [null] }] },
      { differences: [{ id: "a", label: "", regions: [{ x: 0, y: 0, radius: 0.1 }] }] },
    ];
    for (const patch of invalid) {
      expect(() => parseCatalog([{ ...row(), ...patch }])).toThrow();
    }
    expect(() => parseCatalog([null as unknown as CatalogRow])).toThrow();
  });

  it("queries only active rows in pair order and closes the client", async () => {
    const query = vi.fn(async () => ({ rows: [row()] }));
    const end = vi.fn(async () => {});
    const puzzles = await loadDatabasePuzzles("postgres://test", () => ({ query, end }));
    expect(puzzles).toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE is_active ORDER BY pair_id"));
    expect(end).toHaveBeenCalledOnce();
  });

  it("fails closed on query, connection, or empty result", async () => {
    const end = vi.fn(async () => {});
    await expect(loadDatabasePuzzles("postgres://test", () => ({
      query: async () => { throw new Error("query failed"); }, end,
    }))).rejects.toThrow("query failed");
    expect(end).toHaveBeenCalledOnce();
    await expect(loadDatabasePuzzles("postgres://test", () => {
      throw new Error("connection failed");
    })).rejects.toThrow("connection failed");
    await expect(loadDatabasePuzzles("postgres://test", () => ({
      query: async () => ({ rows: [] }), end: async () => {},
    }))).rejects.toThrow("empty");
  });
});
