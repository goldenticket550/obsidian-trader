import { describe, it, expect } from "vitest";
import { mockScanInputs, floorToIntervalBoundary } from "@/lib/mock/scanInputs";

const FIVE_MIN_SECONDS = 300;
const FIFTEEN_MIN_SECONDS = 900;

// Regression tests for a follow-up bug in the first "no 1970 dates" fix
// (commit 639a940): the anchor reused the raw MOCK_SCAN_TIME (14:32 UTC)
// instead of flooring to the candle's own interval boundary, and every 15m
// mock series was actually spaced 300 seconds apart (5m spacing) because
// chain() and the fixture generators hardcoded a 300-second step
// regardless of which timeframe was being built. Both defects produced
// candles that couldn't exist in real market data.
describe("mockScanInputs", () => {
  it("spaces every 5m candle exactly 300 seconds apart, all on 5-minute boundaries", () => {
    for (const input of mockScanInputs) {
      const candles = input.sessionCandles5m;
      expect(candles.length).toBeGreaterThan(0);
      for (let i = 1; i < candles.length; i++) {
        expect(candles[i].time - candles[i - 1].time).toBe(FIVE_MIN_SECONDS);
      }
      for (const c of candles) {
        expect(c.time % FIVE_MIN_SECONDS).toBe(0);
      }
    }
  });

  it("spaces every 15m candle exactly 900 seconds apart, all on 15-minute boundaries", () => {
    for (const input of mockScanInputs) {
      const candles = input.sessionCandles15m;
      expect(candles.length).toBeGreaterThan(0);
      for (let i = 1; i < candles.length; i++) {
        expect(candles[i].time - candles[i - 1].time).toBe(FIFTEEN_MIN_SECONDS);
      }
      for (const c of candles) {
        expect(c.time % FIFTEEN_MIN_SECONDS).toBe(0);
      }
    }
  });

  it("anchors the most recent 5m and 15m candle of every symbol to exactly 2026-07-11T14:30:00Z", () => {
    const expected = Math.floor(new Date("2026-07-11T14:30:00Z").getTime() / 1000);
    for (const input of mockScanInputs) {
      const last5m = input.sessionCandles5m[input.sessionCandles5m.length - 1];
      const last15m = input.sessionCandles15m[input.sessionCandles15m.length - 1];
      expect(last5m.time).toBe(expected);
      expect(last15m.time).toBe(expected);
    }
  });
});

// floorToIntervalBoundary must genuinely floor to the nearest boundary for
// whatever timestamp and interval it's given — not just work for the
// current MOCK_SCAN_TIME value via a hardcoded "-2 minutes" shortcut. These
// use timestamps unrelated to 14:32 to prove that.
describe("floorToIntervalBoundary", () => {
  it("floors an arbitrary timestamp down to the preceding 5-minute boundary", () => {
    const t = Math.floor(new Date("2026-01-01T09:47:12Z").getTime() / 1000);
    const expected = Math.floor(new Date("2026-01-01T09:45:00Z").getTime() / 1000);
    expect(floorToIntervalBoundary(t, FIVE_MIN_SECONDS)).toBe(expected);
  });

  it("floors an arbitrary timestamp down to the preceding 15-minute boundary", () => {
    const t = Math.floor(new Date("2026-01-01T09:47:12Z").getTime() / 1000);
    const expected = Math.floor(new Date("2026-01-01T09:45:00Z").getTime() / 1000);
    expect(floorToIntervalBoundary(t, FIFTEEN_MIN_SECONDS)).toBe(expected);
  });

  it("leaves a timestamp already on a boundary unchanged", () => {
    const t = Math.floor(new Date("2026-01-01T09:45:00Z").getTime() / 1000);
    expect(floorToIntervalBoundary(t, FIVE_MIN_SECONDS)).toBe(t);
    expect(floorToIntervalBoundary(t, FIFTEEN_MIN_SECONDS)).toBe(t);
  });

  it("floors the actual MOCK_SCAN_TIME (14:32 UTC) down to 14:30 UTC for both 5m and 15m intervals", () => {
    const t = Math.floor(new Date("2026-07-11T14:32:00Z").getTime() / 1000);
    const expected = Math.floor(new Date("2026-07-11T14:30:00Z").getTime() / 1000);
    expect(floorToIntervalBoundary(t, FIVE_MIN_SECONDS)).toBe(expected);
    expect(floorToIntervalBoundary(t, FIFTEEN_MIN_SECONDS)).toBe(expected);
  });
});
