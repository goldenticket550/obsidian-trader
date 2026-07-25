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

  // Regression tests for a real bug (Codex review): the detector used to
  // return passed:true using a STALE historical crossing even after price
  // had since closed back below VWAP, with stale price/VWAP values to
  // match. These tests specifically prove the "currently held" semantics.

  it("passes when a genuine reclaim is still being held on the latest candle", () => {
    const candles = [
      makeCandle({ time: 0, open: 105, high: 106, low: 104, close: 105, volume: 5000 }),
      makeCandle({ time: 300, open: 105, high: 105.5, low: 98, close: 99, volume: 5000 }), // dips below
      makeCandle({ time: 600, open: 99, high: 106, low: 98.5, close: 105.5, volume: 5000 }), // reclaims, holds
    ];
    const result = detectVwapReclaim(candles);
    expect(result.passed).toBe(true);
    expect(result.price).toBe(105.5); // the LATEST candle's close, not a stale one
  });

  it("does NOT pass when a genuine reclaim has since failed (price closed back below VWAP)", () => {
    const candles = [
      makeCandle({ time: 0, open: 105, high: 106, low: 104, close: 105, volume: 5000 }),
      makeCandle({ time: 300, open: 105, high: 105.5, low: 98, close: 99, volume: 5000 }), // dips below
      makeCandle({ time: 600, open: 99, high: 106, low: 98.5, close: 105.5, volume: 5000 }), // reclaims
      makeCandle({ time: 900, open: 105.5, high: 105.5, low: 95, close: 96, volume: 5000 }), // fails back below
    ];
    const result = detectVwapReclaim(candles);
    expect(result.passed).toBe(false);
    // Must report the CURRENT (failed) price, not the stale reclaim candle's.
    expect(result.price).toBe(96);
  });

  it("does not pass when price has been above VWAP the whole session with no genuine crossing", () => {
    // Every candle opens and closes above a rising VWAP - no dip-then-
    // reclaim event exists anywhere in this series.
    const candles = [
      makeCandle({ time: 0, open: 200, high: 201, low: 199, close: 200.5, volume: 1000 }),
      makeCandle({ time: 300, open: 200.5, high: 201.5, low: 200, close: 201, volume: 1000 }),
      makeCandle({ time: 600, open: 201, high: 202, low: 200.5, close: 201.5, volume: 1000 }),
    ];
    const result = detectVwapReclaim(candles);
    expect(result.passed).toBe(false);
  });

  it("does not pass when price never reclaims VWAP at all", () => {
    const candles = [
      makeCandle({ time: 0, open: 100, high: 101, low: 99, close: 99.5, volume: 1000 }),
      makeCandle({ time: 300, open: 99.5, high: 100, low: 97, close: 98, volume: 1000 }),
      makeCandle({ time: 600, open: 98, high: 98.5, low: 96, close: 97, volume: 1000 }),
    ];
    const result = detectVwapReclaim(candles);
    expect(result.passed).toBe(false);
  });

  it("always reports the current price and current VWAP, in both passing and non-passing results", () => {
    const passingCandles = [
      makeCandle({ time: 0, open: 105, high: 106, low: 104, close: 105, volume: 5000 }),
      makeCandle({ time: 300, open: 105, high: 105.5, low: 98, close: 99, volume: 5000 }),
      makeCandle({ time: 600, open: 99, high: 106, low: 98.5, close: 105.5, volume: 5000 }),
    ];
    const passingResult = detectVwapReclaim(passingCandles);
    const expectedVwapSeries = calculateVwap(passingCandles);
    expect(passingResult.price).toBe(passingCandles[passingCandles.length - 1].close);
    expect(passingResult.vwapValue).toBeCloseTo(expectedVwapSeries[expectedVwapSeries.length - 1], 5);

    const failingCandles = [
      makeCandle({ time: 0, open: 100, high: 101, low: 99, close: 99.5, volume: 1000 }),
      makeCandle({ time: 300, open: 99.5, high: 100, low: 97, close: 98, volume: 1000 }),
    ];
    const failingResult = detectVwapReclaim(failingCandles);
    const expectedFailingVwapSeries = calculateVwap(failingCandles);
    expect(failingResult.price).toBe(failingCandles[failingCandles.length - 1].close);
    expect(failingResult.vwapValue).toBeCloseTo(
      expectedFailingVwapSeries[expectedFailingVwapSeries.length - 1],
      5
    );
  });
});
