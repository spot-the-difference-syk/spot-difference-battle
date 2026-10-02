import { describe, expect, it } from "vitest";
import { formatSoloTime } from "./solo-engine";

describe("solo time display", () => {
  it("shows hundredths of a second", () => {
    expect(formatSoloTime(19_120)).toBe("19.12초");
    expect(formatSoloTime(7_000)).toBe("7.00초");
  });
});
