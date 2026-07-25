import { describe, it, expect } from "vitest";
import { calculateBodyPercent, classifyPressure } from "@/lib/indicators/pressure";
import { computePressureAverageVolume } from "@/lib/strategies/scorer";
import { makeCandle } from "@/lib/fixtures/candles";

describe("calculateBodyPercent", () => {
  it("returns 1.0 for a candle with no wicks", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 105, high: 105, low: 100 });
    expect(calculateBodyPercent(candle)).toBeCloseTo(1.0, 5);
  });

  it("returns a small value for a mostly-wick doji-like candle", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 100.1, high: 105, low: 95 });
    expect(calculateBodyPercent(candle)).toBeLessThan(0.1);
  });

  it("returns 0 for a zero-range candle without dividing by zero", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 100, high: 100, low: 100 });
    expect(calculateBodyPercent(candle)).toBe(0);
  });
});

describe("classifyPressure", () => {
  it("labels strong_buy_pressure for a decisive bullish candle with high relative volume", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 105, high: 105.1, low: 99.9, volume: 3000 });
    const result = classifyPressure(candle, 1000); // 3x average volume
    expect(result.label).toBe("strong_buy_pressure");
  });

  it("labels strong_sell_pressure for a decisive bearish candle with high relative volume", () => {
    const candle = makeCandle({ time: 0, open: 105, close: 100, high: 105.1, low: 99.9, volume: 3000 });
    const result = classifyPressure(candle, 1000);
    expect(result.label).toBe("strong_sell_pressure");
  });

  it("labels neutral when volume is unremarkable, even with a strong body", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 105, high: 105.1, low: 99.9, volume: 900 });
    const result = classifyPressure(candle, 1000); // below average volume
    expect(result.label).toBe("neutral");
  });

  it("labels neutral for an indecisive candle even with huge volume", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 100.1, high: 103, low: 97, volume: 5000 });
    const result = classifyPressure(candle, 1000);
    expect(result.label).toBe("neutral");
  });

  it("never uses institutional-certainty language in the label itself", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 105, high: 105.1, low: 99.9, volume: 3000 });
    const result = classifyPressure(candle, 1000);
    expect(result.label).not.toMatch(/institutional/i);
  });
});

describe("computePressureAverageVolume", () => {
  it("returns 0 when there are no preceding candles", () => {
    const candles = [makeCandle({ time: 0, volume: 1000 })];
    expect(computePressureAverageVolume(candles, 20)).toBe(0);
  });

  it("uses whatever's available when the session is shorter than the lookback", () => {
    // 3 preceding candles, lookback of 20 - should average just those 3,
    // not error or silently return 0.
    const candles = [
      makeCandle({ time: 0, volume: 1000 }),
      makeCandle({ time: 300, volume: 2000 }),
      makeCandle({ time: 600, volume: 3000 }),
      makeCandle({ time: 900, volume: 9999 }), // current candle - must be excluded
    ];
    expect(computePressureAverageVolume(candles, 20)).toBeCloseTo(2000, 5); // (1000+2000+3000)/3
  });

  it("uses exactly the configured lookback window when there's more history than that", () => {
    // 25 preceding candles, lookback 20 - only the most recent 20 of
    // those 25 should count.
    const precedingVolumes = Array.from({ length: 25 }, (_, i) => 1000 + i * 10);
    const candles = precedingVolumes.map((v, i) => makeCandle({ time: i * 300, volume: v }));
    candles.push(makeCandle({ time: 25 * 300, volume: 99999 })); // current candle - excluded

    const result = computePressureAverageVolume(candles, 20);
    const expectedWindow = precedingVolumes.slice(-20); // indices 5..24
    const expectedAvg = expectedWindow.reduce((a, b) => a + b, 0) / expectedWindow.length;
    expect(result).toBeCloseTo(expectedAvg, 5);
  });

  it("proves candles older than the lookback do not affect the result", () => {
    // Two sessions identical for the most recent 20 candles, differing
    // only in ancient history far outside the lookback window - results
    // must be identical.
    const recentVolumes = Array.from({ length: 20 }, () => 1000);
    const sessionA = [
      makeCandle({ time: 0, volume: 50 }), // ancient, outside lookback
      ...recentVolumes.map((v, i) => makeCandle({ time: (i + 1) * 300, volume: v })),
      makeCandle({ time: 21 * 300, volume: 9999 }), // current candle
    ];
    const sessionB = [
      makeCandle({ time: 0, volume: 999999 }), // wildly different ancient history
      ...recentVolumes.map((v, i) => makeCandle({ time: (i + 1) * 300, volume: v })),
      makeCandle({ time: 21 * 300, volume: 9999 }), // current candle
    ];

    expect(computePressureAverageVolume(sessionA, 20)).toBe(computePressureAverageVolume(sessionB, 20));
  });

  it("never includes the current (last) candle in its own average", () => {
    const candles = [
      makeCandle({ time: 0, volume: 1000 }),
      makeCandle({ time: 300, volume: 1000 }),
      makeCandle({ time: 600, volume: 999999 }), // current candle - a huge outlier
    ];
    const result = computePressureAverageVolume(candles, 20);
    expect(result).toBeCloseTo(1000, 5); // must not be dragged toward the outlier
  });
});
