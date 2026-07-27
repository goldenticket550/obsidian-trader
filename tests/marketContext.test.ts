import { describe, it, expect } from "vitest";
import { quoteFromDailyCandles, MARKET_CONTEXT_SYMBOLS } from "@/lib/market-data/marketContext";
import { makeCandle } from "@/lib/fixtures/candles";

const MON = Math.floor(Date.parse("2026-07-13T20:00:00Z") / 1000);
const FRI = Math.floor(Date.parse("2026-07-10T20:00:00Z") / 1000);

describe("quoteFromDailyCandles", () => {
  it("reports price and change from the two most recent daily candles", () => {
    const q = quoteFromDailyCandles(
      "SPY",
      "SPY",
      [makeCandle({ time: FRI, close: 100 }), makeCandle({ time: MON, close: 101 })],
      "realtime"
    );
    expect(q.price).toBe(101);
    expect(q.changePct).toBeCloseTo(0.01, 6);
    expect(q.asOf).toBe(new Date(MON * 1000).toISOString());
    expect(q.quality).toBe("realtime");
  });

  it("leaves changePct null with only one candle rather than reporting a flat 0%", () => {
    // With no prior close we don't know the change. Showing 0% would read
    // as "unchanged", which is a different and false claim.
    const q = quoteFromDailyCandles("USO", "USO Oil", [makeCandle({ time: MON, close: 78 })], "delayed");
    expect(q.price).toBe(78);
    expect(q.changePct).toBeNull();
  });

  it("reports unavailable with a reason when the provider returns nothing", () => {
    // This is the MockProvider path for a symbol outside the mock fixtures.
    const q = quoteFromDailyCandles("IWM", "IWM", [], "simulated");
    expect(q.price).toBeNull();
    expect(q.changePct).toBeNull();
    expect(q.asOf).toBeNull();
    expect(q.quality).toBeNull();
    expect(q.unavailableReason).toMatch(/no data/i);
  });

  it("never fabricates a price when data is missing", () => {
    const q = quoteFromDailyCandles("SPY", "SPY", [], "simulated");
    expect(q.price).not.toBe(0);
    expect(q.price).toBeNull();
  });

  it("guards against a zero prior close instead of dividing by zero", () => {
    const q = quoteFromDailyCandles(
      "SPY",
      "SPY",
      [makeCandle({ time: FRI, close: 0 }), makeCandle({ time: MON, close: 50 })],
      "realtime"
    );
    expect(q.changePct).toBeNull();
    expect(Number.isFinite(q.price ?? NaN)).toBe(true);
  });

  it("computes a negative change correctly", () => {
    const q = quoteFromDailyCandles(
      "IWM",
      "IWM",
      [makeCandle({ time: FRI, close: 200 }), makeCandle({ time: MON, close: 190 })],
      "realtime"
    );
    expect(q.changePct).toBeCloseTo(-0.05, 6);
  });
});

describe("MARKET_CONTEXT_SYMBOLS", () => {
  it("covers exactly the three supported instruments", () => {
    expect(MARKET_CONTEXT_SYMBOLS.map((s) => s.symbol)).toEqual(["USO", "SPY", "IWM"]);
  });

  it("labels USO as an oil proxy rather than implying spot crude", () => {
    expect(MARKET_CONTEXT_SYMBOLS.find((s) => s.symbol === "USO")?.label).toBe("USO Oil");
  });
});
