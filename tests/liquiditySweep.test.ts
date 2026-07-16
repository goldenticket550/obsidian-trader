import { describe, it, expect } from "vitest";
import { detectLiquiditySweep } from "@/lib/indicators/liquiditySweep";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { makeCandle, fallingSeries } from "@/lib/fixtures/candles";

describe("detectLiquiditySweep", () => {
  const config = defaultStrategyConfig.liquiditySweep;

  it("detects a sweep below an established floor, reclaimed on a later candle", () => {
    // Candles 0-4 establish a floor around $99.8-100 (low point at candle 1).
    const candles = [
      makeCandle({ time: 0, open: 100, high: 100.3, low: 99.9, close: 100.1 }),
      makeCandle({ time: 300, open: 100.1, high: 100.4, low: 99.8, close: 100.2 }),
      makeCandle({ time: 600, open: 100.2, high: 100.5, low: 100.0, close: 100.3 }),
      makeCandle({ time: 900, open: 100.3, high: 100.6, low: 100.1, close: 100.4 }),
      makeCandle({ time: 1200, open: 100.4, high: 100.6, low: 100.2, close: 100.5 }),
      // Sweep candle: dives well below the 99.8 floor, closes still below it.
      makeCandle({ time: 1500, open: 100.5, high: 100.6, low: 97.0, close: 98.0 }),
      // Reclaim candle: closes back above the floor.
      makeCandle({ time: 1800, open: 98.0, high: 101, low: 97.8, close: 100.5 }),
    ];
    const sessionLow = Math.min(...candles.map((c) => c.low));
    const result = detectLiquiditySweep(candles, sessionLow, config);
    expect(result.passed).toBe(true);
    expect(result.experimental).toBe(true);
  });

  it("does not detect a sweep on a strictly monotonic decline (nothing ever reclaims a prior level)", () => {
    // Every candle makes a new low and a new low close, so no later close
    // can ever exceed an earlier (higher) established level.
    const candles = fallingSeries(10, 110, 1);
    const sessionLow = Math.min(...candles.map((c) => c.low));
    const result = detectLiquiditySweep(candles, sessionLow, config);
    expect(result.passed).toBe(false);
  });

  it("returns false with too few candles", () => {
    const candles = [makeCandle({ time: 0 })];
    const result = detectLiquiditySweep(candles, 99, config);
    expect(result.passed).toBe(false);
  });
});
