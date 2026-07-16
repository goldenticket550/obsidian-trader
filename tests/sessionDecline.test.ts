import { describe, it, expect } from "vitest";
import { detectIntradayDecline, detectRecoveryFromLow } from "@/lib/indicators/sessionDecline";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { fallingSeries, risingSeries } from "@/lib/fixtures/candles";

describe("detectIntradayDecline", () => {
  const config = defaultStrategyConfig.intradayDecline;

  it("passes when decline from open exceeds threshold", () => {
    const candles = fallingSeries(10, 100, 0.5); // ends at 95, ~5% decline
    const result = detectIntradayDecline(candles, 100, config);
    expect(result.passed).toBe(true);
  });

  it("fails on a flat/rising session", () => {
    const candles = risingSeries(10, 100, 0.2);
    const result = detectIntradayDecline(candles, 100, config);
    expect(result.passed).toBe(false);
  });
});

describe("detectRecoveryFromLow", () => {
  const config = defaultStrategyConfig.recoveryFromLow;

  it("detects dollar recovery from session low", () => {
    const decline = fallingSeries(10, 110, 1); // ends near 100
    const rally = risingSeries(5, decline[decline.length - 1].close, 1, decline.length * 300);
    const candles = [...decline, ...rally];

    const result = detectRecoveryFromLow(candles, config);
    expect(result.passed).toBe(true);
    expect(result.dollarRecovery).toBeGreaterThan(config.minDollarRecovery);
  });

  it("does not pass when price never leaves the low", () => {
    const candles = fallingSeries(10, 110, 1);
    const result = detectRecoveryFromLow(candles, config);
    expect(result.passed).toBe(false);
  });
});
