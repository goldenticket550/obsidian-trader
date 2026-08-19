import { describe, expect, it } from "vitest";
import {
  exchangeAlertEmissionCloseAt,
  exchangeCalendarDay,
  exchangeRegularCloseAt,
  exchangeSessionForTimestamp,
  nextExchangeOpen,
  tradingSessionsSince,
} from "@/lib/attention/exchangeCalendar";

describe("NYSE exchange calendar", () => {
  it("closes for observed Independence Day instead of treating every weekday as open", () => {
    expect(exchangeCalendarDay("2026-07-03")).toMatchObject({ kind: "holiday", isTradingDay: false, reason: "Independence Day" });
    expect(exchangeSessionForTimestamp(new Date("2026-07-03T14:00:00Z"))).toBe("closed");
  });

  it("supports the official 13:00 ET early close and 17:00 late-session close", () => {
    expect(exchangeRegularCloseAt("2026-11-27").toISOString()).toBe("2026-11-27T18:00:00.000Z");
    expect(exchangeAlertEmissionCloseAt("2026-11-27").toISOString()).toBe("2026-11-27T18:00:00.000Z");
    expect(exchangeAlertEmissionCloseAt("2026-11-30").toISOString()).toBe("2026-12-01T01:00:00.000Z");
    expect(exchangeCalendarDay("2026-11-27")).toMatchObject({ kind: "early_close", regularCloseMinutes: 13 * 60, afterHoursCloseMinutes: 17 * 60 });
    expect(exchangeSessionForTimestamp(new Date("2026-11-27T17:59:00Z"))).toBe("regular");
    expect(exchangeSessionForTimestamp(new Date("2026-11-27T18:01:00Z"))).toBe("after-hours");
    expect(exchangeSessionForTimestamp(new Date("2026-11-27T22:01:00Z"))).toBe("closed");
  });

  it("computes next open across the spring DST boundary", () => {
    expect(nextExchangeOpen(new Date("2026-03-07T15:00:00Z")).toISOString()).toBe("2026-03-09T13:30:00.000Z");
  });

  it("counts exchange sessions rather than weekdays for listing history", () => {
    // July 3 holiday and July 4-5 weekend; only July 6 and 7 count.
    expect(tradingSessionsSince("2026-07-03", "2026-07-07")).toBe(2);
  });

  it("memoizes immutable calendar days for repeated per-bar lookups", () => {
    expect(exchangeCalendarDay("2026-07-07")).toBe(exchangeCalendarDay("2026-07-07"));
    expect(Object.isFrozen(exchangeCalendarDay("2026-07-07"))).toBe(true);
  });
});
