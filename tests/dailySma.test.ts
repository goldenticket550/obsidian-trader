import { describe, it, expect } from "vitest";
import { detectDailySmaConfirmation } from "@/lib/indicators/dailySma";
import { flatSeries, risingSeries } from "@/lib/fixtures/candles";

describe("detectDailySmaConfirmation", () => {
  it("passes when price is above the daily SMA", () => {
    const dailyCandles = flatSeries(20, 100);
    const result = detectDailySmaConfirmation(dailyCandles, 105, 20);
    expect(result.passed).toBe(true);
    expect(result.smaValue).toBeCloseTo(100, 5);
  });

  it("fails when price is below the daily SMA", () => {
    const dailyCandles = flatSeries(20, 100);
    const result = detectDailySmaConfirmation(dailyCandles, 95, 20);
    expect(result.passed).toBe(false);
  });

  it("returns null smaValue when not enough daily candles exist", () => {
    const dailyCandles = flatSeries(5, 100);
    const result = detectDailySmaConfirmation(dailyCandles, 105, 20);
    expect(result.smaValue).toBeNull();
    expect(result.passed).toBe(false);
  });

  it("reports distance percentage correctly", () => {
    const dailyCandles = flatSeries(20, 100);
    const result = detectDailySmaConfirmation(dailyCandles, 110, 20);
    expect(result.distancePct).toBeCloseTo(0.1, 5);
  });
});
