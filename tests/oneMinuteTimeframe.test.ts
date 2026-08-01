import { describe, it, expect } from "vitest";
import { computeStartDate } from "@/lib/market-data/providers/alpacaProvider";
import { CANDLE_CACHE_TTL_MS } from "@/lib/market-data/cache";
import { buildTradingViewUrl } from "@/lib/tradingview";
import { MockProvider } from "@/lib/market-data/providers/mockProvider";
import { mockScanInputs } from "@/lib/mock/scanInputs";

/**
 * Stage 1 foundation: "1m" is a genuinely new Timeframe for this app.
 * These lock the two real problems found before implementing it — the
 * flat 6-day intraday lookback, and the daily-candle fallback in the
 * mock provider — plus the compiler-enforced map coverage.
 */
describe("1m timeframe — provider foundation", () => {
  const NOW = new Date("2026-07-31T14:00:00Z");

  function daysBack(iso: string): number {
    return Math.round((NOW.getTime() - new Date(iso).getTime()) / 86_400_000);
  }

  it("reaches back many SESSIONS for 1m, not the flat 6 calendar days used by 5m/15m", () => {
    // 20 sessions of 1m baselines is ~7,800 bars; 6 calendar days is ~4
    // sessions and would silently return far too little history.
    const wide = computeStartDate(NOW, "1m", 7_800);
    expect(daysBack(wide)).toBeGreaterThan(6);
  });

  it("scales the 1m window with the requested bar count", () => {
    const small = daysBack(computeStartDate(NOW, "1m", 390)); // ~1 session
    const large = daysBack(computeStartDate(NOW, "1m", 7_800)); // ~20 sessions
    expect(large).toBeGreaterThan(small);
  });

  it("leaves the 5m and 15m lookback untouched at 6 days", () => {
    expect(daysBack(computeStartDate(NOW, "5m", 100))).toBe(6);
    expect(daysBack(computeStartDate(NOW, "15m", 100))).toBe(6);
  });

  it("gives 1m the shortest cache TTL of any timeframe", () => {
    expect(CANDLE_CACHE_TTL_MS["1m"]).toBeLessThan(CANDLE_CACHE_TTL_MS["5m"]);
    expect(CANDLE_CACHE_TTL_MS["1m"]).toBeLessThan(CANDLE_CACHE_TTL_MS["1d"]);
  });

  it("maps 1m for TradingView links", () => {
    expect(buildTradingViewUrl("NASDAQ", "GOOGL", "1m")).toContain("interval=1");
  });

  it("mock provider returns intraday bars for 1m, never the daily series", async () => {
    // Without an explicit branch an unrecognised timeframe fell through to
    // dailyCandles, so a 1m-backed test would have asserted on the wrong
    // series while appearing to pass.
    const provider = new MockProvider();
    const symbol = mockScanInputs[0].symbol;
    const oneMinute = await provider.getCandles({ symbol, timeframe: "1m" });
    const daily = await provider.getCandles({ symbol, timeframe: "1d" });

    expect(oneMinute.candles.length).toBeGreaterThan(0);
    expect(oneMinute.candles).not.toEqual(daily.candles);
    expect(oneMinute.timeframe).toBe("1m");
  });
});
