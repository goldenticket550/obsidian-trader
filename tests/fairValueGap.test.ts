import { describe, it, expect } from "vitest";
import {
  detectBullishFairValueGaps,
  trackGapFillStatus,
  checkGapProximity,
} from "@/lib/indicators/fairValueGap";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { makeCandle } from "@/lib/fixtures/candles";

describe("detectBullishFairValueGaps", () => {
  const config = defaultStrategyConfig.fairValueGap;

  it("detects a gap when candle 3's low is above candle 1's high", () => {
    const candles = [
      makeCandle({ time: 0, high: 100, low: 98 }), // candle 1
      makeCandle({ time: 300, high: 103, low: 100.5 }), // candle 2
      makeCandle({ time: 600, high: 105, low: 101 }), // candle 3, low (101) > candle1 high (100)
    ];
    const gaps = detectBullishFairValueGaps(candles, config);
    expect(gaps.length).toBe(1);
    expect(gaps[0].lower).toBe(100);
    expect(gaps[0].upper).toBe(101);
  });

  it("does not detect a gap when candle 3's low overlaps candle 1's high", () => {
    const candles = [
      makeCandle({ time: 0, high: 100, low: 98 }),
      makeCandle({ time: 300, high: 101, low: 99 }),
      makeCandle({ time: 600, high: 102, low: 99.5 }), // overlaps
    ];
    const gaps = detectBullishFairValueGaps(candles, config);
    expect(gaps.length).toBe(0);
  });

  it("filters out gaps smaller than the configured minimum", () => {
    const strictConfig = { ...config, minGapSizeDollars: 5, minGapSizePct: 1 };
    const candles = [
      makeCandle({ time: 0, high: 100, low: 98 }),
      makeCandle({ time: 300, high: 103, low: 100.5 }),
      makeCandle({ time: 600, high: 105, low: 100.5 }), // tiny gap
    ];
    const gaps = detectBullishFairValueGaps(candles, strictConfig);
    expect(gaps.length).toBe(0);
  });
});

describe("trackGapFillStatus", () => {
  const baseGap = {
    upper: 101,
    lower: 100,
    createdAt: 600,
    candle1Time: 0,
    candle3Time: 600,
    status: "open" as const,
  };

  it("stays open when price never touches the gap", () => {
    const after = [makeCandle({ time: 900, high: 106, low: 103 })];
    const result = trackGapFillStatus(baseGap, after);
    expect(result.status).toBe("open");
  });

  it("becomes partially_filled when price enters but doesn't fully fill", () => {
    const after = [makeCandle({ time: 900, high: 102, low: 100.5 })];
    const result = trackGapFillStatus(baseGap, after);
    expect(result.status).toBe("partially_filled");
  });

  it("becomes fully_filled when price trades through the whole gap", () => {
    const after = [makeCandle({ time: 900, high: 102, low: 99.5 })];
    const result = trackGapFillStatus(baseGap, after);
    expect(result.status).toBe("fully_filled");
  });

  it("becomes invalidated when price closes below the gap after filling", () => {
    const after = [
      makeCandle({ time: 900, high: 102, low: 99.5, close: 100.2 }),
      makeCandle({ time: 1200, high: 100, low: 98, close: 98.5 }), // closes below lower
    ];
    const result = trackGapFillStatus(baseGap, after);
    expect(result.status).toBe("invalidated");
  });
});

describe("checkGapProximity", () => {
  const gap = {
    upper: 101,
    lower: 100,
    createdAt: 600,
    candle1Time: 0,
    candle3Time: 600,
    status: "open" as const,
  };
  const config = defaultStrategyConfig.gapProximity;

  it("flags entersGap when price is inside the gap", () => {
    const result = checkGapProximity(gap, 100.5, config);
    expect(result.entersGap).toBe(true);
    expect(result.fullyFills).toBe(false);
  });

  it("flags fullyFills when price is at or below the lower boundary", () => {
    const result = checkGapProximity(gap, 99.9, config);
    expect(result.fullyFills).toBe(true);
  });

  it("flags touchesUpper when price hits the upper boundary", () => {
    const result = checkGapProximity(gap, 101, config);
    expect(result.touchesUpper).toBe(true);
  });
});
