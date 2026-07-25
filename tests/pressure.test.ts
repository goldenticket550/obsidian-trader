import { describe, it, expect } from "vitest";
import { calculateBodyPercent, classifyPressure } from "@/lib/indicators/pressure";
import { makeCandle } from "@/lib/fixtures/candles";

describe("calculateBodyPercent", () => {
  it("returns 1.0 for a candle with no wicks", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 105, high: 105, low: 100 });
    expect(calculateBodyPercent(candle)).toBeCloseTo(1.0, 5);
  });

  it("returns a small value for a mostly-wick doji-like candle", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 100.1, high: 105, low: 95 });
    expect(calculateBodyPercent(candle)).toBeLessThan(0.1);
  });

  it("returns 0 for a zero-range candle without dividing by zero", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 100, high: 100, low: 100 });
    expect(calculateBodyPercent(candle)).toBe(0);
  });
});

describe("classifyPressure", () => {
  it("labels strong_buy_pressure for a decisive bullish candle with high relative volume", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 105, high: 105.1, low: 99.9, volume: 3000 });
    const result = classifyPressure(candle, 1000); // 3x average volume
    expect(result.label).toBe("strong_buy_pressure");
  });

  it("labels strong_sell_pressure for a decisive bearish candle with high relative volume", () => {
    const candle = makeCandle({ time: 0, open: 105, close: 100, high: 105.1, low: 99.9, volume: 3000 });
    const result = classifyPressure(candle, 1000);
    expect(result.label).toBe("strong_sell_pressure");
  });

  it("labels neutral when volume is unremarkable, even with a strong body", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 105, high: 105.1, low: 99.9, volume: 900 });
    const result = classifyPressure(candle, 1000); // below average volume
    expect(result.label).toBe("neutral");
  });

  it("labels neutral for an indecisive candle even with huge volume", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 100.1, high: 103, low: 97, volume: 5000 });
    const result = classifyPressure(candle, 1000);
    expect(result.label).toBe("neutral");
  });

  it("never uses institutional-certainty language in the label itself", () => {
    const candle = makeCandle({ time: 0, open: 100, close: 105, high: 105.1, low: 99.9, volume: 3000 });
    const result = classifyPressure(candle, 1000);
    expect(result.label).not.toMatch(/institutional/i);
  });
});
