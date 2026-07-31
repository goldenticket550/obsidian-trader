import { describe, it, expect } from "vitest";
import {
  detectPriorDayRejection,
  detectPremarketReclaim,
  detectPriorDayContinuation,
} from "@/lib/indicators/priorDayContinuation";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { makeCandle } from "@/lib/fixtures/candles";
import type { Candle } from "@/types/candle";

const config = defaultStrategyConfig.priorDayContinuation;
const TODAY = "2026-07-31";

/** A daily candle on a given ET date, at 20:00 UTC (inside that session). */
function daily(date: string, high: number, close: number): Candle {
  return makeCandle({
    time: Math.floor(new Date(`${date}T20:00:00Z`).getTime() / 1000),
    open: close,
    high,
    low: Math.min(close, high) - 1,
    close,
  });
}

/** A premarket 5m candle on today, at an ET hour before 09:30. */
function premarket(hourEt: number, minute: number, close: number, high = close + 0.1): Candle {
  const utcHour = hourEt + 4; // EDT
  return makeCandle({
    time: Math.floor(new Date(`${TODAY}T${String(utcHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`).getTime() / 1000),
    open: close,
    high,
    low: close - 0.1,
    close,
  });
}

describe("Rule A1 — prior-day rejection (two tiers)", () => {
  it("reports insufficientData when no candle predates today — never fabricates a rejection", () => {
    const r = detectPriorDayRejection([daily(TODAY, 110, 100)], TODAY, config);
    expect(r.insufficientData).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.tier).toBe("none");
    expect(r.rejectionLevel).toBeNull();
  });

  it("reports insufficientData on an empty daily series", () => {
    expect(detectPriorDayRejection([], TODAY, config).insufficientData).toBe(true);
  });

  it("ignores today's still-forming bar and uses the prior session's candle", () => {
    // The last element is TODAY (the provider does not session-filter 1d).
    // Taking it positionally would compare today against itself.
    const candles = [daily("2026-07-30", 100, 97), daily(TODAY, 200, 199)];
    const r = detectPriorDayRejection(candles, TODAY, config);
    expect(r.rejectionLevel).toBe(100); // prior high, not today's 200
    expect(r.priorClose).toBe(97);
    expect(r.tier).toBe("rejection");
  });

  it("fires the 2% tier exactly at the boundary (lte)", () => {
    // 100 × (1 − 0.02) = 98 — an lte comparison must include it.
    const r = detectPriorDayRejection([daily("2026-07-30", 100, 98)], TODAY, config);
    expect(r.tier).toBe("rejection");
    expect(r.passed).toBe(true);
  });

  it("does not fire just above the 2% boundary", () => {
    const r = detectPriorDayRejection([daily("2026-07-30", 100, 98.01)], TODAY, config);
    expect(r.tier).toBe("none");
    expect(r.passed).toBe(false);
    expect(r.insufficientData).toBe(false); // checked, and it's a no
  });

  it("fires the 5% strong tier exactly at the boundary (lte)", () => {
    const r = detectPriorDayRejection([daily("2026-07-30", 100, 95)], TODAY, config);
    expect(r.tier).toBe("strong_rejection");
  });

  it("reports the deeper tier when both hold", () => {
    const r = detectPriorDayRejection([daily("2026-07-30", 100, 90)], TODAY, config);
    expect(r.tier).toBe("strong_rejection");
    expect(r.declinePct).toBeCloseTo(0.1, 5);
  });

  it("stays in the shallow tier between 2% and 5%", () => {
    const r = detectPriorDayRejection([daily("2026-07-30", 100, 96)], TODAY, config);
    expect(r.tier).toBe("rejection");
  });
});

describe("Rule A2 — premarket reclaim (currently held, not merely touched)", () => {
  it("reports insufficientData below 2 premarket candles", () => {
    const r = detectPremarketReclaim([premarket(5, 0, 101)], 100);
    expect(r.insufficientData).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("reports insufficientData when there is no level to reclaim", () => {
    expect(detectPremarketReclaim([premarket(5, 0, 1), premarket(5, 5, 2)], null).insufficientData).toBe(true);
  });

  it("passes on a genuine cross from below that is still held", () => {
    const r = detectPremarketReclaim(
      [premarket(5, 0, 99), premarket(5, 5, 99.5), premarket(5, 10, 101)],
      100
    );
    expect(r.passed).toBe(true);
    expect(r.reclaimCandleTime).not.toBeNull();
  });

  it("does NOT pass when price was above the whole time (never a reclaim)", () => {
    const r = detectPremarketReclaim(
      [premarket(5, 0, 101), premarket(5, 5, 102), premarket(5, 10, 103)],
      100
    );
    expect(r.passed).toBe(false);
    expect(r.insufficientData).toBe(false);
  });

  it("does NOT pass when the reclaim was lost again (not currently held)", () => {
    const r = detectPremarketReclaim(
      [premarket(5, 0, 99), premarket(5, 5, 101), premarket(5, 10, 98)],
      100
    );
    expect(r.passed).toBe(false);
    expect(r.currentPremarketPrice).toBe(98); // accurate current values, not stale
  });

  it("flags sparseData on thin premarket coverage rather than calling it 'no reclaim'", () => {
    const r = detectPremarketReclaim([premarket(5, 0, 99), premarket(5, 5, 101)], 100);
    expect(r.sparseData).toBe(true);
  });

  it("does not flag sparseData once coverage is adequate", () => {
    const candles = Array.from({ length: 8 }, (_, i) => premarket(5, i * 5, 99 + i * 0.5));
    expect(detectPremarketReclaim(candles, 100).sparseData).toBe(false);
  });
});

describe("Rule A3 — combined continuation", () => {
  const priorRejected = [daily("2026-07-30", 100, 96)];
  const reclaimed = [premarket(5, 0, 99), premarket(5, 5, 99.5), premarket(5, 10, 101)];

  it("passes only when BOTH sub-rules pass", () => {
    const r = detectPriorDayContinuation(priorRejected, reclaimed, TODAY, config);
    expect(r.passed).toBe(true);
    expect(r.insufficientData).toBe(false);
  });

  it("fails when there was no prior-day rejection", () => {
    const r = detectPriorDayContinuation([daily("2026-07-30", 100, 99.5)], reclaimed, TODAY, config);
    expect(r.passed).toBe(false);
  });

  it("is insufficientData — not a fail — when A1 has no data", () => {
    const r = detectPriorDayContinuation([], reclaimed, TODAY, config);
    expect(r.insufficientData).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("is insufficientData — not a fail — when A2 has no data", () => {
    const r = detectPriorDayContinuation(priorRejected, [], TODAY, config);
    expect(r.insufficientData).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("describes only what happened, with no prediction or confidence language", () => {
    const detail = detectPriorDayContinuation(priorRejected, reclaimed, TODAY, config).detail;
    expect(detail).toContain("Prior-day rejection at $100.00");
    expect(detail).toContain("premarket reclaimed at $101.00");
    for (const banned of ["will ", "likely", "probability", "confidence", "expect", "should continue"]) {
      expect(detail.toLowerCase()).not.toContain(banned);
    }
  });
});
