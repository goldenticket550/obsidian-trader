import { describe, it, expect } from "vitest";
import { scoreSetup } from "@/lib/strategies/scorer";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { flatSeries, textbookBullishReclaimSeries } from "@/lib/fixtures/candles";

describe("scoreSetup", () => {
  it("returns an empty red result when there are no session candles", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: [],
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    expect(result.status).toBe("red");
    expect(result.score).toBe(0);
    expect(result.conditions.length).toBe(0);
  });

  it("produces one condition entry per rule, including the Strat confirmation", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: flatSeries(30, 100),
      dailyCandles: flatSeries(25, 100),
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    // 10 core conditions + 1 optional Strat confirmation.
    expect(result.conditions.length).toBe(11);
    const ids = result.conditions.map((c) => c.id);
    expect(ids).toContain("daily_sma_confirmation");
    expect(ids).toContain("strat_confirmation");
  });

  it("stays red on a flat, uneventful session (no required conditions pass)", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: flatSeries(30, 100),
      dailyCandles: flatSeries(25, 100),
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    expect(result.status).toBe("red");
  });

  it("passes decline, recovery, and consecutive-bullish on the textbook series", () => {
    const candles = textbookBullishReclaimSeries();
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: candles,
      dailyCandles: flatSeries(25, 95), // price ends above this, daily SMA should pass too
      prevClose: 110,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });

    const byId = Object.fromEntries(result.conditions.map((c) => [c.id, c]));
    expect(byId.intraday_decline.state).toBe("pass");
    expect(byId.recovery_from_low.state).toBe("pass");
    expect(byId.consecutive_bullish.state).toBe("pass");
    // Status should be at least yellow (some but maybe not all required conditions pass).
    expect(["yellow", "green"]).toContain(result.status);
    expect(result.score).toBeGreaterThan(0);
  });

  it("never lets an optional confirmation push status to green on its own", () => {
    // Flat series with no required conditions passing — even if volume or
    // strat happens to fire, status must not become green.
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: flatSeries(30, 100),
      dailyCandles: flatSeries(25, 105), // price below daily SMA, but irrelevant to this check
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    expect(result.status).not.toBe("green");
  });

  // Regression tests for a real bug found against the live Alpaca API:
  // quality was hardcoded to "simulated" regardless of what was passed
  // in, mislabeling real live data as mock in the UI.
  it("passes through 'realtime' quality instead of hardcoding 'simulated'", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: flatSeries(30, 100),
      dailyCandles: flatSeries(25, 100),
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "realtime",
    });
    expect(result.quality).toBe("realtime");
  });

  it("passes through 'delayed' quality on the empty-candles path too", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: [],
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "delayed",
    });
    expect(result.quality).toBe("delayed");
  });

  // Regression tests for a real bug found in production: alerts and the
  // UI had no way to distinguish "just calculated from fresh data" from
  // "calculated right now, but from Friday's closing candle because
  // markets are closed" — both looked identical since only scan time
  // (lastUpdated) was tracked, not the underlying market data's time.
  it("computes latestCandleTime from the most recent session candle, distinct from 'now'", () => {
    const candles = flatSeries(10, 100); // times 0, 300, 600, ... 2700 (seconds)
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: candles,
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-07-19T12:00:00Z", // scan runs "now", far from the candle times
      quality: "simulated",
    });
    const expectedCandleTime = new Date(candles[candles.length - 1].time * 1000).toISOString();
    expect(result.latestCandleTime).toBe(expectedCandleTime);
    expect(result.latestCandleTime).not.toBe(result.lastUpdated);
  });

  it("sets latestCandleTime to null when there are no candles to derive it from", () => {
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: [],
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      now: "2026-01-01T00:00:00Z",
      quality: "simulated",
    });
    expect(result.latestCandleTime).toBeNull();
  });

  // Documentation/regression tests for Finding 2 of the Codex review of
  // e6c5acd: latestCandleTime is the timestamp a candle STARTED (Alpaca bar
  // semantics — a bar covers [time, time + duration)), not an "as of"
  // instant of the latest price. The UI label was renamed from "Market data
  // as of" to "Latest candle started" to reflect this; these tests pin the
  // underlying semantics down so a future change can't silently drift back
  // to implying the timestamp is the bar's close.
  it("for a 5-minute timeframe, latestCandleTime is the candle's open, up to ~5 minutes behind the true edge of the data", () => {
    const barOpen = "2026-07-19T14:35:00Z";
    const barOpenSeconds = Math.floor(new Date(barOpen).getTime() / 1000);
    const candles = flatSeries(3, 100, barOpenSeconds - 2 * 300); // last candle opens at barOpenSeconds
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "5m",
      sessionCandles: candles,
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      // "now" is late in the still-forming bar — up to just under 5 minutes
      // of real price action has happened since latestCandleTime.
      now: "2026-07-19T14:39:59Z",
      quality: "simulated",
    });
    expect(result.latestCandleTime).toBe("2026-07-19T14:35:00.000Z");
  });

  it("for a 15-minute timeframe, latestCandleTime is the candle's open, up to ~15 minutes behind the true edge of the data", () => {
    const barOpen = "2026-07-19T14:15:00Z";
    const barOpenSeconds = Math.floor(new Date(barOpen).getTime() / 1000);
    const candles = flatSeries(3, 100, barOpenSeconds - 2 * 300);
    const result = scoreSetup({
      symbol: "TEST",
      timeframe: "15m",
      sessionCandles: candles,
      dailyCandles: [],
      prevClose: 100,
      config: defaultStrategyConfig,
      // "now" is late in the still-forming 15-minute bar.
      now: "2026-07-19T14:29:59Z",
      quality: "simulated",
    });
    expect(result.latestCandleTime).toBe("2026-07-19T14:15:00.000Z");
  });
});
