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
});
