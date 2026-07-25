import type { Candle } from "@/types/candle";

/**
 * True range for a single candle, accounting for gaps from the prior
 * close (not just the current candle's high-low range).
 */
export function trueRange(candle: Candle, prevClose: number | null): number {
  if (prevClose === null) return candle.high - candle.low;
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - prevClose),
    Math.abs(candle.low - prevClose)
  );
}

/**
 * Simple-average ATR (not Wilder-smoothed — simpler and sufficiently
 * accurate for this use case, which is extension detection, not a
 * precision volatility indicator). Returns one value per candle;
 * entries before the seed period are NaN, matching the EMA/SMA
 * convention elsewhere in this codebase.
 */
export function calculateAtr(candles: Candle[], period = 14): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period + 1) return result;

  const trueRanges: number[] = candles.map((c, i) =>
    trueRange(c, i === 0 ? null : candles[i - 1].close)
  );

  let windowSum = 0;
  for (let i = 0; i < trueRanges.length; i++) {
    windowSum += trueRanges[i];
    if (i >= period) windowSum -= trueRanges[i - period];
    if (i >= period - 1) result[i] = windowSum / period;
  }

  return result;
}
