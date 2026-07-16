import type { Candle } from "@/types/candle";
import { calculateSma, latestValid } from "./movingAverages";

export interface DailySmaResult {
  passed: boolean; // true when current price is above the daily SMA
  smaValue: number | null;
  price: number | null;
  distancePct: number | null;
}

/**
 * Optional confirmation: is price above the daily 20 SMA (higher-timeframe
 * trend context)? This never gates a green status — it's an add-on point,
 * same tier as volume/wick/sector-strength confirmations.
 *
 * `dailyCandles` must be actual daily candles (one per trading day), not
 * 5m/15m candles — this is intentionally a separate series from the
 * intraday scan.
 */
export function detectDailySmaConfirmation(
  dailyCandles: Candle[],
  currentPrice: number,
  period: number
): DailySmaResult {
  const smaSeries = calculateSma(dailyCandles, period);
  const smaValue = latestValid(smaSeries);

  if (smaValue === null) {
    return { passed: false, smaValue: null, price: currentPrice, distancePct: null };
  }

  const distancePct = (currentPrice - smaValue) / smaValue;
  return {
    passed: currentPrice > smaValue,
    smaValue,
    price: currentPrice,
    distancePct,
  };
}
