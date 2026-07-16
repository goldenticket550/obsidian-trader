import { describe, it, expect } from "vitest";
import { detectConsecutiveBullish } from "@/lib/indicators/consecutiveBullish";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { risingSeries, fallingSeries } from "@/lib/fixtures/candles";

describe("detectConsecutiveBullish", () => {
  const config = defaultStrategyConfig.consecutiveBullish;

  it("passes on N consecutive bullish candles with higher highs/lows", () => {
    const candles = risingSeries(5, 100, 1);
    const result = detectConsecutiveBullish(candles, config);
    expect(result.passed).toBe(true);
    expect(result.higherHighsLows).toBe(true);
  });

  it("fails when the most recent candle is bearish", () => {
    const candles = [...risingSeries(4, 100, 1), ...fallingSeries(1, 105, 1, 4 * 300)];
    const result = detectConsecutiveBullish(candles, config);
    expect(result.passed).toBe(false);
  });

  it("fails when there are fewer candles than required", () => {
    const candles = risingSeries(2, 100, 1);
    const result = detectConsecutiveBullish(candles, config);
    expect(result.passed).toBe(false);
  });

  it("respects minBodySizeDollars", () => {
    const strictConfig = { ...config, minBodySizeDollars: 10 };
    const candles = risingSeries(5, 100, 1); // body size 1, below threshold
    const result = detectConsecutiveBullish(candles, strictConfig);
    expect(result.passed).toBe(false);
  });
});
