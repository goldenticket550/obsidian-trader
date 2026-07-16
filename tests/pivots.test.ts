import { describe, it, expect } from "vitest";
import { findPivots, mostRecentPivot } from "@/lib/indicators/pivots";
import { makeCandle } from "@/lib/fixtures/candles";

describe("findPivots", () => {
  it("detects a clean pivot low in a V-shaped series", () => {
    const candles = [
      makeCandle({ time: 0, high: 105, low: 103 }),
      makeCandle({ time: 300, high: 103, low: 101 }),
      makeCandle({ time: 600, high: 101, low: 98 }), // the low point
      makeCandle({ time: 900, high: 103, low: 100 }),
      makeCandle({ time: 1200, high: 105, low: 102 }),
    ];
    const pivots = findPivots(candles, 2);
    const lows = pivots.filter((p) => p.type === "low");
    expect(lows.length).toBe(1);
    expect(lows[0].price).toBe(98);
  });

  it("detects a clean pivot high in an inverted-V series", () => {
    const candles = [
      makeCandle({ time: 0, high: 100, low: 98 }),
      makeCandle({ time: 300, high: 102, low: 100 }),
      makeCandle({ time: 600, high: 108, low: 103 }), // the high point
      makeCandle({ time: 900, high: 102, low: 99 }),
      makeCandle({ time: 1200, high: 100, low: 97 }),
    ];
    const pivots = findPivots(candles, 2);
    const highs = pivots.filter((p) => p.type === "high");
    expect(highs.length).toBe(1);
    expect(highs[0].price).toBe(108);
  });

  it("returns no pivots on a monotonic series", () => {
    const candles = Array.from({ length: 10 }, (_, i) =>
      makeCandle({ time: i * 300, high: 100 + i, low: 98 + i })
    );
    const pivots = findPivots(candles, 2);
    expect(pivots.length).toBe(0);
  });
});

describe("mostRecentPivot", () => {
  it("finds the most recent pivot of a given type before an index", () => {
    const pivots = [
      { index: 2, time: 600, price: 98, type: "low" as const },
      { index: 6, time: 1800, price: 95, type: "low" as const },
      { index: 10, time: 3000, price: 92, type: "low" as const },
    ];
    const result = mostRecentPivot(pivots, "low", 8);
    expect(result?.price).toBe(95);
  });

  it("returns null when no pivot of that type exists", () => {
    const result = mostRecentPivot([], "high");
    expect(result).toBeNull();
  });
});
