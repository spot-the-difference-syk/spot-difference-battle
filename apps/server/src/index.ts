import { resolveMatchStoreKind, resolvePuzzleCatalogSource } from "./config/runtime.js";
import { loadDatabaseCatalog } from "./persistence/puzzle-catalog.js";
import { CatalogService } from "./game/catalog-service.js";
import { createGameServer } from "./server.js";
import { InMemoryMatchStore, SupabasePostgresMatchStore } from "./persistence/match-store.js";
import {
  GAME_SCENE_IDS,
} from "@spot-battle/shared";
import { resolveWebOrigin } from "./config/web-origin.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const webOrigin = resolveWebOrigin(process.env.WEB_ORIGIN, process.env.NODE_ENV);
const staticRoot = process.env.WEB_ROOT?.trim() || undefined;
const configuredSceneId = process.env.GAME_SCENE_ID?.trim();
const catalogSource = resolvePuzzleCatalogSource(process.env.PUZZLE_CATALOG_SOURCE);
if (
  catalogSource === "code" &&
  configuredSceneId &&
  !GAME_SCENE_IDS.some((id) => id === configuredSceneId)
) {
  throw new Error(
    `GAME_SCENE_ID must be one of: ${GAME_SCENE_IDS.join(", ")}`,
  );
}
const supabaseDatabaseUrl = process.env.SUPABASE_DB_URL?.trim();
const storeKind = resolveMatchStoreKind(process.env);
if (catalogSource === "database" && !supabaseDatabaseUrl) {
  throw new Error("SUPABASE_DB_URL is required for database puzzle catalog.");
}
const assetBaseUrl = process.env.PUZZLE_ASSET_BASE_URL?.trim() || undefined;
if (catalogSource === "database" && !assetBaseUrl) {
  throw new Error("PUZZLE_ASSET_BASE_URL (R2 image delivery origin) is required for database puzzle catalog.");
}
const loadCatalog = () => loadDatabaseCatalog(supabaseDatabaseUrl!, assetBaseUrl);
const catalog = catalogSource === "database"
  ? new CatalogService(await loadCatalog(), loadCatalog, { assetBaseUrl, onError: (error) => console.error("catalog.refresh_failed", error instanceof Error ? error.message : "unknown") })
  : undefined;
const matchStore = storeKind === "postgres"
  ? new SupabasePostgresMatchStore(supabaseDatabaseUrl!)
  : new InMemoryMatchStore();
const app = await createGameServer({
  webOrigin,
  staticRoot,
  matchStore,
  sceneId: configuredSceneId,
  catalog,
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
