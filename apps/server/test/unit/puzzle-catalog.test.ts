import { describe, expect, it, vi } from "vitest";
import { CatalogService, codeCatalog, type LoadedCatalog } from "../../src/game/catalog-service.js";
import { GAME_PUZZLES } from "../../src/game/puzzle-catalog.js";
import { loadDatabaseCatalog, parseCatalog, type CatalogRow } from "../../src/persistence/puzzle-catalog.js";

function row(patch: Partial<CatalogRow> = {}): CatalogRow {
  const puzzle = GAME_PUZZLES.find((item) => item.id === "home-office")!;
  const id = patch.pair_id ?? puzzle.id;
  const version = patch.asset_version ?? puzzle.assetVersion;
  return {
    pair_id: id,
    asset_version: version,
    original_asset_key: `puzzles/${id}/${version}/runtime/original.webp`,
    modified_asset_key: `puzzles/${id}/${version}/runtime/modified.webp`,
    differences: structuredClone(puzzle.differences),
    title: "햇살 좋은 홈오피스",
    metadata: { genre: "실사", alt: "홈오피스" },
    ...patch,
  };
}

const soloDifferences = Array.from({ length: 5 }, (_, index) => ({
  id: `d${index}`,
  label: `차이 ${index}`,
  regions: [{ x: 0.1 * (index + 1), y: 0.5, radius: 0.05 }, ...(index === 0 ? [{ x: 0.2, y: 0.6, radius: 0.03 }] : [])],
}));

describe("database puzzle contract", () => {
  it("loads valid rows, copies the answer snapshot and builds public cards", () => {
    const input = row();
    const parsed = parseCatalog([input], "https://img.example.com/");
    expect(parsed.battle[0]).toEqual(GAME_PUZZLES.find((item) => item.id === "home-office"));
    expect(parsed.battle[0]!.differences).not.toBe(input.differences);
    expect(parsed.cards[0]).toEqual({
      id: "home-office",
      version: input.asset_version,
      mode: "battle",
      title: "햇살 좋은 홈오피스",
      alt: "홈오피스",
      genre: "실사",
      originalUrl: `https://img.example.com/${input.original_asset_key}`,
      modifiedUrl: `https://img.example.com/${input.modified_asset_key}`,
    });
    expect(JSON.stringify(parsed.cards)).not.toContain("regions");
  });

  it("accepts brand-new puzzles without code changes and keeps solo answers on the server", () => {
    const parsed = parseCatalog([
      row(),
      row({ pair_id: "night-market", asset_version: "2026-10-02.1", metadata: { genre: "애니" } }),
      row({ pair_id: "tea-house", asset_version: "2026-10-02.1", differences: soloDifferences, metadata: { mode: "solo", genre: "회화" } }),
    ]);
    expect(parsed.battle.map((puzzle) => puzzle.id)).toEqual(["home-office", "night-market"]);
    expect(parsed.cards.find((card) => card.id === "tea-house")!.mode).toBe("solo");
    // 솔로 정답은 서버만 가진다. 카드에는 싣지 않는다.
    expect(JSON.stringify(parsed.cards)).not.toContain('"answers"');
    const solo = parsed.solo.find((puzzle) => puzzle.id === "tea-house")!;
    expect(solo.version).toBe("2026-10-02.1");
    expect(solo.answers).toHaveLength(5);
    expect(solo.answers[0]).toMatchObject({ id: "d0", region: { x: 0.1 }, extraRegions: [{ x: 0.2 }] });
  });

  it("rejects empty, duplicate and invalid rows", () => {
    expect(() => parseCatalog([])).toThrow();
    expect(() => parseCatalog([row(), row()])).toThrow();
    expect(() => parseCatalog([row({ pair_id: "tea-house", asset_version: "2026-10-02.1", differences: soloDifferences, metadata: { mode: "solo" } })])).toThrow("no battle");
    const invalid: Partial<CatalogRow>[] = [
      { pair_id: "" }, { pair_id: "Bad_ID" }, { pair_id: "../x" }, { asset_version: "" }, { asset_version: "wrong" },
      { original_asset_key: "https://wrong" }, { modified_asset_key: "../wrong" },
      { differences: null }, { differences: [] }, { differences: "bad" },
      { differences: [{ id: "a", label: "a", regions: [{ x: 2, y: 0, radius: 0.1 }] }] },
      { differences: [{ id: "a", label: "a", regions: [null] }] },
      { differences: [{ id: "a", label: "", regions: [{ x: 0, y: 0, radius: 0.1 }] }] },
      { metadata: { mode: "coop" } }, { metadata: { genre: "3D" } },
      { metadata: { mode: "solo" } },
    ];
    for (const patch of invalid) {
      const input = { ...row(), ...patch };
      expect(() => parseCatalog([input, row({ pair_id: "night-market" })])).toThrow();
    }
    expect(() => parseCatalog([null as unknown as CatalogRow])).toThrow();
  });

  it("queries only active rows in pair order and closes the client", async () => {
    const query = vi.fn(async () => ({ rows: [row()] }));
    const end = vi.fn(async () => {});
    const catalog = await loadDatabaseCatalog("postgres://test", undefined, () => ({ query, end }));
    expect(catalog.battle).toHaveLength(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE is_active ORDER BY pair_id"));
    expect(end).toHaveBeenCalledOnce();
  });

  it("fails closed on query, connection, or empty result", async () => {
    const end = vi.fn(async () => {});
    await expect(loadDatabaseCatalog("postgres://test", undefined, () => ({
      query: async () => { throw new Error("query failed"); }, end,
    }))).rejects.toThrow("query failed");
    expect(end).toHaveBeenCalledOnce();
    await expect(loadDatabaseCatalog("postgres://test", undefined, () => {
      throw new Error("connection failed");
    })).rejects.toThrow("connection failed");
    await expect(loadDatabaseCatalog("postgres://test", undefined, () => ({
      query: async () => ({ rows: [] }), end: async () => {},
    }))).rejects.toThrow("empty");
  });
});

describe("catalog service", () => {
  it("refreshes after the interval, keeps the last good catalog on failure, and remembers old deck cards", async () => {
    let now = 0;
    const first = parseCatalog([row()], "https://img.example.com");
    const second = parseCatalog([row({ pair_id: "night-market", asset_version: "2026-10-02.1", title: "야시장" })], "https://img.example.com");
    const loader = vi.fn<() => Promise<LoadedCatalog>>().mockResolvedValueOnce(second).mockRejectedValueOnce(new Error("db down"));
    const onError = vi.fn();
    const service = new CatalogService(first, loader, { refreshMs: 1_000, now: () => now, assetBaseUrl: "https://img.example.com", onError });
    expect((await service.fresh()).battle[0]!.id).toBe("home-office");
    expect(loader).not.toHaveBeenCalled();
    now = 1_000;
    expect((await service.fresh()).battle[0]!.id).toBe("night-market");
    now = 2_000;
    expect((await service.fresh()).battle[0]!.id).toBe("night-market");
    expect(onError).toHaveBeenCalledOnce();
    expect(service.deckCards([{ id: "home-office", assetVersion: first.battle[0]!.assetVersion }])[0]!.title).toBe("햇살 좋은 홈오피스");
    expect(service.deckCards([{ id: "gone", assetVersion: "2026-01-01.1" }])[0]).toMatchObject({
      originalUrl: "https://img.example.com/puzzles/gone/2026-01-01.1/runtime/original.webp",
    });
  });

  it("picks at most ten puzzles per match from a large catalog", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ ...GAME_PUZZLES[0]!, id: `puzzle-${index}` }));
    const service = new CatalogService(codeCatalog(many));
    const deck = service.pickDeck();
    expect(deck).toHaveLength(10);
    expect(new Set(deck.map((puzzle) => puzzle.id)).size).toBe(10);
  });

  it("serves bundled cards without answers and keeps solo answers on the server", () => {
    const service = new CatalogService(codeCatalog());
    expect(service.cards.filter((card) => card.mode === "battle")).toHaveLength(GAME_PUZZLES.length);
    expect(JSON.stringify(service.cards)).not.toContain('"answers"');
    expect(service.soloPuzzle("observatory")).toMatchObject({ id: "observatory" });
    expect(service.soloPuzzle("cozy-cafe")).toBeUndefined();
    const solo = service.soloPuzzle("observatory")!;
    expect(service.soloAnswers("observatory", solo.version)?.answers).toHaveLength(5);
    expect(service.soloAnswers("observatory", "old-version")).toBeUndefined();
  });
});
