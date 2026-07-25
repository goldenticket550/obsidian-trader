import { describe, it, expect } from "vitest";
import { filterToLatestSession, findPreviousClose } from "@/lib/market-data/sessionFilter";
import { makeCandle } from "@/lib/fixtures/candles";

// Fixed reference points: 2026-07-13 (Monday) and 2026-07-10 (Friday),
// both during EDT (UTC-4). Times chosen to land clearly within each
// trading day in US Eastern.
const FRIDAY_MORNING = Date.parse("2026-07-10T14:00:00Z"); // 10:00 AM EDT Friday
const FRIDAY_AFTERNOON = Date.parse("2026-07-10T19:00:00Z"); // 3:00 PM EDT Friday
const MONDAY_MORNING = Date.parse("2026-07-13T14:00:00Z"); // 10:00 AM EDT Monday
const MONDAY_MIDDAY = Date.parse("2026-07-13T16:00:00Z"); // 12:00 PM EDT Monday

function secondsFromMs(ms: number): number {
  return Math.floor(ms / 1000);
}

describe("filterToLatestSession", () => {
  it("keeps all candles when they're already from a single session", () => {
    const candles = [
      makeCandle({ time: secondsFromMs(MONDAY_MORNING) }),
      makeCandle({ time: secondsFromMs(MONDAY_MORNING + 300_000) }),
      makeCandle({ time: secondsFromMs(MONDAY_MIDDAY) }),
    ];
    const result = filterToLatestSession(candles);
    expect(result.length).toBe(3);
  });

  it("drops candles from a previous session, keeping only the most recent day", () => {
    // Real bug scenario: a fetch window spans Friday and Monday (a
    // weekend in between), and only the most recent day should remain -
    // exactly the "shortly after Monday's open, not enough bars yet"
    // case that caused session contamination.
    const candles = [
      makeCandle({ time: secondsFromMs(FRIDAY_MORNING), close: 100 }),
      makeCandle({ time: secondsFromMs(FRIDAY_AFTERNOON), close: 101 }),
      makeCandle({ time: secondsFromMs(MONDAY_MORNING), close: 200 }),
      makeCandle({ time: secondsFromMs(MONDAY_MIDDAY), close: 201 }),
    ];
    const result = filterToLatestSession(candles);
    expect(result.length).toBe(2);
    expect(result.every((c) => c.close >= 200)).toBe(true);
  });

  it("returns an empty array unchanged", () => {
    expect(filterToLatestSession([])).toEqual([]);
  });

  it("handles a single candle", () => {
    const candles = [makeCandle({ time: secondsFromMs(MONDAY_MORNING) })];
    expect(filterToLatestSession(candles).length).toBe(1);
  });

  it("correctly identifies the latest session even when candles arrive out of a strict multi-day mix", () => {
    // Three distinct days present - only the latest (Monday) should survive.
    const wednesdayBefore = Date.parse("2026-07-08T14:00:00Z");
    const candles = [
      makeCandle({ time: secondsFromMs(wednesdayBefore), close: 50 }),
      makeCandle({ time: secondsFromMs(FRIDAY_MORNING), close: 100 }),
      makeCandle({ time: secondsFromMs(MONDAY_MORNING), close: 200 }),
      makeCandle({ time: secondsFromMs(MONDAY_MIDDAY), close: 201 }),
    ];
    const result = filterToLatestSession(candles);
    expect(result.length).toBe(2);
    expect(result.every((c) => c.close >= 200)).toBe(true);
  });
});

describe("findPreviousClose", () => {
  it("finds the correct previous close when today's daily bar already exists (last position)", () => {
    const dailyCandles = [
      makeCandle({ time: secondsFromMs(FRIDAY_MORNING), close: 100 }), // Friday
      makeCandle({ time: secondsFromMs(MONDAY_MORNING), close: 200 }), // "today" (Monday)
    ];
    const result = findPreviousClose(dailyCandles, "2026-07-13");
    expect(result).toBe(100); // Friday's close, correctly skipping today's own bar
  });

  it("finds the correct previous close when today's daily bar does NOT exist yet", () => {
    // Real bug scenario: only Friday's bar is present (today's hasn't
    // posted yet) - the old positional logic would have wrongly grabbed
    // a bar from two sessions ago here. This version correctly returns
    // Friday's close regardless of array length.
    const dailyCandles = [
      makeCandle({ time: secondsFromMs(FRIDAY_MORNING), close: 100 }),
    ];
    const result = findPreviousClose(dailyCandles, "2026-07-13");
    expect(result).toBe(100);
  });

  it("returns null when there is no earlier daily candle at all", () => {
    const dailyCandles = [makeCandle({ time: secondsFromMs(MONDAY_MORNING), close: 200 })];
    const result = findPreviousClose(dailyCandles, "2026-07-13");
    expect(result).toBeNull();
  });

  it("returns null for an empty daily series", () => {
    expect(findPreviousClose([], "2026-07-13")).toBeNull();
  });

  it("skips multiple same-day duplicate bars correctly, landing on the true previous session", () => {
    const dailyCandles = [
      makeCandle({ time: secondsFromMs(FRIDAY_MORNING), close: 90 }),
      makeCandle({ time: secondsFromMs(FRIDAY_AFTERNOON), close: 100 }), // still Friday, later bar
      makeCandle({ time: secondsFromMs(MONDAY_MORNING), close: 200 }),
    ];
    const result = findPreviousClose(dailyCandles, "2026-07-13");
    // Should land on the LAST Friday bar (walking backward from the end),
    // not an earlier same-day one.
    expect(result).toBe(100);
  });
});
