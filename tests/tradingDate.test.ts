import { describe, it, expect } from "vitest";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";

describe("getCurrentTradingDate", () => {
  it("returns the Eastern calendar date for a UTC morning timestamp", () => {
    // 2026-07-13 14:00 UTC = 10:00 AM EDT, still July 13th in ET.
    expect(getCurrentTradingDate(new Date("2026-07-13T14:00:00Z"))).toBe("2026-07-13");
  });

  it("rolls over correctly for a UTC timestamp that's already the next day", () => {
    // 2026-07-14 03:00 UTC = 11:00 PM EDT on July 13th - still the 13th in ET.
    expect(getCurrentTradingDate(new Date("2026-07-14T03:00:00Z"))).toBe("2026-07-13");
  });

  it("is deterministic for the same input", () => {
    const d = new Date("2026-07-13T18:30:00Z");
    expect(getCurrentTradingDate(d)).toBe(getCurrentTradingDate(d));
  });
});
