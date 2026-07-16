import { describe, it, expect } from "vitest";
import { detectEmaReclaim } from "@/lib/indicators/emaReclaim";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { fallingSeries, risingSeries } from "@/lib/fixtures/candles";

describe("detectEmaReclaim", () => {
  const config = defaultStrategyConfig.emaReclaim;

  it("does not pass when there aren't enough candles", () => {
    const candles = risingSeries(3);
    const result = detectEmaReclaim(candles, config);
    expect(result.passed).toBe(false);
  });

  it("detects a reclaim after a decline followed by a strong rally", () => {
    const decline = fallingSeries(12, 110, 1);
    const lastFallClose = decline[decline.length - 1].close;
    const rally = risingSeries(15, lastFallClose, 1, decline.length * 300);
    const candles = [...decline, ...rally];

    const result = detectEmaReclaim(candles, config);
    expect(result.passed).toBe(true);
    expect(result.emaValue).not.toBeNull();
    expect(result.price).not.toBeNull();
  });

  it("does not report a reclaim on a flat-then-declining series", () => {
    const candles = fallingSeries(20, 100, 0.2);
    const result = detectEmaReclaim(candles, config);
    expect(result.passed).toBe(false);
  });

  it("requires follow-through candle when configured", () => {
    const strictConfig = { ...config, requireFollowThroughCandle: true };
    const decline = fallingSeries(12, 110, 1);
    const lastFallClose = decline[decline.length - 1].close;
    const rally = risingSeries(15, lastFallClose, 1, decline.length * 300);
    const candles = [...decline, ...rally];

    const result = detectEmaReclaim(candles, strictConfig);
    // With a strong steady rally, follow-through should still hold.
    expect(result.passed).toBe(true);
  });
});
