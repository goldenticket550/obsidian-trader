import type { Candle } from "@/types/candle";

/**
 * Calculates an EMA series using standard closing-price EMA math.
 * The first `period` values seed from an SMA, matching how most charting
 * platforms (including TradingView) compute it, so values line up.
 * Returns one EMA value per candle; entries before the seed period are NaN.
 */
export function calculateEma(candles: Candle[], period: number): number[] {
  if (candles.length === 0) return [];
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period) return result;

  const multiplier = 2 / (period + 1);

  const seedSum = candles.slice(0, period).reduce((sum, c) => sum + c.close, 0);
  let ema = seedSum / period;
  result[period - 1] = ema;

  for (let i = period; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
    result[i] = ema;
  }

  return result;
}

/** Simple moving average over closing prices. Same NaN-padding convention as calculateEma. */
export function calculateSma(candles: Candle[], period: number): number[] {
  if (candles.length === 0) return [];
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < period) return result;

  let windowSum = 0;
  for (let i = 0; i < candles.length; i++) {
    windowSum += candles[i].close;
    if (i >= period) {
      windowSum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      result[i] = windowSum / period;
    }
  }
  return result;
}

export function latestValid(series: number[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (!Number.isNaN(series[i])) return series[i];
  }
  return null;
}
