import type { Candle } from "@/types/candle";

/**
 * Calculates session VWAP (volume-weighted average price) — cumulative
 * from the start of the given candle series, which should be the
 * current session's candles only (VWAP resets each session; passing
 * multi-day data here would produce a meaningless multi-day average).
 *
 * Standard formula: VWAP = cumulative(typicalPrice * volume) / cumulative(volume)
 * where typicalPrice = (high + low + close) / 3.
 *
 * Returns one VWAP value per candle, reflecting the cumulative value up
 * to and including that candle.
 */
export function calculateVwap(sessionCandles: Candle[]): number[] {
  const result: number[] = [];
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  for (const candle of sessionCandles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;

    result.push(cumulativeVolume === 0 ? typicalPrice : cumulativePriceVolume / cumulativeVolume);
  }

  return result;
}

export interface VwapReclaimResult {
  passed: boolean;
  vwapValue: number | null;
  price: number | null;
  distancePct: number | null;
}

/**
 * Detects a VWAP reclaim: price was below session VWAP and closes back
 * above it. Same "reclaim, not just currently above" pattern as the 9
 * EMA reclaim detector — walks backward for the most recent genuine
 * cross rather than just checking the latest candle.
 */
export function detectVwapReclaim(sessionCandles: Candle[]): VwapReclaimResult {
  const empty: VwapReclaimResult = {
    passed: false,
    vwapValue: null,
    price: null,
    distancePct: null,
  };

  if (sessionCandles.length < 2) return empty;

  const vwapSeries = calculateVwap(sessionCandles);

  for (let i = sessionCandles.length - 1; i >= 1; i--) {
    const closedAbove = sessionCandles[i].close > vwapSeries[i];
    const prevClosedBelow = sessionCandles[i - 1].close < vwapSeries[i - 1];

    if (closedAbove && prevClosedBelow) {
      return {
        passed: true,
        vwapValue: vwapSeries[i],
        price: sessionCandles[i].close,
        distancePct: (sessionCandles[i].close - vwapSeries[i]) / vwapSeries[i],
      };
    }
  }

  const lastIndex = sessionCandles.length - 1;
  const lastVwap = vwapSeries[lastIndex];
  const lastPrice = sessionCandles[lastIndex].close;
  return {
    passed: false,
    vwapValue: lastVwap,
    price: lastPrice,
    distancePct: (lastPrice - lastVwap) / lastVwap,
  };
}
