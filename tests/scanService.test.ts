import { describe, it, expect } from "vitest";
import { scanWatchlist, MOCK_SCAN_TIME } from "@/lib/scanner/scanService";
import { mockScanInputs } from "@/lib/mock/scanInputs";

// Regression tests for a bug caught by Codex review of commit e6c5acd: the
// mock candle fixtures counted time from 0 (Unix epoch), so latestCandleTime
// — derived from the most recent session candle — resolved to January 1970
// in the UI. These prove the full scanWatchlist() path, using the same
// mockScanInputs the app actually ships with, never produces that.
describe("scanWatchlist (mock mode)", () => {
  it("never derives a latestCandleTime anywhere near the Unix epoch, for any symbol or timeframe", () => {
    const { resultsBySymbol } = scanWatchlist(mockScanInputs);

    expect(Object.keys(resultsBySymbol).length).toBeGreaterThan(0);

    for (const symbol of Object.keys(resultsBySymbol)) {
      for (const timeframe of ["5m", "15m"] as const) {
        const result = resultsBySymbol[symbol][timeframe];
        expect(result.latestCandleTime).not.toBeNull();
        const year = new Date(result.latestCandleTime as string).getUTCFullYear();
        // 1970 specifically is the bug this regresses; anything this far
        // in the past would be equally wrong for a "live" mock session.
        expect(year).toBeGreaterThan(2000);
      }
    }
  });

  it("anchors every symbol's latestCandleTime to the deterministic mock scan time, not an arbitrary date", () => {
    const { resultsBySymbol } = scanWatchlist(mockScanInputs);
    const mockNowMs = new Date(MOCK_SCAN_TIME).getTime();

    for (const symbol of Object.keys(resultsBySymbol)) {
      for (const timeframe of ["5m", "15m"] as const) {
        const result = resultsBySymbol[symbol][timeframe];
        const candleTimeMs = new Date(result.latestCandleTime as string).getTime();
        // The most recent mock candle should land exactly at (or, for
        // shorter series, no earlier than) the mock "now" — never years
        // away from it in either direction.
        expect(candleTimeMs).toBeLessThanOrEqual(mockNowMs);
        expect(mockNowMs - candleTimeMs).toBeLessThan(24 * 60 * 60 * 1000);
      }
    }
  });
});
