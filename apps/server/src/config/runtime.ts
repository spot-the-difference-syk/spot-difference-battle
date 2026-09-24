export type PuzzleCatalogSource = "code" | "database";

export function resolvePuzzleCatalogSource(value: string | undefined): PuzzleCatalogSource {
  const source = value?.trim() || "code";
  if (source !== "code" && source !== "database") {
    throw new Error("PUZZLE_CATALOG_SOURCE must be code or database.");
  }
  return source;
}

export function resolveMatchStoreKind(env: NodeJS.ProcessEnv): "memory" | "postgres" {
  const databaseUrl = env.SUPABASE_DB_URL?.trim();
  const useMemoryStore = env.NODE_ENV !== "production" && env.STORAGE_DRIVER === "memory";
  if (!databaseUrl && !useMemoryStore) {
    throw new Error(
      "SUPABASE_DB_URL is required. STORAGE_DRIVER=memory is allowed only for explicit local tests.",
    );
  }
  return databaseUrl ? "postgres" : "memory";
}
