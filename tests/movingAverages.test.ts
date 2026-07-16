import { describe, it, expect } from "vitest";
import { calculateEma, calculateSma, latestValid } from "@/lib/indicators/movingAverages";
import { flatSeries, risingSeries } from "@/lib/fixtures/candles";

describe("calculateEma", () => {
  it("returns NaN-padded array shorter than the period", () => {
    const candles = flatSeries(5);
    const ema = calculateEma(candles, 9);
    expect(ema.every((v) => Number.isNaN(v))).toBe(true);
  });

  it("seeds the first value from an SMA and tracks price after that", () => {
    const candles = flatSeries(9, 100);
    const ema = calculateEma(candles, 9);
    expect(ema[8]).toBeCloseTo(100, 5);
  });

  it("rises when price rises", () => {
    const candles = risingSeries(20, 100, 1);
    const ema = calculateEma(candles, 9);
    const last = latestValid(ema)!;
    const midPoint = ema[10];
    expect(last).toBeGreaterThan(midPoint);
  });
});

describe("calculateSma", () => {
  it("computes a plain moving average", () => {
    const candles = flatSeries(20, 50);
    const sma = calculateSma(candles, 20);
    expect(sma[19]).toBeCloseTo(50, 5);
  });

  it("returns null latestValid when too few candles", () => {
    const candles = flatSeries(5);
    const sma = calculateSma(candles, 20);
    expect(latestValid(sma)).toBeNull();
  });
});
