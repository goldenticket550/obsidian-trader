import type { Candle } from "@/types/candle";

/**
 * A five-minute session that produces BOTH a real liquidity sweep and a
 * real confirmed structure shift.
 *
 * The repo's existing `textbookBullishReclaimSeries` sweeps but forms no
 * pivot HIGH, so `triggerSwingHigh` comes back null on it — which would
 * make every structure-level assertion pass vacuously against null. These
 * bars add a distinct peak (index 6) with three lower highs on each side,
 * so `findPivots` genuinely resolves a swing high, and a later close above
 * it that genuinely confirms the shift.
 *
 * The numbers are a hand-built chart shape, not tuned thresholds: nothing
 * here validates that any config value is correct.
 */
const ROWS: [open: number, high: number, low: number, close: number][] = [
  [102.0, 102.2, 101.8, 101.9],
  [101.9, 102.0, 101.5, 101.6],
  [101.6, 101.8, 101.3, 101.4],
  [101.4, 101.6, 101.1, 101.2],
  [101.2, 101.4, 100.9, 101.0],
  [101.0, 101.2, 100.7, 100.8],
  // The swing high the structure shift is measured against.
  [100.8, 104.0, 100.6, 103.8],
  [103.8, 103.0, 102.0, 102.2],
  [102.2, 102.4, 101.0, 101.2],
  [101.2, 101.4, 100.0, 100.2],
  [100.2, 100.6, 99.0, 100.4],
  [100.4, 101.0, 100.2, 100.8],
  [100.8, 102.0, 100.6, 101.8],
  [101.8, 103.0, 101.6, 102.8],
  // Closes above the swing high — the shift itself.
  [102.8, 104.5, 102.6, 104.3],
  [104.3, 104.6, 104.0, 104.4],
  [104.4, 104.8, 104.2, 104.6],
];

/** The bars, stamped from `startTime` at `stepSeconds` spacing. */
export function structureAndSweepSeries(startTime: number, stepSeconds = 300): Candle[] {
  return ROWS.map(([open, high, low, close], i) => ({
    time: startTime + i * stepSeconds,
    open,
    high,
    low,
    close,
    volume: 5000,
  }));
}

export const STRUCTURE_SWEEP_BAR_COUNT = ROWS.length;
