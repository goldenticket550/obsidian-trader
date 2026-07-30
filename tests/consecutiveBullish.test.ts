import { describe, it, expect } from "vitest";
import { detectConsecutiveBullish } from "@/lib/indicators/consecutiveBullish";
import { formatSignedDollars } from "@/lib/strategies/scorer";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { risingSeries, fallingSeries, makeCandle } from "@/lib/fixtures/candles";

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

describe("detectConsecutiveBullish — 'no data' must be distinguishable from 'checked and failed'", () => {
  const config = defaultStrategyConfig.consecutiveBullish;

  it("flags genuinely insufficient data with insufficientData: true and honest zeros", () => {
    const result = detectConsecutiveBullish(risingSeries(2, 100, 1), config);
    expect(result.insufficientData).toBe(true);
    expect(result.candleCount).toBe(0);
    expect(result.totalMoveDollars).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("reports the REAL window size and net move when the streak breaks", () => {
    const candles = [...risingSeries(4, 100, 1), ...fallingSeries(1, 105, 1, 4 * 300)];
    const result = detectConsecutiveBullish(candles, config);

    expect(result.insufficientData).toBe(false);
    expect(result.passed).toBe(false);
    // The window really was minCandles wide — not zero.
    expect(result.candleCount).toBe(config.minCandles);
    expect(result.totalMoveDollars).not.toBe(0);
  });

  it("reproduces the live MU 5m case: 3-candle window, last candle red, real net move", () => {
    // Exact figures pulled from a live probe of MU 5m at 11:14 ET.
    // 21 real regular-hours candles were present; the streak broke on
    // the 11:10 close, yet the checklist read "0-candle window, $0.00".
    const mu = [
      makeCandle({ time: 0, open: 840.95, high: 850.91, low: 837.39, close: 850.49 }),
      makeCandle({ time: 300, open: 850.35, high: 852.88, low: 843.48, close: 851.52 }),
      makeCandle({ time: 600, open: 851.54, high: 851.95, low: 844.17, close: 848.27 }),
    ];
    const result = detectConsecutiveBullish(mu, config);

    expect(result.passed).toBe(false);
    expect(result.insufficientData).toBe(false);
    expect(result.candleCount).toBe(3);
    // 848.27 - 840.95 = 7.32, positive despite the failing streak. (The
    // live probe printed 7.3250 because the raw feed carries sub-cent
    // precision that this fixture rounds to whole cents.)
    expect(result.totalMoveDollars).toBeCloseTo(7.32, 2);
    expect(result.totalMoveDollars).toBeGreaterThan(0);
  });

  it("leaves a genuinely passing streak unchanged", () => {
    const result = detectConsecutiveBullish(risingSeries(5, 100, 1), config);
    expect(result.passed).toBe(true);
    expect(result.insufficientData).toBe(false);
    expect(result.candleCount).toBe(config.minCandles);
    expect(result.totalMoveDollars).toBeGreaterThan(0);
  });

  it("keeps the pass/fail decision identical across every case", () => {
    // Guards the constraint that only reported metadata changed.
    expect(detectConsecutiveBullish(risingSeries(2, 100, 1), config).passed).toBe(false);
    expect(detectConsecutiveBullish(risingSeries(5, 100, 1), config).passed).toBe(true);
    expect(
      detectConsecutiveBullish(
        [...risingSeries(4, 100, 1), ...fallingSeries(1, 105, 1, 4 * 300)],
        config
      ).passed
    ).toBe(false);
    expect(
      detectConsecutiveBullish(risingSeries(5, 100, 1), { ...config, minBodySizeDollars: 10 }).passed
    ).toBe(false);
  });
});

describe("formatSignedDollars", () => {
  it("signs a net move so a down move can never read as a gain", () => {
    expect(formatSignedDollars(7.325)).toBe("+$7.33");
    expect(formatSignedDollars(-2.1)).toBe("−$2.10");
    expect(formatSignedDollars(0)).toBe("$0.00");
  });

  it("treats a value that rounds to zero as zero, not as a signed near-zero", () => {
    expect(formatSignedDollars(0.001)).toBe("$0.00");
    expect(formatSignedDollars(-0.001)).toBe("$0.00");
  });
});
