import { COSMETIC_ITEMS } from "@spot-battle/shared";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./gallery.css", import.meta.url)), "utf8");

describe("cosmetic styles", () => {
  it("has a style for every marker, frame and profile border", () => {
    for (const item of COSMETIC_ITEMS.filter((entry) => ["marker", "frame", "profile"].includes(entry.slot))) {
      if (item.id === "frame-none" || item.id === "profile-none") continue;
      expect(css, item.id).toMatch(new RegExp(`\\.${item.id}\\b`));
    }
  });
});
