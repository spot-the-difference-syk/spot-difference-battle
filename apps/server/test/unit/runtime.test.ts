import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolveMatchStoreKind, resolvePuzzleCatalogSource } from "../../src/config/runtime.js";

describe("puzzle catalog source", () => {
  it("defaults to code and accepts explicit database", () => {
    expect(resolvePuzzleCatalogSource(undefined)).toBe("code");
    expect(resolvePuzzleCatalogSource("")).toBe("code");
    expect(resolvePuzzleCatalogSource(" database ")).toBe("database");
  });
  it("rejects unsupported sources", () => {
    expect(() => resolvePuzzleCatalogSource("typo")).toThrow("PUZZLE_CATALOG_SOURCE");
  });
});

describe("existing match store selection", () => {
  it("requires a URL unless local memory is explicitly selected", () => {
    expect(() => resolveMatchStoreKind({})).toThrow("SUPABASE_DB_URL");
    expect(resolveMatchStoreKind({ STORAGE_DRIVER: "memory" })).toBe("memory");
    expect(() => resolveMatchStoreKind({ NODE_ENV: "production", STORAGE_DRIVER: "memory" })).toThrow();
  });
  it("preserves database URL precedence over local memory", () => {
    expect(resolveMatchStoreKind({ STORAGE_DRIVER: "memory", SUPABASE_DB_URL: "postgres://test" })).toBe("postgres");
    expect(resolveMatchStoreKind({ SUPABASE_DB_URL: "postgres://test" })).toBe("postgres");
  });
});
it("never falls back to code catalog when database startup fails", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      STORAGE_DRIVER: "memory",
      PUZZLE_CATALOG_SOURCE: "database",
      SUPABASE_DB_URL: "postgres://unused:unused@127.0.0.1:1/unused",
      HOST: "127.0.0.1",
      PORT: "0",
    },
    timeout: 8_000,
    encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/ECONNREFUSED|connect/);
}, 10_000);
it("rejects an unsupported code-mode GAME_SCENE_ID at startup", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: "test", STORAGE_DRIVER: "memory", SUPABASE_DB_URL: "",
      PUZZLE_CATALOG_SOURCE: "code", GAME_SCENE_ID: "home-office", HOST: "127.0.0.1", PORT: "0",
    },
    timeout: 8_000,
    encoding: "utf8",
  });
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/GAME_SCENE_ID must be one of/);
});
