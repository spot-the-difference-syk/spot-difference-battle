import { BUNDLED_SOLO_PUZZLES, bundledPuzzleCards, type PuzzleCard } from "@spot-battle/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOLO_ASSET_MANIFEST } from "../solo/puzzles/manifest";
import { BUNDLED_VISUALS, fetchCatalog, featuredVisual, preloadVisual, toVisual } from "./puzzle-catalog";

const remote: PuzzleCard = {
  id: "night-market",
  version: "2026-10-02.1",
  mode: "battle",
  title: "야시장",
  alt: "등불이 켜진 야시장",
  genre: "애니",
  originalUrl: "https://img.example.com/puzzles/night-market/2026-10-02.1/runtime/original.webp",
  modifiedUrl: "https://img.example.com/puzzles/night-market/2026-10-02.1/runtime/modified.webp",
};

describe("puzzle catalog on the web", () => {
  it("uses server image URLs for new puzzles and bundled images otherwise", () => {
    expect(toVisual(remote)).toMatchObject({ key: "game:night-market", originalSrc: remote.originalUrl, modifiedSrc: remote.modifiedUrl });
    const bundled = toVisual({ ...remote, id: "cozy-cafe", originalUrl: undefined, modifiedUrl: undefined })!;
    expect(bundled.originalSrc).not.toMatch(/^https:\/\/img\.example\.com/);
    expect(toVisual({ ...remote, id: "unknown-without-url", originalUrl: undefined, modifiedUrl: undefined })).toBeNull();
    expect(toVisual({ ...remote, mode: "solo" })).toMatchObject({ mode: "solo", key: "solo:night-market" });
  });

  it("ships every bundled puzzle as a playable fallback", () => {
    expect(BUNDLED_VISUALS).toHaveLength(bundledPuzzleCards().length);
    expect(BUNDLED_VISUALS.filter((visual) => visual.mode === "solo")).toHaveLength(BUNDLED_SOLO_PUZZLES.length);
    for (const puzzle of BUNDLED_SOLO_PUZZLES) expect(SOLO_ASSET_MANIFEST[puzzle.id].version).toBe(puzzle.version);
    expect(featuredVisual([], new Date(0))).toBe(BUNDLED_VISUALS[0]);
  });

  it("loads the server catalog and rejects broken responses", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ puzzles: [remote] }), { status: 200 }));
    await expect(fetchCatalog("https://game.example.com", ok as unknown as typeof fetch)).resolves.toHaveLength(1);
    expect(ok).toHaveBeenCalledWith("https://game.example.com/catalog", expect.anything());
    const failing = vi.fn(async () => new Response("nope", { status: 503 }));
    await expect(fetchCatalog("https://game.example.com", failing as unknown as typeof fetch)).rejects.toThrow("503");
    const empty = vi.fn(async () => new Response(JSON.stringify({ puzzles: [] }), { status: 200 }));
    await expect(fetchCatalog("https://game.example.com", empty as unknown as typeof fetch)).rejects.toThrow("empty");
  });
});

describe("image preloading", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubImages(fail: () => boolean) {
    const loaded: string[] = [];
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        loaded.push(value);
        queueMicrotask(() => (fail() ? this.onerror?.() : this.onload?.()));
      }
    });
    return loaded;
  }

  it("loads both images once and shares the promise between callers", async () => {
    const loaded = stubImages(() => false);
    const visual = { originalSrc: "https://img.example/a-original.webp", modifiedSrc: "https://img.example/a-modified.webp" };
    await Promise.all([preloadVisual(visual), preloadVisual(visual)]);
    expect(loaded).toEqual([visual.originalSrc, visual.modifiedSrc]);
  });

  it("forgets a failed image so the next attempt retries it", async () => {
    let failing = true;
    const loaded = stubImages(() => failing);
    const visual = { originalSrc: "https://img.example/b-original.webp", modifiedSrc: "https://img.example/b-modified.webp" };
    await expect(preloadVisual(visual)).rejects.toThrow("이미지를 불러오지 못했어요");
    failing = false;
    await expect(preloadVisual(visual)).resolves.toBeUndefined();
    expect(loaded.filter((src) => src === visual.originalSrc)).toHaveLength(2);
  });
});
