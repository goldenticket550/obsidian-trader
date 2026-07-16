import { describe, it, expect } from "vitest";
import { computeSessionInfo } from "@/lib/market-data/session";

// All times below are fixed UTC instants during EDT (UTC-4), verified
// against the known Monday 2026-07-13 / Saturday 2026-07-18 calendar dates.
describe("computeSessionInfo", () => {
  it("identifies regular trading hours", () => {
    // 2026-07-13 14:00 UTC = 10:00 AM ET (Monday)
    const result = computeSessionInfo(new Date("2026-07-13T14:00:00Z"));
    expect(result.session).toBe("regular");
    expect(result.isOpen).toBe(true);
  });

  it("identifies pre-market hours", () => {
    // 2026-07-13 11:00 UTC = 7:00 AM ET (Monday)
    const result = computeSessionInfo(new Date("2026-07-13T11:00:00Z"));
    expect(result.session).toBe("pre-market");
    expect(result.isOpen).toBe(false);
  });

  it("identifies after-hours", () => {
    // 2026-07-13 21:00 UTC = 5:00 PM ET (Monday)
    const result = computeSessionInfo(new Date("2026-07-13T21:00:00Z"));
    expect(result.session).toBe("after-hours");
    expect(result.isOpen).toBe(false);
  });

  it("identifies closed overnight hours", () => {
    // 2026-07-14 03:00 UTC = 11:00 PM ET (still Monday night)
    const result = computeSessionInfo(new Date("2026-07-14T03:00:00Z"));
    expect(result.session).toBe("closed");
    expect(result.isOpen).toBe(false);
  });

  it("identifies weekends as closed regardless of time", () => {
    // 2026-07-18 is a Saturday
    const result = computeSessionInfo(new Date("2026-07-18T14:00:00Z"));
    expect(result.session).toBe("closed");
    expect(result.isOpen).toBe(false);
  });
});
