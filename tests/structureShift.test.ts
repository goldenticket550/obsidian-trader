import { describe, it, expect } from "vitest";
import { detectStructureShift } from "@/lib/indicators/structureShift";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { makeCandle } from "@/lib/fixtures/candles";

/**
 * Builds a series with a clearly confirmed swing high at index 3 (needs 3
 * candles of lower highs on both sides for pivotLength: 3), followed by a
 * sweep candle at index 7, then either a break above the swing high or not.
 */
function buildSeries(breakHigher: boolean) {
  const highs = [100, 102, 104, 110, 105, 102, 100, 98];
  const lows = [98, 99, 100, 103, 99, 97, 95, 93];
  const candles = highs.map((high, i) =>
    makeCandle({ time: i * 300, high, low: lows[i] })
  );

  candles.push(
    makeCandle({ time: 2400, open: 93, close: 95, high: 96, low: 92 }),
    makeCandle({ time: 2700, open: 95, close: 98, high: 99, low: 94 }),
    makeCandle({
      time: 3000,
      open: 98,
      close: breakHigher ? 111 : 99,
      high: breakHigher ? 112 : 100,
      low: 97,
    })
  );

  return candles;
}

describe("detectStructureShift", () => {
  const config = defaultStrategyConfig.structureShift;

  it("confirms a shift when price closes above the prior swing high", () => {
    const candles = buildSeries(true);
    const result = detectStructureShift(candles, 7, config);
    expect(result.state).toBe("confirmed");
    expect(result.triggerSwingHigh).toBe(110);
  });

  it("stays waiting when no close breaks the swing high", () => {
    const candles = buildSeries(false);
    const result = detectStructureShift(candles, 7, config);
    expect(result.state).toBe("waiting");
    expect(result.triggerSwingHigh).toBe(110);
  });

  it("returns waiting when sweepIndex is null", () => {
    const candles = Array.from({ length: 10 }, (_, i) => makeCandle({ time: i * 300 }));
    const result = detectStructureShift(candles, null, config);
    expect(result.state).toBe("waiting");
  });
});
