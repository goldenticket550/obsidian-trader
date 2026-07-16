import type { Candle } from "@/types/candle";

export interface Pivot {
  index: number;
  time: number;
  price: number;
  type: "high" | "low";
}

/**
 * A pivot low at index i is a candle whose low is strictly lower than the
 * lows of `length` candles on both sides. Same definition for pivot highs.
 * This is a standard, deterministic swing-point definition (no AI judgment
 * involved) — the classic "fractal" pivot.
 */
export function findPivots(candles: Candle[], length: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = length; i < candles.length - length; i++) {
    const candle = candles[i];
    let isPivotLow = true;
    let isPivotHigh = true;

    for (let j = i - length; j <= i + length; j++) {
      if (j === i) continue;
      if (candles[j].low <= candle.low) isPivotLow = false;
      if (candles[j].high >= candle.high) isPivotHigh = false;
    }

    if (isPivotLow) {
      pivots.push({ index: i, time: candle.time, price: candle.low, type: "low" });
    }
    if (isPivotHigh) {
      pivots.push({ index: i, time: candle.time, price: candle.high, type: "high" });
    }
  }
  return pivots;
}

export function mostRecentPivot(
  pivots: Pivot[],
  type: "high" | "low",
  beforeIndex?: number
): Pivot | null {
  for (let i = pivots.length - 1; i >= 0; i--) {
    if (pivots[i].type !== type) continue;
    if (beforeIndex !== undefined && pivots[i].index >= beforeIndex) continue;
    return pivots[i];
  }
  return null;
}
