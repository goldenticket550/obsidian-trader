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

describe("detectLiquiditySweep — 'no data' must be distinguishable from 'checked and found nothing'", () => {
  const config = defaultStrategyConfig.liquiditySweep;

  it("flags genuinely insufficient data, with nothing observed", () => {
    const result = detectLiquiditySweep([makeCandle({ time: 0 })], 99, config);
    expect(result.insufficientData).toBe(true);
    expect(result.watchedLevel).toBeNull();
    expect(result.breachedWithoutReclaim).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("reports the level it was watching when it scanned and found nothing", () => {
    // Flat-to-rising: price never breaches the floor established at 99.9.
    const candles = [
      makeCandle({ time: 0, open: 100, high: 100.3, low: 99.9, close: 100.1 }),
      makeCandle({ time: 300, open: 100.1, high: 100.5, low: 100.0, close: 100.4 }),
      makeCandle({ time: 600, open: 100.4, high: 100.8, low: 100.3, close: 100.7 }),
    ];
    const result = detectLiquiditySweep(candles, 99.9, config);

    expect(result.passed).toBe(false);
    expect(result.insufficientData).toBe(false);
    expect(result.breachedWithoutReclaim).toBe(false);
    // The running low in force for the final candle: min(99.9, 100.0).
    expect(result.watchedLevel).toBeCloseTo(99.9, 5);
  });

  it("distinguishes 'dipped below but never reclaimed' from 'never breached at all'", () => {
    // Breaches the 99.9 floor and simply keeps closing below it — the
    // setup was attempted and failed, which is not the same as never
    // having been attempted.
    const breached = [
      makeCandle({ time: 0, open: 100, high: 100.3, low: 99.9, close: 100.1 }),
      makeCandle({ time: 300, open: 100.1, high: 100.2, low: 97.0, close: 97.5 }),
      makeCandle({ time: 600, open: 97.5, high: 98.0, low: 96.5, close: 97.0 }),
      makeCandle({ time: 900, open: 97.0, high: 97.5, low: 96.0, close: 96.5 }),
    ];
    const breachedResult = detectLiquiditySweep(breached, 96.0, config);
    expect(breachedResult.passed).toBe(false);
    expect(breachedResult.insufficientData).toBe(false);
    expect(breachedResult.breachedWithoutReclaim).toBe(true);

    const held = [
      makeCandle({ time: 0, open: 100, high: 100.3, low: 99.9, close: 100.1 }),
      makeCandle({ time: 300, open: 100.1, high: 100.5, low: 100.0, close: 100.4 }),
    ];
    const heldResult = detectLiquiditySweep(held, 99.9, config);
    expect(heldResult.breachedWithoutReclaim).toBe(false);

    // The two negative results are genuinely different, not identical zeros.
    expect(breachedResult.breachedWithoutReclaim).not.toBe(heldResult.breachedWithoutReclaim);
  });

  it("leaves a passing sweep unchanged, with insufficientData false", () => {
    const candles = [
      makeCandle({ time: 0, open: 100, high: 100.3, low: 99.9, close: 100.1 }),
      makeCandle({ time: 300, open: 100.1, high: 100.4, low: 99.8, close: 100.2 }),
      makeCandle({ time: 600, open: 100.2, high: 100.5, low: 100.0, close: 100.3 }),
      makeCandle({ time: 900, open: 100.3, high: 100.6, low: 100.1, close: 100.4 }),
      makeCandle({ time: 1200, open: 100.4, high: 100.6, low: 100.2, close: 100.5 }),
      makeCandle({ time: 1500, open: 100.5, high: 100.6, low: 97.0, close: 98.0 }),
      makeCandle({ time: 1800, open: 98.0, high: 101, low: 97.8, close: 100.5 }),
    ];
    const result = detectLiquiditySweep(candles, 97.0, config);
    expect(result.passed).toBe(true);
    expect(result.insufficientData).toBe(false);
    expect(result.sweptLevel).not.toBeNull();
    expect(result.breachedWithoutReclaim).toBe(false);
  });
});
