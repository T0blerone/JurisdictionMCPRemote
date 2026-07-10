import { describe, it, expect } from "vitest";
import { checkFreshness } from "./freshness";

describe("checkFreshness", () => {
  const cases: [string, string, boolean, string][] = [
    ["2025-11-15", "2025-12-20", true, "35 days, no boundary crossed"],
    ["2025-11-15", "2026-01-05", false, "Jan 1 boundary passed"],
    ["2026-01-02", "2026-05-01", false, "119 days > 90"],
    ["2026-01-02", "2026-03-15", true, "72 days, after Jan 1"],
    ["2026-06-20", "2026-07-02", false, "Jul 1 boundary passed"],
    ["2026-07-01", "2026-08-01", true, "confirmed on the boundary counts"],
  ];
  for (const [confirmed, asOf, expected, note] of cases) {
    it(`${confirmed} -> ${asOf} (${note})`, () => {
      expect(checkFreshness(confirmed, asOf).fresh).toBe(expected);
    });
  }

  it("expires_on(2025-11-15) -> 2026-01-01", () => {
    expect(checkFreshness("2025-11-15", "2025-12-20").expires_on).toBe("2026-01-01");
  });
  it("expires_on(2026-01-02) -> 2026-04-02", () => {
    expect(checkFreshness("2026-01-02", "2026-03-15").expires_on).toBe("2026-04-02");
  });
});
