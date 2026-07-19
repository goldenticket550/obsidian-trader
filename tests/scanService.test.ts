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

  // Regression test for a follow-up bug in the first fix (commit 639a940):
  // anchoring reused the raw MOCK_SCAN_TIME (14:32 UTC) directly instead of
  // flooring it to the candle's own interval boundary, so a 5-minute or
  // 15-minute candle could claim to have opened mid-bar (e.g. 14:32
  // instead of 14:30) — impossible for real market data. Both the 5m and
  // 15m series must land on exactly 14:30 UTC, the boundary at or before
  // MOCK_SCAN_TIME for their respective interval.
  it("returns the exact mock candle time (2026-07-11T14:30:00.000Z) for every symbol and timeframe", () => {
    expect(MOCK_SCAN_TIME).toBe("2026-07-11T14:32:00Z"); // guards the hardcoded expectation below
    const { resultsBySymbol } = scanWatchlist(mockScanInputs);

    for (const symbol of Object.keys(resultsBySymbol)) {
      for (const timeframe of ["5m", "15m"] as const) {
        const result = resultsBySymbol[symbol][timeframe];
        expect(result.latestCandleTime).toBe("2026-07-11T14:30:00.000Z");
      }
    }
  });
});
