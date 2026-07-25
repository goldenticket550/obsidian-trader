import { describe, it, expect } from "vitest";
import { calculateVwap, detectVwapReclaim } from "@/lib/indicators/vwap";
import { makeCandle } from "@/lib/fixtures/candles";

describe("calculateVwap", () => {
  it("equals the typical price on the first candle", () => {
    const candles = [makeCandle({ time: 0, high: 102, low: 98, close: 100, volume: 1000 })];
    const vwap = calculateVwap(candles);
    // typical price = (102+98+100)/3 = 100
    expect(vwap[0]).toBeCloseTo(100, 5);
  });

  it("weights toward the candle with higher volume", () => {
    const candles = [
      makeCandle({ time: 0, high: 101, low: 99, close: 100, volume: 100 }), // typical 100
      makeCandle({ time: 300, high: 111, low: 109, close: 110, volume: 10000 }), // typical 110, huge volume
    ];
    const vwap = calculateVwap(candles);
    // Should sit much closer to 110 than a simple average (105) would.
    expect(vwap[1]).toBeGreaterThan(109);
  });

  it("returns one value per candle", () => {
    const candles = Array.from({ length: 5 }, (_, i) => makeCandle({ time: i * 300 }));
    const vwap = calculateVwap(candles);
    expect(vwap.length).toBe(5);
  });

  it("handles zero volume without dividing by zero", () => {
    const candles = [makeCandle({ time: 0, high: 101, low: 99, close: 100, volume: 0 })];
    const vwap = calculateVwap(candles);
    expect(Number.isFinite(vwap[0])).toBe(true);
  });
});

describe("detectVwapReclaim", () => {
  it("detects a reclaim after price closes back above VWAP", () => {
    const candles = [
      makeCandle({ time: 0, open: 105, high: 106, low: 104, close: 105, volume: 5000 }),
      makeCandle({ time: 300, open: 105, high: 105.5, low: 98, close: 99, volume: 5000 }), // dips below vwap
      makeCandle({ time: 600, open: 99, high: 106, low: 98.5, close: 105.5, volume: 5000 }), // reclaims
    ];
    const result = detectVwapReclaim(candles);
    expect(result.passed).toBe(true);
  });

  it("does not detect a reclaim when price never dips below VWAP", () => {
    const candles = [
      makeCandle({ time: 0, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 }),
      makeCandle({ time: 300, open: 100.5, high: 102, low: 100, close: 101.5, volume: 1000 }),
      makeCandle({ time: 600, open: 101.5, high: 103, low: 101, close: 102.5, volume: 1000 }),
    ];
    const result = detectVwapReclaim(candles);
    expect(result.passed).toBe(false);
  });

  it("returns false with fewer than 2 candles", () => {
    const result = detectVwapReclaim([makeCandle({ time: 0 })]);
    expect(result.passed).toBe(false);
  });
});
