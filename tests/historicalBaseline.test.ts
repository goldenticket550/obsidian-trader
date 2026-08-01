import { describe, it, expect } from "vitest";
import {
  aggregateThroughCutoff,
  barIntervalMinutes,
  clampToPremarketCutoff,
  computeCompletedBarCutoff,
  HistoricalBarCache,
  median,
  splitBaseline,
  DEFAULT_LOOKBACK_SESSIONS,
  MIN_BASELINE_SESSIONS,
} from "@/lib/market-data/historicalBaseline";
import type { CandleSeries, Candle, PaginationStatus } from "@/types/candle";
import type { GetCandlesParams, MarketDataProvider, SessionInfo } from "@/lib/market-data/types";
import { computeSessionInfo } from "@/lib/market-data/session";

/**
 * Stage 2 — the historical bar cache.
 *
 * Every assertion here is ultimately about one claim: a window is an
 * interval on the US Eastern *clock*, so "the identical elapsed interval"
 * means the same thing on every session, including across a DST change
 * and including for a symbol that simply did not trade much that morning.
 */

const PREMARKET_OPEN = 4 * 60; // 4:00 AM ET
const REGULAR_OPEN = 9 * 60 + 30; // 9:30 AM ET

/**
 * Builds an epoch-seconds timestamp for a given US Eastern date and
 * minute-of-day. `utcOffsetHours` is 4 during EDT and 5 during EST —
 * passed explicitly rather than computed, so the DST tests below state
 * which regime they mean instead of depending on the thing under test.
 */
function etTime(date: string, minuteOfDay: number, utcOffsetHours = 4): number {
  const utcMinutes = minuteOfDay + utcOffsetHours * 60;
  const hh = String(Math.floor(utcMinutes / 60)).padStart(2, "0");
  const mm = String(utcMinutes % 60).padStart(2, "0");
  return Math.floor(Date.parse(`${date}T${hh}:${mm}:00Z`) / 1000);
}

interface BarSpec {
  minute: number;
  high?: number;
  low?: number;
  open?: number;
  close?: number;
  volume?: number;
}

function barsFor(date: string, specs: BarSpec[], utcOffsetHours = 4): Candle[] {
  return specs.map((s) => ({
    time: etTime(date, s.minute, utcOffsetHours),
    open: s.open ?? 100,
    high: s.high ?? 101,
    low: s.low ?? 99,
    close: s.close ?? 100,
    volume: s.volume ?? 1000,
  }));
}

/** Evenly spaced bars across [from, to) at `interval` minutes. */
function filledSession(
  date: string,
  from: number,
  to: number,
  interval: number,
  overrides: Omit<BarSpec, "minute"> = {},
  utcOffsetHours = 4
): Candle[] {
  const specs: BarSpec[] = [];
  for (let m = from; m < to; m += interval) specs.push({ minute: m, ...overrides });
  return barsFor(date, specs, utcOffsetHours);
}

const PREMARKET_WINDOW = {
  startMinutes: PREMARKET_OPEN,
  cutoffMinutes: 9 * 60 + 25, // 9:25 AM ET
  intervalMinutes: 5,
};

describe("barIntervalMinutes", () => {
  it("maps each intraday timeframe to its real bar duration", () => {
    expect(barIntervalMinutes("1m")).toBe(1);
    expect(barIntervalMinutes("5m")).toBe(5);
    expect(barIntervalMinutes("15m")).toBe(15);
  });
});

describe("aggregateThroughCutoff — the comparison window itself", () => {
  it("aggregates volume, range, and dollar volume across the window", () => {
    const candles = barsFor("2026-07-13", [
      { minute: 4 * 60, high: 102, low: 98, open: 100, close: 101, volume: 500 },
      { minute: 4 * 60 + 5, high: 105, low: 100, open: 101, close: 104, volume: 1500 },
      { minute: 4 * 60 + 10, high: 104, low: 97, open: 104, close: 99, volume: 1000 },
    ]);

    const { sessions } = aggregateThroughCutoff(candles, {
      ...PREMARKET_WINDOW,
      // Only 3 bars exist, so relax the tail/coverage gates for this
      // arithmetic-focused case; they get their own tests below.
      maxTailGapFraction: 1,
      minCoverage: 0,
    });

    expect(sessions).toHaveLength(1);
    const [today] = sessions;
    expect(today.tradingDate).toBe("2026-07-13");
    expect(today.volume).toBe(3000);
    expect(today.high).toBe(105);
    expect(today.low).toBe(97);
    expect(today.range).toBe(8);
    expect(today.open).toBe(100);
    expect(today.close).toBe(99);
    expect(today.barCount).toBe(3);
    // 101×500 + 104×1500 + 99×1000 = 50,500 + 156,000 + 99,000
    expect(today.dollarVolume).toBe(305_500);
  });

  it("ignores bars before the window opens", () => {
    // 3:55 AM ET is before the 4:00 premarket open and must not count.
    const candles = barsFor("2026-07-13", [
      { minute: 3 * 60 + 55, volume: 999_999 },
      { minute: 4 * 60, volume: 100 },
    ]);

    const { sessions } = aggregateThroughCutoff(candles, {
      ...PREMARKET_WINDOW,
      maxTailGapFraction: 1,
      minCoverage: 0,
    });

    expect(sessions[0].volume).toBe(100);
    expect(sessions[0].barCount).toBe(1);
  });

  it("includes a bar that completes exactly at the cutoff", () => {
    // A 5m bar opening 9:20 closes at 9:25 — complete, so it counts.
    const candles = barsFor("2026-07-13", [{ minute: 9 * 60 + 20, volume: 700 }]);

    const { sessions } = aggregateThroughCutoff(candles, {
      ...PREMARKET_WINDOW,
      maxTailGapFraction: 1,
      minCoverage: 0,
    });

    expect(sessions[0].barCount).toBe(1);
    expect(sessions[0].volume).toBe(700);
  });

  it("excludes a bar that is still forming at the cutoff", () => {
    // A 5m bar opening 9:25 would not close until 9:30. Counting it would
    // compare a partial bar against complete historical ones.
    const candles = barsFor("2026-07-13", [
      { minute: 9 * 60 + 20, volume: 700 },
      { minute: 9 * 60 + 25, volume: 999_999 },
    ]);

    const { sessions } = aggregateThroughCutoff(candles, {
      ...PREMARKET_WINDOW,
      maxTailGapFraction: 1,
      minCoverage: 0,
    });

    expect(sessions[0].barCount).toBe(1);
    expect(sessions[0].volume).toBe(700);
  });

  it("measures the identical elapsed interval on every session, not each session's full premarket", () => {
    // Yesterday traded all the way to 9:25; today has only reached 5:00.
    // The window is what makes them comparable — yesterday must be
    // measured over 4:00-5:00 too, not over its whole morning.
    const yesterday = filledSession("2026-07-13", PREMARKET_OPEN, 9 * 60 + 25, 5, { volume: 100 });
    const today = filledSession("2026-07-14", PREMARKET_OPEN, 5 * 60, 5, { volume: 100 });

    const { sessions } = aggregateThroughCutoff([...yesterday, ...today], {
      startMinutes: PREMARKET_OPEN,
      cutoffMinutes: 5 * 60,
      intervalMinutes: 5,
    });

    expect(sessions).toHaveLength(2);
    // 4:00-5:00 is twelve 5-minute bars on both dates.
    expect(sessions[0].barCount).toBe(12);
    expect(sessions[1].barCount).toBe(12);
    expect(sessions[0].volume).toBe(sessions[1].volume);
  });

  it("returns sessions ascending by trading date regardless of input order", () => {
    const older = filledSession("2026-07-13", PREMARKET_OPEN, 9 * 60 + 25, 5);
    const newer = filledSession("2026-07-15", PREMARKET_OPEN, 9 * 60 + 25, 5);
    const middle = filledSession("2026-07-14", PREMARKET_OPEN, 9 * 60 + 25, 5);

    const { sessions } = aggregateThroughCutoff(
      [...newer, ...older, ...middle],
      PREMARKET_WINDOW
    );

    expect(sessions.map((s) => s.tradingDate)).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ]);
  });

  it("takes the window's open and close chronologically, not by array position", () => {
    // Deliberately reversed input: the 4:00 bar is last in the array.
    const candles = barsFor("2026-07-13", [
      { minute: 4 * 60 + 10, open: 110, close: 111 },
      { minute: 4 * 60 + 5, open: 105, close: 106 },
      { minute: 4 * 60, open: 100, close: 101 },
    ]);

    const { sessions } = aggregateThroughCutoff(candles, {
      ...PREMARKET_WINDOW,
      maxTailGapFraction: 1,
      minCoverage: 0,
    });

    expect(sessions[0].open).toBe(100); // the 4:00 bar's open
    expect(sessions[0].close).toBe(111); // the 4:10 bar's close
    expect(sessions[0].firstBarMinutes).toBe(240);
    expect(sessions[0].lastBarMinutes).toBe(250);
  });

  it("returns nothing for a zero-width or inverted window rather than throwing", () => {
    const candles = filledSession("2026-07-13", PREMARKET_OPEN, 9 * 60, 5);
    expect(
      aggregateThroughCutoff(candles, {
        startMinutes: 500,
        cutoffMinutes: 500,
        intervalMinutes: 5,
      }).sessions
    ).toEqual([]);
    expect(
      aggregateThroughCutoff(candles, {
        startMinutes: 600,
        cutoffMinutes: 500,
        intervalMinutes: 5,
      }).sessions
    ).toEqual([]);
  });

  it("returns nothing for an empty candle array", () => {
    const result = aggregateThroughCutoff([], PREMARKET_WINDOW);
    expect(result.sessions).toEqual([]);
    expect(result.excluded).toEqual([]);
  });

  it("echoes the window back for display and cache keying", () => {
    const { window } = aggregateThroughCutoff([], PREMARKET_WINDOW);
    expect(window).toEqual({
      startMinutes: PREMARKET_OPEN,
      cutoffMinutes: 9 * 60 + 25,
      intervalMinutes: 5,
    });
  });
});

describe("aggregateThroughCutoff — DST", () => {
  it("compares the same Eastern clock window across an EST session and an EDT session", () => {
    // 2026-03-06 is EST (UTC-5); 2026-03-13 is EDT (UTC-4). Both sessions
    // hold identical 4:00-9:25 ET bars. If the window were applied in UTC
    // the two would land an hour apart and the bar counts would differ —
    // which is exactly the bug this test exists to catch.
    const estSession = filledSession("2026-03-06", PREMARKET_OPEN, 9 * 60 + 25, 5, {}, 5);
    const edtSession = filledSession("2026-03-13", PREMARKET_OPEN, 9 * 60 + 25, 5, {}, 4);

    const { sessions } = aggregateThroughCutoff(
      [...estSession, ...edtSession],
      PREMARKET_WINDOW
    );

    expect(sessions).toHaveLength(2);
    expect(sessions[0].barCount).toBe(sessions[1].barCount);
    expect(sessions[0].firstBarMinutes).toBe(PREMARKET_OPEN);
    expect(sessions[1].firstBarMinutes).toBe(PREMARKET_OPEN);
    expect(sessions[0].lastBarMinutes).toBe(sessions[1].lastBarMinutes);
  });
});

describe("aggregateThroughCutoff — session eligibility", () => {
  it("excludes a session whose data stops well before the cutoff", () => {
    // The signature of a truncated/half session or a provider gap: bars
    // end at 6:00 AM but the comparison runs to 9:25.
    const truncated = filledSession("2026-07-13", PREMARKET_OPEN, 6 * 60, 5);
    const complete = filledSession("2026-07-14", PREMARKET_OPEN, 9 * 60 + 25, 5);

    const { sessions, excluded } = aggregateThroughCutoff(
      [...truncated, ...complete],
      PREMARKET_WINDOW
    );

    expect(sessions.map((s) => s.tradingDate)).toEqual(["2026-07-14"]);
    expect(excluded).toEqual([
      { tradingDate: "2026-07-13", reason: "truncated_before_cutoff", barCount: 24 },
    ]);
  });

  it("keeps a session that merely started late — a quiet morning is real data, not a gap", () => {
    // This is the deliberate asymmetry: gating on a late FIRST print would
    // drop every quiet premarket from the baseline, biasing the median
    // upward and making today look less unusual than it actually is.
    const quiet = barsFor("2026-07-13", [
      { minute: 9 * 60 },
      { minute: 9 * 60 + 5 },
      { minute: 9 * 60 + 10 },
      { minute: 9 * 60 + 15 },
      { minute: 9 * 60 + 20 },
    ]);

    const { sessions, excluded } = aggregateThroughCutoff(quiet, PREMARKET_WINDOW);

    expect(sessions.map((s) => s.tradingDate)).toEqual(["2026-07-13"]);
    expect(excluded).toEqual([]);
    expect(sessions[0].firstBarMinutes).toBe(9 * 60);
  });

  it("excludes a session with essentially no data across the whole window", () => {
    // Reaches the cutoff, so not "truncated" — there is just too little
    // of it for a range or volume comparison to mean anything.
    const barelyAnything = barsFor("2026-07-13", [
      { minute: 5 * 60 },
      { minute: 9 * 60 + 20 },
    ]);

    const { sessions, excluded } = aggregateThroughCutoff(barelyAnything, PREMARKET_WINDOW);

    expect(sessions).toEqual([]);
    expect(excluded).toEqual([
      { tradingDate: "2026-07-13", reason: "sparse_coverage", barCount: 2 },
    ]);
  });

  it("excludes a session with bars on the date but none inside the window", () => {
    // Only after-hours prints that day: the date exists, the window is empty.
    const afterHoursOnly = barsFor("2026-07-13", [{ minute: 18 * 60 }, { minute: 19 * 60 }]);

    const { sessions, excluded } = aggregateThroughCutoff(afterHoursOnly, PREMARKET_WINDOW);

    expect(sessions).toEqual([]);
    expect(excluded).toEqual([
      { tradingDate: "2026-07-13", reason: "no_bars_in_window", barCount: 0 },
    ]);
  });

  it("reports coverage honestly rather than implying a full session", () => {
    // 4:00-9:25 holds 65 five-minute bars; this session printed 13.
    const sparse = barsFor(
      "2026-07-13",
      Array.from({ length: 13 }, (_, i) => ({ minute: PREMARKET_OPEN + i * 25 }))
    );

    const { sessions } = aggregateThroughCutoff(sparse, PREMARKET_WINDOW);

    expect(sessions[0].expectedBarCount).toBe(65);
    expect(sessions[0].barCount).toBe(13);
    expect(sessions[0].coverage).toBeCloseTo(0.2, 10);
  });

  it("honors caller-supplied eligibility thresholds", () => {
    const quiet = barsFor("2026-07-13", [
      { minute: 9 * 60 + 10 },
      { minute: 9 * 60 + 15 },
      { minute: 9 * 60 + 20 },
    ]);

    // 3 bars out of 65 expected ≈ 0.046 coverage, just under the 0.05
    // default floor, so the default excludes it...
    expect(aggregateThroughCutoff(quiet, PREMARKET_WINDOW).sessions).toHaveLength(0);
    // ...and a caller who explicitly lowers the floor gets it back.
    expect(
      aggregateThroughCutoff(quiet, { ...PREMARKET_WINDOW, minCoverage: 0 }).sessions
    ).toHaveLength(1);
  });
});

describe("computeCompletedBarCutoff", () => {
  const NOW = new Date(Date.parse("2026-07-13T13:27:00Z")); // 9:27 AM ET

  it("returns the end of the latest bar that has fully completed", () => {
    const candles = barsFor("2026-07-13", [
      { minute: 9 * 60 + 10 },
      { minute: 9 * 60 + 15 },
      { minute: 9 * 60 + 20 }, // completes 9:25, before 9:27
    ]);
    expect(computeCompletedBarCutoff(candles, 5, NOW)).toBe(9 * 60 + 25);
  });

  it("ignores a bar that is still forming right now", () => {
    const candles = barsFor("2026-07-13", [
      { minute: 9 * 60 + 20 }, // completes 9:25 ✓
      { minute: 9 * 60 + 25 }, // would complete 9:30, still forming at 9:27
    ]);
    expect(computeCompletedBarCutoff(candles, 5, NOW)).toBe(9 * 60 + 25);
  });

  it("returns null when no bar has completed yet, rather than falling back to the clock", () => {
    // Substituting the wall-clock minute here would compare an empty
    // window against full historical ones and call today anomalously quiet.
    const candles = barsFor("2026-07-13", [{ minute: 9 * 60 + 25 }]);
    expect(computeCompletedBarCutoff(candles, 5, NOW)).toBeNull();
    expect(computeCompletedBarCutoff([], 5, NOW)).toBeNull();
  });

  it("ignores bars from other dates so a multi-session array cannot pull the cutoff forward", () => {
    const candles = [
      ...barsFor("2026-07-10", [{ minute: 15 * 60 }]), // Friday afternoon
      ...barsFor("2026-07-13", [{ minute: 9 * 60 + 10 }]),
    ];
    expect(computeCompletedBarCutoff(candles, 5, NOW)).toBe(9 * 60 + 15);
  });
});

describe("clampToPremarketCutoff", () => {
  it("never lets a premarket window run past 9:30 AM ET", () => {
    expect(clampToPremarketCutoff(10 * 60 + 15)).toBe(REGULAR_OPEN);
    expect(clampToPremarketCutoff(9 * 60 + 25)).toBe(9 * 60 + 25);
    expect(clampToPremarketCutoff(REGULAR_OPEN)).toBe(REGULAR_OPEN);
  });
});

describe("median", () => {
  it("returns the middle value for an odd-length list", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values for an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for an empty list rather than 0, which would read as a real measurement", () => {
    expect(median([])).toBeNull();
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("splitBaseline", () => {
  function aggregationFor(dates: string[]) {
    const candles = dates.flatMap((d) => filledSession(d, PREMARKET_OPEN, 9 * 60 + 25, 5));
    return aggregateThroughCutoff(candles, PREMARKET_WINDOW);
  }

  const TWELVE_DATES = [
    "2026-07-01", "2026-07-02", "2026-07-06", "2026-07-07",
    "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-13",
    "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
  ];

  it("separates today from every strictly-earlier session", () => {
    const split = splitBaseline(aggregationFor(TWELVE_DATES), "2026-07-17");
    expect(split.today?.tradingDate).toBe("2026-07-17");
    expect(split.baselineSampleSize).toBe(11);
    expect(split.baseline.every((s) => s.tradingDate < "2026-07-17")).toBe(true);
    expect(split.insufficientData).toBe(false);
  });

  it("never counts today as part of its own baseline", () => {
    const split = splitBaseline(aggregationFor(TWELVE_DATES), "2026-07-17");
    expect(split.baseline.some((s) => s.tradingDate === "2026-07-17")).toBe(false);
  });

  it("reports insufficientData below the 10-session floor", () => {
    const split = splitBaseline(aggregationFor(TWELVE_DATES.slice(-5)), "2026-07-17");
    expect(split.baselineSampleSize).toBe(4);
    expect(split.insufficientData).toBe(true);
  });

  it("is satisfied at exactly the floor, not one above it", () => {
    // 11 dates → today plus a 10-session baseline, exactly MIN_BASELINE_SESSIONS.
    const split = splitBaseline(aggregationFor(TWELVE_DATES.slice(1)), "2026-07-17");
    expect(split.baselineSampleSize).toBe(MIN_BASELINE_SESSIONS);
    expect(split.insufficientData).toBe(false);
  });

  it("caps the baseline at lookbackSessions, keeping the most recent ones", () => {
    const split = splitBaseline(aggregationFor(TWELVE_DATES), "2026-07-17", 3);
    expect(split.baseline.map((s) => s.tradingDate)).toEqual([
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
    ]);
  });

  it("reports today as null when today has no eligible window yet", () => {
    const split = splitBaseline(aggregationFor(TWELVE_DATES), "2026-07-20");
    expect(split.today).toBeNull();
    expect(split.baselineSampleSize).toBe(12);
  });

  it("carries excluded sessions through for honest sample-size reporting", () => {
    const good = TWELVE_DATES.flatMap((d) => filledSession(d, PREMARKET_OPEN, 9 * 60 + 25, 5));
    const truncated = filledSession("2026-07-20", PREMARKET_OPEN, 6 * 60, 5);
    const split = splitBaseline(
      aggregateThroughCutoff([...good, ...truncated], PREMARKET_WINDOW),
      "2026-07-21"
    );
    expect(split.excluded).toEqual([
      { tradingDate: "2026-07-20", reason: "truncated_before_cutoff", barCount: 24 },
    ]);
  });

  it("defaults to the documented lookback and floor", () => {
    expect(DEFAULT_LOOKBACK_SESSIONS).toBe(20);
    expect(MIN_BASELINE_SESSIONS).toBe(10);
  });
});

/** Counts provider round-trips so the cache's whole reason for existing is testable. */
class CountingProvider implements MarketDataProvider {
  name = "counting";
  calls: GetCandlesParams[] = [];
  /** Overridable per test: pagination status, thrown errors, empty responses. */
  pagination: PaginationStatus | undefined = COMPLETE_PAGINATION;
  failWith: Error | null = null;

  constructor(private candlesBySymbol: Record<string, Candle[]>) {}

  setCandles(candlesBySymbol: Record<string, Candle[]>): void {
    this.candlesBySymbol = candlesBySymbol;
  }

  async getCandles(params: GetCandlesParams): Promise<CandleSeries> {
    this.calls.push(params);
    if (this.failWith) throw this.failWith;
    return {
      symbol: params.symbol,
      timeframe: params.timeframe,
      quality: "simulated",
      candles: this.candlesBySymbol[params.symbol] ?? [],
      pagination: this.pagination,
    };
  }

  async getSessionInfo(): Promise<SessionInfo> {
    return computeSessionInfo();
  }
}

const COMPLETE_PAGINATION: PaginationStatus = {
  complete: true,
  pagesFetched: 1,
  nextPageTokenRemaining: false,
  truncationReason: null,
};

const TRUNCATED_PAGINATION: PaginationStatus = {
  complete: false,
  pagesFetched: 4,
  nextPageTokenRemaining: true,
  truncationReason: "page_cap_reached",
};

describe("HistoricalBarCache", () => {
  const DATES = ["2026-07-13", "2026-07-14", "2026-07-15"];
  const bars = DATES.flatMap((d) => filledSession(d, PREMARKET_OPEN, 9 * 60 + 25, 5));

  function makeCache() {
    const provider = new CountingProvider({ AAPL: bars, MSFT: bars });
    return { provider, cache: new HistoricalBarCache(provider) };
  }

  it("fetches raw bars once and serves every later request from cache", async () => {
    const { provider, cache } = makeCache();
    await cache.getBars({ symbol: "AAPL", timeframe: "5m" });
    await cache.getBars({ symbol: "AAPL", timeframe: "5m" });
    await cache.getBars({ symbol: "AAPL", timeframe: "5m" });
    expect(provider.calls).toHaveLength(1);
  });

  it("asks the provider for multiple sessions, not a single collapsed one", async () => {
    const { provider, cache } = makeCache();
    await cache.getBars({ symbol: "AAPL", timeframe: "5m", sessionCount: 21 });
    expect(provider.calls[0].sessionCount).toBe(21);
    // Premarket baselines are meaningless under the default "regular" scope.
    expect(provider.calls[0].sessionScope).toBe("extended");
    // The bar budget must cover every requested session, not just one.
    expect(provider.calls[0].limit).toBeGreaterThanOrEqual(21 * (16 * 60) / 5);
  });

  it("keeps separate entries per symbol", async () => {
    const { provider, cache } = makeCache();
    await cache.getBars({ symbol: "AAPL", timeframe: "5m" });
    await cache.getBars({ symbol: "MSFT", timeframe: "5m" });
    await cache.getBars({ symbol: "AAPL", timeframe: "5m" });
    expect(provider.calls.map((c) => c.symbol)).toEqual(["AAPL", "MSFT"]);
  });

  it("keeps separate entries per session scope, so a premarket request cannot be served regular-hours bars", async () => {
    const { provider, cache } = makeCache();
    await cache.getBars({ symbol: "AAPL", timeframe: "5m", sessionScope: "extended" });
    await cache.getBars({ symbol: "AAPL", timeframe: "5m", sessionScope: "regular" });
    expect(provider.calls).toHaveLength(2);
  });

  it("does NOT refetch raw bars when only the cutoff advances", async () => {
    // The core efficiency claim. Historical bars are identical either way,
    // so keying the fetch on the cutoff would re-pull thousands of bars
    // every single bar interval for no new information.
    const { provider, cache } = makeCache();
    const request = { symbol: "AAPL" as const, timeframe: "5m" as const };

    const first = await cache.getAggregation(request, {
      ...PREMARKET_WINDOW,
      cutoffMinutes: 9 * 60 + 20,
    });
    const second = await cache.getAggregation(request, {
      ...PREMARKET_WINDOW,
      cutoffMinutes: 9 * 60 + 25,
    });

    expect(provider.calls).toHaveLength(1);
    // Different cutoffs really did produce different aggregations — this
    // is not passing because both returned a stale memoized result.
    expect(second.sessions[0].barCount).toBeGreaterThan(first.sessions[0].barCount);
  });

  it("memoizes the aggregation itself for a repeated cutoff", async () => {
    const { cache } = makeCache();
    const request = { symbol: "AAPL" as const, timeframe: "5m" as const };
    const first = await cache.getAggregation(request, PREMARKET_WINDOW);
    const second = await cache.getAggregation(request, PREMARKET_WINDOW);
    // Same object identity proves it was not recomputed across 20 sessions.
    expect(second).toBe(first);
  });

  it("clears both layers", async () => {
    const { provider, cache } = makeCache();
    await cache.getAggregation({ symbol: "AAPL", timeframe: "5m" }, PREMARKET_WINDOW);
    expect(cache.sizes()).toEqual({ bars: 1, aggregates: 1 });

    cache.clear();
    expect(cache.sizes()).toEqual({ bars: 0, aggregates: 0 });

    await cache.getAggregation({ symbol: "AAPL", timeframe: "5m" }, PREMARKET_WINDOW);
    expect(provider.calls).toHaveLength(2);
  });

  it("aggregates the cached bars into one entry per session", async () => {
    const { cache } = makeCache();
    const result = await cache.getAggregation(
      { symbol: "AAPL", timeframe: "5m" },
      PREMARKET_WINDOW
    );
    expect(result.sessions.map((s) => s.tradingDate)).toEqual(DATES);
  });
});

describe("HistoricalBarCache — provider feed isolation", () => {
  const bars = ["2026-07-13", "2026-07-14"].flatMap((d) =>
    filledSession(d, PREMARKET_OPEN, 9 * 60 + 25, 5)
  );

  it("never serves an IEX entry to a SIP request", async () => {
    // IEX and SIP return materially different premarket coverage for the
    // same symbol and session; a baseline mixing them measures the feed
    // rather than the stock.
    const provider = new CountingProvider({ AAPL: bars });
    const cache = new HistoricalBarCache(provider);

    await cache.getBars({ symbol: "AAPL", timeframe: "5m", feed: "iex" });
    await cache.getBars({ symbol: "AAPL", timeframe: "5m", feed: "sip" });
    expect(provider.calls).toHaveLength(2);

    // ...and each feed's own entry is still cached.
    await cache.getBars({ symbol: "AAPL", timeframe: "5m", feed: "iex" });
    await cache.getBars({ symbol: "AAPL", timeframe: "5m", feed: "sip" });
    expect(provider.calls).toHaveLength(2);
  });

  it("keeps aggregations separated by feed too", async () => {
    const provider = new CountingProvider({ AAPL: bars });
    const cache = new HistoricalBarCache(provider);
    await cache.getAggregation({ symbol: "AAPL", timeframe: "5m", feed: "iex" }, PREMARKET_WINDOW);
    await cache.getAggregation({ symbol: "AAPL", timeframe: "5m", feed: "sip" }, PREMARKET_WINDOW);
    expect(cache.sizes()).toEqual({ bars: 2, aggregates: 2 });
  });
});

// ---------------------------------------------------------------------------
// Findings 2 and 3 — completeness must survive caching
// ---------------------------------------------------------------------------

describe("HistoricalBarCache — response completeness", () => {
  const DATES = [
    "2026-07-01", "2026-07-02", "2026-07-06", "2026-07-07",
    "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-13",
    "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17",
  ];
  const TODAY = "2026-07-17";
  const bars = DATES.flatMap((d) => filledSession(d, PREMARKET_OPEN, 9 * 60 + 25, 5));

  function makeCache(options: { failureTtlMs?: number; now?: () => number } = {}) {
    const provider = new CountingProvider({ AAPL: bars });
    const cache = new HistoricalBarCache(provider, undefined, options);
    return { provider, cache };
  }

  const request = {
    symbol: "AAPL" as const,
    timeframe: "5m" as const,
    sessionCount: 12,
    todayTradingDate: TODAY,
  };

  it("returns an entry carrying the bars plus what is known about them", async () => {
    const { cache } = makeCache();
    const entry = await cache.getBars(request);

    expect(entry.candles.length).toBeGreaterThan(0);
    expect(entry.complete).toBe(true);
    expect(entry.insufficientData).toBe(false);
    expect(entry.reason).toBeNull();
    expect(entry.pagination).toEqual(COMPLETE_PAGINATION);
    expect(entry.expectedSessionCount).toBe(12);
    expect(entry.actualEligibleSessionCount).toBe(12);
    expect(entry.todayPresent).toBe(true);
    expect(entry.symbol).toBe("AAPL");
    expect(entry.timeframe).toBe("5m");
    expect(entry.sessionScope).toBe("extended");
    expect(entry.adjustment).toBe("raw");
    expect(entry.provider).toBe("counting");
    expect(typeof entry.fetchedAt).toBe("string");
  });

  it("caches a complete entry under the normal TTL", async () => {
    const clock = { t: 0 };
    const { provider, cache } = makeCache({ now: () => clock.t });
    await cache.getBars(request);
    clock.t = 14 * 60_000; // still inside the 15-minute historical TTL
    const again = await cache.getBars(request);
    expect(provider.calls).toHaveLength(1);
    expect(again.complete).toBe(true);
  });

  it("never reports a page-cap truncation as complete", async () => {
    const { provider, cache } = makeCache();
    provider.pagination = TRUNCATED_PAGINATION;
    const entry = await cache.getBars(request);

    expect(entry.complete).toBe(false);
    expect(entry.insufficientData).toBe(true);
    expect(entry.reason).toBe("pagination_truncated");
    expect(entry.pagination.truncationReason).toBe("page_cap_reached");
  });

  it("keeps an incomplete entry only briefly, so it is retried rather than trusted", async () => {
    const clock = { t: 0 };
    const { provider, cache } = makeCache({ failureTtlMs: 30_000, now: () => clock.t });
    provider.pagination = TRUNCATED_PAGINATION;
    await cache.getBars(request);

    // Inside the failure TTL: served from cache, but still not authoritative.
    clock.t = 29_000;
    expect((await cache.getBars(request)).complete).toBe(false);
    expect(provider.calls).toHaveLength(1);

    // Past it, and well inside the normal TTL, it is retried.
    clock.t = 31_000;
    provider.pagination = COMPLETE_PAGINATION;
    expect((await cache.getBars(request)).complete).toBe(true);
    expect(provider.calls).toHaveLength(2);
  });

  it("does not let an empty response occupy the cache under the normal TTL", async () => {
    const clock = { t: 0 };
    const { provider, cache } = makeCache({ failureTtlMs: 30_000, now: () => clock.t });
    provider.setCandles({});
    const empty = await cache.getBars(request);
    expect(empty.candles).toEqual([]);
    expect(empty.complete).toBe(false);
    expect(empty.insufficientData).toBe(true);
    expect(empty.reason).toBe("empty_response");

    clock.t = 31_000;
    provider.setCandles({ AAPL: bars });
    expect((await cache.getBars(request)).complete).toBe(true);
  });

  it("does not cache, or serve, a provider error as data", async () => {
    const { provider, cache } = makeCache();
    provider.failWith = new Error("Alpaca request failed: 500");
    const failed = await cache.getBars(request);

    expect(failed.complete).toBe(false);
    expect(failed.reason).toBe("provider_error");
    expect(failed.candles).toEqual([]);
    expect(cache.sizes().bars).toBe(0);

    provider.failWith = null;
    expect((await cache.getBars(request)).complete).toBe(true);
  });

  it("does not let a later provider error replace a valid complete entry", async () => {
    const clock = { t: 0 };
    const { provider, cache } = makeCache({ now: () => clock.t });
    await cache.getBars(request);
    expect(provider.calls).toHaveLength(1);

    provider.failWith = new Error("Alpaca request failed: 500");
    clock.t = 60_000; // inside the normal TTL
    const entry = await cache.getBars(request);
    expect(entry.complete).toBe(true);
    expect(entry.candles.length).toBeGreaterThan(0);
    expect(provider.calls).toHaveLength(1);
  });

  it("reports today missing rather than calling the window complete without it", async () => {
    // Exactly the shape an oldest-first truncation leaves behind: plenty
    // of sessions, none of them recent.
    const { provider, cache } = makeCache();
    provider.setCandles({
      AAPL: DATES.slice(0, -3).flatMap((d) => filledSession(d, PREMARKET_OPEN, 9 * 60 + 25, 5)),
    });
    const entry = await cache.getBars(request);

    expect(entry.todayExpected).toBe(true);
    expect(entry.todayPresent).toBe(false);
    expect(entry.complete).toBe(false);
    expect(entry.insufficientData).toBe(true);
    expect(entry.reason).toBe("today_session_missing");
  });

  it("reports how many prior sessions were actually reachable", async () => {
    const { provider, cache } = makeCache();
    provider.setCandles({
      AAPL: DATES.slice(-4).flatMap((d) => filledSession(d, PREMARKET_OPEN, 9 * 60 + 25, 5)),
    });
    const entry = await cache.getBars(request);

    expect(entry.expectedSessionCount).toBe(12);
    expect(entry.actualEligibleSessionCount).toBe(4);
    expect(entry.todayPresent).toBe(true);
    expect(entry.insufficientData).toBe(true);
    expect(entry.reason).toBe("insufficient_sessions");
    // Pagination itself was fine — the coverage was not.
    expect(entry.pagination.complete).toBe(true);
  });

  it("does not require today when the caller did not name a trading date", async () => {
    const { cache } = makeCache();
    const entry = await cache.getBars({ symbol: "AAPL", timeframe: "5m", sessionCount: 12 });
    expect(entry.todayExpected).toBe(false);
    expect(entry.complete).toBe(true);
  });

  it("stops a truncated fetch from qualifying a volume or range baseline", async () => {
    const { provider, cache } = makeCache();
    provider.pagination = TRUNCATED_PAGINATION;
    const aggregation = await cache.getAggregation(request, PREMARKET_WINDOW);

    // The aggregation still computes over whatever bars arrived...
    expect(aggregation.sessions.length).toBeGreaterThan(0);
    // ...but it carries the truncation, and the split refuses to qualify.
    expect(aggregation.source?.complete).toBe(false);
    expect(aggregation.source?.reason).toBe("pagination_truncated");

    const split = splitBaseline(aggregation, TODAY);
    expect(split.baselineSampleSize).toBeGreaterThanOrEqual(MIN_BASELINE_SESSIONS);
    expect(split.insufficientData).toBe(true);
    expect(split.sourceIncompleteReason).toBe("pagination_truncated");
  });

  it("still qualifies a baseline from a complete fetch", async () => {
    const { cache } = makeCache();
    const aggregation = await cache.getAggregation(request, PREMARKET_WINDOW);
    const split = splitBaseline(aggregation, TODAY);
    expect(aggregation.source?.complete).toBe(true);
    expect(split.insufficientData).toBe(false);
    expect(split.sourceIncompleteReason).toBeNull();
  });

  it("keeps adjustment modes in separate cache entries", async () => {
    const { provider, cache } = makeCache();
    await cache.getBars({ ...request, adjustment: "raw" });
    await cache.getBars({ ...request, adjustment: "split" });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls.map((c) => c.adjustment)).toEqual(["raw", "split"]);

    // ...and each one is still cached.
    await cache.getBars({ ...request, adjustment: "raw" });
    await cache.getBars({ ...request, adjustment: "split" });
    expect(provider.calls).toHaveLength(2);
  });

  it("keeps aggregations separated by adjustment mode too", async () => {
    const { cache } = makeCache();
    await cache.getAggregation({ ...request, adjustment: "raw" }, PREMARKET_WINDOW);
    await cache.getAggregation({ ...request, adjustment: "split" }, PREMARKET_WINDOW);
    expect(cache.sizes()).toEqual({ bars: 2, aggregates: 2 });
  });

  it("reuses one complete raw-bar fetch across every advancing cutoff", async () => {
    const { provider, cache } = makeCache();
    for (const cutoff of [9 * 60 + 5, 9 * 60 + 10, 9 * 60 + 15, 9 * 60 + 20, 9 * 60 + 25]) {
      await cache.getAggregation(request, { ...PREMARKET_WINDOW, cutoffMinutes: cutoff });
    }
    expect(provider.calls).toHaveLength(1);
  });
});
