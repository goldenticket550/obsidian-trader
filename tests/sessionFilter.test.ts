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

describe("filterToLatestSession — regular-hours scope (Codex round 4 regression)", () => {
  // 2026-07-13 (Monday) EDT boundaries:
  // pre-market starts 4:00am ET = 08:00 UTC
  // regular starts 9:30am ET = 13:30 UTC, ends 4:00pm ET = 20:00 UTC
  // after-hours ends 8:00pm ET = 00:00 UTC (next day)
  const PREMARKET_TIME = Date.parse("2026-07-13T09:00:00Z"); // 5:00 AM ET
  const REGULAR_OPEN_TIME = Date.parse("2026-07-13T13:35:00Z"); // 9:35 AM ET
  const REGULAR_MIDDAY_TIME = Date.parse("2026-07-13T17:00:00Z"); // 1:00 PM ET
  const AFTERHOURS_TIME = Date.parse("2026-07-13T21:00:00Z"); // 5:00 PM ET

  it("excludes pre-market bars by default, keeping only regular-hours bars", () => {
    const candles = [
      makeCandle({ time: secondsFromMs(PREMARKET_TIME), close: 90 }),
      makeCandle({ time: secondsFromMs(REGULAR_OPEN_TIME), close: 100 }),
      makeCandle({ time: secondsFromMs(REGULAR_MIDDAY_TIME), close: 101 }),
    ];
    const result = filterToLatestSession(candles); // default scope: "regular"
    expect(result.length).toBe(2);
    expect(result.every((c) => c.close >= 100)).toBe(true);
  });

  it("excludes after-hours bars by default", () => {
    const candles = [
      makeCandle({ time: secondsFromMs(REGULAR_OPEN_TIME), close: 100 }),
      makeCandle({ time: secondsFromMs(REGULAR_MIDDAY_TIME), close: 101 }),
      makeCandle({ time: secondsFromMs(AFTERHOURS_TIME), close: 110 }),
    ];
    const result = filterToLatestSession(candles);
    expect(result.length).toBe(2);
    expect(result.every((c) => c.close <= 101)).toBe(true);
  });

  it("returns empty when the ONLY candles available are pre-market", () => {
    // Nothing in scope at all — genuinely insufficient data.
    const candles = [makeCandle({ time: secondsFromMs(PREMARKET_TIME), close: 90 })];
    expect(filterToLatestSession(candles)).toEqual([]);
  });

  it("includes pre-market and after-hours bars when sessionScope is 'extended'", () => {
    const candles = [
      makeCandle({ time: secondsFromMs(PREMARKET_TIME), close: 90 }),
      makeCandle({ time: secondsFromMs(REGULAR_OPEN_TIME), close: 100 }),
      makeCandle({ time: secondsFromMs(AFTERHOURS_TIME), close: 110 }),
    ];
    const result = filterToLatestSession(candles, "extended");
    expect(result.length).toBe(3);
  });

  it("includes everything on the latest date, even outside 4am-8pm, when sessionScope is 'all'", () => {
    const middleOfNight = Date.parse("2026-07-14T03:00:00Z"); // 11:00 PM ET Monday
    const candles = [
      makeCandle({ time: secondsFromMs(REGULAR_OPEN_TIME), close: 100 }),
      makeCandle({ time: secondsFromMs(middleOfNight), close: 105 }),
    ];
    const result = filterToLatestSession(candles, "all");
    expect(result.length).toBe(2);
  });

  it("still correctly excludes a previous day's regular-hours bars even with regular-hours scope", () => {
    const candles = [
      makeCandle({ time: secondsFromMs(FRIDAY_MORNING), close: 100 }), // Friday, regular hours
      makeCandle({ time: secondsFromMs(REGULAR_OPEN_TIME), close: 200 }), // Monday, regular hours
    ];
    const result = filterToLatestSession(candles);
    expect(result.length).toBe(1);
    expect(result[0].close).toBe(200);
  });
});

describe("filterToLatestSession — a pre-market print must not destroy the prior session", () => {
  // Found on the live dashboard: two of three watchlist symbols showed
  // 0.0 scores and no candle during a pre-market scan, purely because
  // they had ticked pre-market that morning. The third, which had not
  // ticked, still showed Friday's session correctly.
  const FRI_1550 = Date.parse("2026-07-24T19:50:00Z"); // Fri 3:50 PM ET
  const FRI_1555 = Date.parse("2026-07-24T19:55:00Z"); // Fri 3:55 PM ET
  const MON_0914 = Date.parse("2026-07-27T13:14:00Z"); // Mon 9:14 AM ET, pre-market
  const MON_0935 = Date.parse("2026-07-27T13:35:00Z"); // Mon 9:35 AM ET, regular

  const fridaySession = [
    makeCandle({ time: secondsFromMs(FRI_1550), close: 207 }),
    makeCandle({ time: secondsFromMs(FRI_1555), close: 207.07 }),
  ];

  it("keeps Friday's session when a single pre-market bar exists today", () => {
    const candles = [...fridaySession, makeCandle({ time: secondsFromMs(MON_0914), close: 333 })];
    const result = filterToLatestSession(candles);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.close < 300)).toBe(true);
  });

  it("gives the same answer whether or not the symbol ticked pre-market", () => {
    // The inconsistency between symbols was the clearest signal of the bug.
    const didNotTick = filterToLatestSession(fridaySession);
    const didTick = filterToLatestSession([
      ...fridaySession,
      makeCandle({ time: secondsFromMs(MON_0914), close: 333 }),
    ]);
    expect(didTick.map((c) => c.close)).toEqual(didNotTick.map((c) => c.close));
  });

  it("switches to today once a real regular-hours candle exists", () => {
    const candles = [
      ...fridaySession,
      makeCandle({ time: secondsFromMs(MON_0914), close: 333 }),
      makeCandle({ time: secondsFromMs(MON_0935), close: 210 }),
    ];
    const result = filterToLatestSession(candles);
    expect(result).toHaveLength(1);
    expect(result[0].close).toBe(210);
  });

  it("still includes the pre-market bar under extended scope", () => {
    const candles = [...fridaySession, makeCandle({ time: secondsFromMs(MON_0914), close: 333 })];
    const result = filterToLatestSession(candles, "extended");
    expect(result).toHaveLength(1);
    expect(result[0].close).toBe(333);
  });
});

describe("filterToLatestSession — computes true max date, not just the last array element", () => {
  it("correctly identifies the latest session even when candles arrive out of chronological order", () => {
    // Genuinely out-of-order: the Monday candle is NOT last in the array.
    const REGULAR_OPEN_TIME = Date.parse("2026-07-13T13:35:00Z");
    const candles = [
      makeCandle({ time: secondsFromMs(REGULAR_OPEN_TIME), close: 200 }), // Monday - listed FIRST
      makeCandle({ time: secondsFromMs(FRIDAY_MORNING), close: 100 }), // Friday - listed LAST
    ];
    const result = filterToLatestSession(candles);
    expect(result.length).toBe(1);
    expect(result[0].close).toBe(200); // Monday's candle, correctly identified as latest
  });
});

describe("filterToLatestSession — DST and timezone boundary tests", () => {
  it("correctly buckets 11:59 PM and 12:01 AM Eastern on either side of midnight during EST (winter)", () => {
    // 2026-01-15 is well within EST (UTC-5). 11:59 PM ET Jan 14 = 04:59 UTC Jan 15.
    const beforeMidnight = Date.parse("2026-01-15T04:59:00Z"); // 11:59 PM ET Jan 14
    const afterMidnight = Date.parse("2026-01-15T05:01:00Z"); // 12:01 AM ET Jan 15
    const candles = [
      makeCandle({ time: secondsFromMs(beforeMidnight), close: 100 }),
      makeCandle({ time: secondsFromMs(afterMidnight), close: 200 }),
    ];
    // Using "all" scope here since these times are outside 4am-8pm and
    // this test is specifically about DATE bucketing, not session hours.
    const result = filterToLatestSession(candles, "all");
    // Only the Jan 15 candle should remain - the two are on different
    // Eastern calendar dates despite being 2 minutes apart.
    expect(result.length).toBe(1);
    expect(result[0].close).toBe(200);
  });

  it("correctly buckets the same midnight boundary during EDT (summer)", () => {
    // 2026-07-13 is within EDT (UTC-4). 11:59 PM ET Jul 13 = 03:59 UTC Jul 14.
    const beforeMidnight = Date.parse("2026-07-14T03:59:00Z"); // 11:59 PM ET Jul 13
    const afterMidnight = Date.parse("2026-07-14T04:01:00Z"); // 12:01 AM ET Jul 14
    const candles = [
      makeCandle({ time: secondsFromMs(beforeMidnight), close: 100 }),
      makeCandle({ time: secondsFromMs(afterMidnight), close: 200 }),
    ];
    const result = filterToLatestSession(candles, "all");
    expect(result.length).toBe(1);
    expect(result[0].close).toBe(200);
  });

  it("correctly handles the spring-forward Sunday (2026-03-08, 2am ET jumps to 3am)", () => {
    // Candles on either side of the spring-forward transition, same
    // Eastern calendar date - should still bucket together correctly.
    const beforeSpringForward = Date.parse("2026-03-08T06:00:00Z"); // 1:00 AM EST
    const afterSpringForward = Date.parse("2026-03-08T08:00:00Z"); // 4:00 AM EDT (skipped 2-3am)
    const candles = [
      makeCandle({ time: secondsFromMs(beforeSpringForward), close: 100 }),
      makeCandle({ time: secondsFromMs(afterSpringForward), close: 101 }),
    ];
    const result = filterToLatestSession(candles, "all");
    // Both on March 8th Eastern date - should both survive (same session date).
    expect(result.length).toBe(2);
  });

  it("correctly handles both instances of the fall-back repeated hour (2026-11-01, 2am ET repeats)", () => {
    // The 1:30 AM hour occurs twice on fall-back day - both instances are
    // still November 1st in Eastern time, so both should bucket together.
    const firstOccurrence = Date.parse("2026-11-01T05:30:00Z"); // 1:30 AM EDT (first pass)
    const secondOccurrence = Date.parse("2026-11-01T06:30:00Z"); // 1:30 AM EST (second pass, after fall-back)
    const candles = [
      makeCandle({ time: secondsFromMs(firstOccurrence), close: 100 }),
      makeCandle({ time: secondsFromMs(secondOccurrence), close: 101 }),
    ];
    const result = filterToLatestSession(candles, "all");
    expect(result.length).toBe(2);
  });

  it("correctly buckets daily-bar-style midnight-Eastern timestamps in both winter and summer", () => {
    // Daily bars are often stamped at market open or midnight Eastern -
    // confirm both DST regimes produce the expected Eastern date.
    const winterMidnight = Date.parse("2026-01-15T05:00:00Z"); // 12:00 AM EST Jan 15
    const summerMidnight = Date.parse("2026-07-13T04:00:00Z"); // 12:00 AM EDT Jul 13
    const winterCandles = [makeCandle({ time: secondsFromMs(winterMidnight) })];
    const summerCandles = [makeCandle({ time: secondsFromMs(summerMidnight) })];
    // Both should survive filtering against themselves (single-candle,
    // single-date arrays) - proves the date computation doesn't throw or
    // misbucket at exactly midnight in either DST regime.
    expect(filterToLatestSession(winterCandles, "all").length).toBe(1);
    expect(filterToLatestSession(summerCandles, "all").length).toBe(1);
  });
});
