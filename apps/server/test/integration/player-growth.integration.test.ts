import { emptyGrowth } from "@spot-battle/shared";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SupabasePostgresMatchStore } from "../../src/persistence/match-store.js";

const databaseUrl = process.env.SUPABASE_DB_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("Cloudflare Worker growth backup", () => {
  it("upserts many players in one query without a guest session row and finds them by token hash", async () => {
    const store = new SupabasePostgresMatchStore(databaseUrl!);
    try {
      const players = Array.from({ length: 3 }, (_, index) => ({
        playerId: randomUUID(),
        tokenHash: randomUUID().replaceAll("-", "") + index,
        growth: { ...emptyGrowth(), totalXp: 10 * (index + 1), collected: [`game:it's-"quoted"`.replace(/[^a-z:-]/g, "") || "game:x"] },
      }));
      await store.saveGrowthBatch(players);
      await store.saveGrowthBatch([{ ...players[0]!, growth: { ...players[0]!.growth, totalXp: 999, coins: 5 } }]);
      await store.saveGrowthBatch([]);
      expect(await store.findGrowthByTokenHash(players[0]!.tokenHash)).toMatchObject({ playerId: players[0]!.playerId, growth: { totalXp: 999, coins: 5 } });
      expect(await store.findGrowthByTokenHash(players[2]!.tokenHash)).toMatchObject({ growth: { totalXp: 30 } });
      expect(await store.findGrowthByTokenHash("missing")).toBeNull();
    } finally {
      await store.close();
    }
  });
});
