import { describe, it, expect } from "vitest";
import { detectEmaReclaim } from "@/lib/indicators/emaReclaim";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { fallingSeries, risingSeries, makeCandle } from "@/lib/fixtures/candles";

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

  // Regression tests for a real bug (Codex review, same class as the VWAP
  // fix): the detector used to return passed:true using a STALE
  // historical crossing even after price had since closed back below the
  // EMA. These specifically prove the "currently held" semantics.

  it("passes when a genuine reclaim is still being held on the latest candle", () => {
    const decline = fallingSeries(12, 110, 1);
    const lastFallClose = decline[decline.length - 1].close;
    const rally = risingSeries(15, lastFallClose, 1, decline.length * 300);
    const candles = [...decline, ...rally];

    const result = detectEmaReclaim(candles, config);
    expect(result.passed).toBe(true);
    expect(result.price).toBe(candles[candles.length - 1].close); // the LATEST close, not a stale one
  });

  it("does NOT pass when a genuine reclaim has since failed (price closed back below the EMA)", () => {
    const decline = fallingSeries(12, 110, 1);
    const lastFallClose = decline[decline.length - 1].close;
    const rally = risingSeries(15, lastFallClose, 1, decline.length * 300);
    const beforeFail = [...decline, ...rally];

    // One more candle that dives sharply back below the (fast-moving) EMA.
    const last = beforeFail[beforeFail.length - 1];
    const failCandle = makeCandle({
      time: last.time + 300,
      open: last.close,
      close: last.close - 20,
      high: last.close + 0.2,
      low: last.close - 20.5,
    });
    const candles = [...beforeFail, failCandle];

    const result = detectEmaReclaim(candles, config);
    expect(result.passed).toBe(false);
    expect(result.price).toBe(failCandle.close); // current (failed) price, not the stale reclaim candle's
  });

  it("finds a second valid reclaim after an earlier one failed", () => {
    const decline = fallingSeries(12, 110, 1);
    const lastFallClose = decline[decline.length - 1].close;
    const rally = risingSeries(15, lastFallClose, 1, decline.length * 300);
    const beforeFail = [...decline, ...rally];

    const last = beforeFail[beforeFail.length - 1];
    const failCandle = makeCandle({
      time: last.time + 300,
      open: last.close,
      close: last.close - 20,
      high: last.close + 0.2,
      low: last.close - 20.5,
    });

    // A second decline-then-rally sequence, producing a genuine second crossing.
    const secondDecline = fallingSeries(5, failCandle.close, 2, failCandle.time + 300);
    const lastSecondDeclineClose = secondDecline[secondDecline.length - 1].close;
    const secondRally = risingSeries(
      10,
      lastSecondDeclineClose,
      1.5,
      secondDecline[secondDecline.length - 1].time + 300
    );

    const candles = [...beforeFail, failCandle, ...secondDecline, ...secondRally];

    const result = detectEmaReclaim(candles, config);
    expect(result.passed).toBe(true);
    // The reclaim time should be from the SECOND crossing, which happens
    // strictly after the fail candle - not the stale first crossing.
    expect(result.reclaimTime).toBeGreaterThan(failCandle.time);
  });

  it("does not pass when price has been above the EMA the whole series with no genuine crossing", () => {
    // A steady rise from the very first candle - price starts above its
    // own seeded EMA and never dips, so there's no dip-then-reclaim event.
    const candles = risingSeries(20, 200, 0.3);
    const result = detectEmaReclaim(candles, config);
    expect(result.passed).toBe(false);
  });

  it("does not pass when price never reclaims the EMA at all", () => {
    const candles = fallingSeries(20, 100, 0.3);
    const result = detectEmaReclaim(candles, config);
    expect(result.passed).toBe(false);
  });

  it("always reports the current price and current EMA in both passing and non-passing results", () => {
    const decline = fallingSeries(12, 110, 1);
    const lastFallClose = decline[decline.length - 1].close;
    const rally = risingSeries(15, lastFallClose, 1, decline.length * 300);
    const passingCandles = [...decline, ...rally];
    const passingResult = detectEmaReclaim(passingCandles, config);
    expect(passingResult.price).toBe(passingCandles[passingCandles.length - 1].close);

    const failingCandles = fallingSeries(20, 100, 0.3);
    const failingResult = detectEmaReclaim(failingCandles, config);
    expect(failingResult.price).toBe(failingCandles[failingCandles.length - 1].close);
  });
});
