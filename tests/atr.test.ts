import { describe, it, expect } from "vitest";
import { calculateAtr, trueRange } from "@/lib/indicators/atr";
import { makeCandle, flatSeries } from "@/lib/fixtures/candles";

describe("trueRange", () => {
  it("uses the candle's own high-low range when there's no prior close", () => {
    const candle = makeCandle({ time: 0, high: 105, low: 100 });
    expect(trueRange(candle, null)).toBe(5);
  });

  it("accounts for a gap up from the prior close", () => {
    const candle = makeCandle({ time: 300, high: 112, low: 108 });
    // Gap: prior close 100, candle range 108-112. True range should
    // include the gap: max(112-108, |112-100|, |108-100|) = max(4,12,8) = 12
    expect(trueRange(candle, 100)).toBe(12);
  });

  it("accounts for a gap down from the prior close", () => {
    const candle = makeCandle({ time: 300, high: 92, low: 88 });
    // prior close 100: max(92-88, |92-100|, |88-100|) = max(4,8,12) = 12
    expect(trueRange(candle, 100)).toBe(12);
  });
});

describe("calculateAtr", () => {
  it("returns NaN before enough candles exist", () => {
    const candles = flatSeries(5, 100);
    const atr = calculateAtr(candles, 14);
    expect(atr.every((v) => Number.isNaN(v))).toBe(true);
  });

  it("computes a positive ATR for a series with real range", () => {
    const candles = Array.from({ length: 20 }, (_, i) =>
      makeCandle({ time: i * 300, high: 101 + i, low: 99 + i, close: 100 + i })
    );
    const atr = calculateAtr(candles, 14);
    const lastValid = atr[atr.length - 1];
    expect(lastValid).toBeGreaterThan(0);
  });

  it("returns near-zero ATR for a perfectly flat series", () => {
    const candles = flatSeries(20, 100);
    const atr = calculateAtr(candles, 14);
    const lastValid = atr[atr.length - 1];
    expect(lastValid).toBeLessThan(1);
  });
});
