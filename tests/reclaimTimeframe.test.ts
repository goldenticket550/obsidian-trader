import { describe, it, expect } from "vitest";
import {
  buildReclaimTimeframeSeries,
  findRegularSessionStartIndex,
  findPremarketAvailableFromIndex,
  findOpeningRangeAvailableFromIndex,
  RECLAIM_OPENING_RANGE_MINUTES,
} from "@/lib/scanner/reclaimTimeframe";
import { loadCompletedOneMinute } from "@/lib/scanner/oneMinuteHistory";
import { HistoricalBarCache } from "@/lib/market-data/historicalBaseline";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { Candle, CandleSeries } from "@/types/candle";
import type { GetCandlesParams, MarketDataProvider, SessionInfo } from "@/lib/market-data/types";
import { computeSessionInfo } from "@/lib/market-data/session";

/**
 * The shared one-minute boundary and the Reclaim timeframe adapter.
 *
 * The adapter's whole job is to produce indices that line up with the SAME
 * array the runner receives, so the detector's availability checks mean
 * what they say.
 */

const DATE = "2026-07-13";

/** Epoch seconds for an Eastern minute-of-day during EDT (UTC-4). */
function etTime(minuteOfDay: number, date = DATE): number {
  const utcMinutes = minuteOfDay + 4 * 60;
  const hh = String(Math.floor(utcMinutes / 60)).padStart(2, "0");
  const mm = String(utcMinutes % 60).padStart(2, "0");
  return Math.floor(Date.parse(`${date}T${hh}:${mm}:00Z`) / 1000);
}

function barAt(minute: number, price = 100): Candle {
  return {
    time: etTime(minute),
    open: price,
    high: price + 0.2,
    low: price - 0.2,
    close: price,
    volume: 1000,
  };
}

/** Evenly spaced bars across [from, to) at `interval` minutes. */
function seriesFrom(from: number, to: number, interval: number): Candle[] {
  const bars: Candle[] = [];
  for (let m = from; m < to; m += interval) bars.push(barAt(m));
  return bars;
}

const PREMARKET_OPEN = 4 * 60;
const REGULAR_OPEN = 9 * 60 + 30;

// ---------------------------------------------------------------------------
// Adapter — availability indices
// ---------------------------------------------------------------------------

describe("regularSessionStartIndex", () => {
  it("points at the first regular-session bar", () => {
    // 4:00 to 10:00 in 5-minute bars: 66 premarket bars, then 9:30.
    const candles = seriesFrom(PREMARKET_OPEN, 10 * 60, 5);
    const index = findRegularSessionStartIndex(candles);
    expect(index).not.toBeNull();
    expect(candles[index!].time).toBe(etTime(REGULAR_OPEN));
    // Every earlier bar really is premarket.
    expect(index).toBe(66);
  });

  it("finds the same clock boundary on a one-minute series", () => {
    const candles = seriesFrom(REGULAR_OPEN - 10, REGULAR_OPEN + 10, 1);
    const index = findRegularSessionStartIndex(candles);
    expect(candles[index!].time).toBe(etTime(REGULAR_OPEN));
    expect(index).toBe(10);
  });

  it("is null for a premarket-only series", () => {
    // Saying "index 0" here would let premarket bars pose as session
    // structure the moment the runner asked for a session extreme.
    expect(findRegularSessionStartIndex(seriesFrom(PREMARKET_OPEN, REGULAR_OPEN, 5))).toBeNull();
  });

  it("is null for an empty series", () => {
    expect(findRegularSessionStartIndex([])).toBeNull();
  });
});

describe("premarketAvailableFromIndex", () => {
  it("is unavailable while the premarket range is still forming", () => {
    // Before the open the premarket high/low is not yet final.
    expect(findPremarketAvailableFromIndex(seriesFrom(PREMARKET_OPEN, REGULAR_OPEN, 5))).toBeNull();
  });

  it("becomes available at the regular open, when premarket is finalized", () => {
    const candles = seriesFrom(PREMARKET_OPEN, 10 * 60, 5);
    const index = findPremarketAvailableFromIndex(candles);
    expect(candles[index!].time).toBe(etTime(REGULAR_OPEN));
    // It is exactly the session boundary, not an approximation of it.
    expect(index).toBe(findRegularSessionStartIndex(candles));
  });
});

describe("openingRangeAvailableFromIndex", () => {
  it("is null until the required opening-range candles complete", () => {
    // 9:30 through 9:34 only — the five one-minute OR bars exist but the
    // window has not closed, so the level is not yet usable.
    const during = seriesFrom(REGULAR_OPEN, REGULAR_OPEN + RECLAIM_OPENING_RANGE_MINUTES, 1);
    expect(during).toHaveLength(5);
    expect(findOpeningRangeAvailableFromIndex(during)).toBeNull();
  });

  it("becomes available on the first bar at or after 9:35 (one-minute)", () => {
    const candles = seriesFrom(REGULAR_OPEN, REGULAR_OPEN + 10, 1);
    const index = findOpeningRangeAvailableFromIndex(candles);
    expect(candles[index!].time).toBe(etTime(REGULAR_OPEN + RECLAIM_OPENING_RANGE_MINUTES));
    // The sixth bar: 9:30, 9:31, 9:32, 9:33, 9:34, then 9:35.
    expect(index).toBe(5);
  });

  it("uses the same clock boundary on a five-minute series", () => {
    const candles = seriesFrom(REGULAR_OPEN, REGULAR_OPEN + 30, 5);
    const index = findOpeningRangeAvailableFromIndex(candles);
    // The 9:30 bar covers the whole window; the 9:35 bar proves it closed.
    expect(candles[index!].time).toBe(etTime(REGULAR_OPEN + 5));
    expect(index).toBe(1);
  });

  it("is null for a premarket-only series", () => {
    expect(
      findOpeningRangeAvailableFromIndex(seriesFrom(PREMARKET_OPEN, REGULAR_OPEN, 5))
    ).toBeNull();
  });
});

describe("buildReclaimTimeframeSeries", () => {
  it("returns indices that are real positions in the SAME array", () => {
    const candles = seriesFrom(PREMARKET_OPEN, 10 * 60, 5);
    const series = buildReclaimTimeframeSeries(candles);

    expect(series.candles).toBe(candles);
    for (const index of [
      series.regularSessionStartIndex,
      series.premarketAvailableFromIndex,
      series.openingRangeAvailableFromIndex,
    ]) {
      expect(index).not.toBeNull();
      expect(Number.isInteger(index!)).toBe(true);
      expect(index!).toBeGreaterThanOrEqual(0);
      expect(index!).toBeLessThan(candles.length);
    }
  });

  it("orders the boundaries: session open, then opening range", () => {
    const series = buildReclaimTimeframeSeries(seriesFrom(PREMARKET_OPEN, 10 * 60, 5));
    expect(series.openingRangeAvailableFromIndex!).toBeGreaterThan(
      series.regularSessionStartIndex!
    );
  });

  it("returns nulls where a boundary has not occurred", () => {
    const series = buildReclaimTimeframeSeries(seriesFrom(PREMARKET_OPEN, REGULAR_OPEN, 5));
    expect(series.regularSessionStartIndex).toBeNull();
    expect(series.premarketAvailableFromIndex).toBeNull();
    expect(series.openingRangeAvailableFromIndex).toBeNull();
  });

  it("does not mutate or copy the caller's candles", () => {
    const candles = Object.freeze(seriesFrom(REGULAR_OPEN, REGULAR_OPEN + 30, 5)) as Candle[];
    expect(() => buildReclaimTimeframeSeries(candles)).not.toThrow();
    expect(buildReclaimTimeframeSeries(candles).candles).toBe(candles);
  });

  it("derives identical boundaries for 5m and 1m series of the same session", () => {
    const fiveMinute = buildReclaimTimeframeSeries(seriesFrom(PREMARKET_OPEN, 10 * 60, 5));
    const oneMinute = buildReclaimTimeframeSeries(seriesFrom(PREMARKET_OPEN, 10 * 60, 1));

    const timeOf = (s: ReturnType<typeof buildReclaimTimeframeSeries>, i: number | null) =>
      i === null ? null : s.candles[i].time;

    // Different bar counts, same wall-clock boundaries.
    expect(timeOf(fiveMinute, fiveMinute.regularSessionStartIndex)).toBe(
      timeOf(oneMinute, oneMinute.regularSessionStartIndex)
    );
    expect(timeOf(fiveMinute, fiveMinute.openingRangeAvailableFromIndex)).toBe(
      timeOf(oneMinute, oneMinute.openingRangeAvailableFromIndex)
    );
    expect(fiveMinute.regularSessionStartIndex).not.toBe(oneMinute.regularSessionStartIndex);
  });
});

// ---------------------------------------------------------------------------
// Shared one-minute loader
// ---------------------------------------------------------------------------

/** Counts provider round-trips so "fetches once" is directly observable. */
class CountingProvider implements MarketDataProvider {
  name = "counting";
  calls: GetCandlesParams[] = [];
  constructor(private readonly candles: Candle[]) {}

  feedInfo() {
    return { feed: "test-feed", delayed: false, knownDelayMinutes: null };
  }

  async getCandles(params: GetCandlesParams): Promise<CandleSeries> {
    this.calls.push(params);
    return {
      symbol: params.symbol,
      timeframe: params.timeframe,
      quality: "simulated",
      candles: this.candles,
      pagination: {
        complete: true,
        pagesFetched: 1,
        nextPageTokenRemaining: false,
        truncationReason: null,
      },
    };
  }

  async getSessionInfo(): Promise<SessionInfo> {
    return computeSessionInfo();
  }
}

describe("loadCompletedOneMinute", () => {
  const EXPANSION = defaultStrategyConfig.premarketExpansion;
  const FEED = { feed: "test-feed", delayed: false, knownDelayMinutes: null };
  /** 9:40 ET, so bars through 9:39 have completed. */
  const SCANNED_AT = new Date(etTime(REGULAR_OPEN + 10) * 1000);

  function makeCache(candles: Candle[]) {
    const provider = new CountingProvider(candles);
    return { provider, cache: new HistoricalBarCache(provider) };
  }

  async function load(candles: Candle[], cacheAndProvider = makeCache(candles)) {
    return {
      ...cacheAndProvider,
      result: await loadCompletedOneMinute({
        symbol: "TEST",
        cache: cacheAndProvider.cache,
        scannedAt: SCANNED_AT,
        todayTradingDate: DATE,
        feedInfo: FEED,
        expansionConfig: EXPANSION,
      }),
    };
  }

  it("issues the Expansion request shape, so the cache key is unchanged", async () => {
    const { provider, result } = await load(seriesFrom(REGULAR_OPEN, REGULAR_OPEN + 15, 1));

    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0];
    expect(call.timeframe).toBe("1m");
    expect(call.sessionScope).toBe("extended");
    expect(call.sessionCount).toBe(EXPANSION.lookbackSessions + 1);
    expect(call.adjustment).toBe("raw");
    // The request is returned so a derived aggregation reuses the same key.
    expect(result.request.timeframe).toBe("1m");
    expect(result.request.sessionCount).toBe(EXPANSION.lookbackSessions + 1);
    expect(result.request.feed).toBe("test-feed");
  });

  it("fetches at most once per symbol per cache fill", async () => {
    const candles = seriesFrom(REGULAR_OPEN, REGULAR_OPEN + 15, 1);
    const shared = makeCache(candles);

    await load(candles, shared);
    await load(candles, shared);
    await load(candles, shared);

    // Two later consumers of the same 1m history add no provider load.
    expect(shared.provider.calls).toHaveLength(1);
  });

  it("returns only COMPLETED bars — never the forming one", async () => {
    const candles = seriesFrom(REGULAR_OPEN, REGULAR_OPEN + 15, 1);
    const { result } = await load(candles);

    // Scanned at 9:40: the 9:40 bar has not closed.
    const times = result.completedOneMinuteBars.map((c) => c.time);
    expect(times).toContain(etTime(REGULAR_OPEN + 9));
    expect(times).not.toContain(etTime(REGULAR_OPEN + 10));
    expect(result.evaluationBar!.time).toBe(etTime(REGULAR_OPEN + 9));
  });

  it("reports no blocking reason for a complete history", async () => {
    const { result } = await load(seriesFrom(REGULAR_OPEN, REGULAR_OPEN + 15, 1));
    // A short history is a young symbol, not lost data.
    expect(result.blockingReason).toBeNull();
    expect(result.entry.reason === null || result.entry.reason === "insufficient_sessions").toBe(
      true
    );
  });

  it("surfaces freshness for the one-minute series specifically", async () => {
    const { result } = await load(seriesFrom(REGULAR_OPEN, REGULAR_OPEN + 15, 1));
    expect(result.freshness.status).toBeDefined();
    // Aged from the 1m bar's own close, not the 5m series'.
    expect(result.freshness.latestCompletedBarAt).not.toBeNull();
  });

  it("degrades to no completed bars rather than throwing when the provider fails", async () => {
    const provider = new CountingProvider([]);
    provider.getCandles = async () => {
      throw new Error("provider down");
    };
    const cache = new HistoricalBarCache(provider);

    const result = await loadCompletedOneMinute({
      symbol: "TEST",
      cache,
      scannedAt: SCANNED_AT,
      todayTradingDate: DATE,
      feedInfo: FEED,
      expansionConfig: EXPANSION,
    });

    expect(result.completedOneMinuteBars).toEqual([]);
    expect(result.evaluationBar).toBeNull();
    // Distinguishable from "evaluated and found nothing".
    expect(result.blockingReason).toBe("provider_error");
  });
});
