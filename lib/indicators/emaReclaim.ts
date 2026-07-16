import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";
import { calculateEma } from "./movingAverages";

export interface EmaReclaimResult {
  passed: boolean;
  emaValue: number | null;
  price: number | null;
  distancePct: number | null;
  reclaimTime: number | null; // unix seconds of the candle that closed back above the EMA
  followThroughConfirmed: boolean;
}

/**
 * Detects a 9 EMA reclaim: price was below the EMA, crosses above it, and
 * closes above it. Optional stronger confirmations (follow-through candle,
 * rising slope, min distance, min body size) are configurable and do not
 * gate the base pass/fail — they're surfaced separately so the scorer can
 * decide whether to require them.
 */
export function detectEmaReclaim(
  candles: Candle[],
  config: StrategyConfig["emaReclaim"]
): EmaReclaimResult {
  const emaSeries = calculateEma(candles, config.period);

  const empty: EmaReclaimResult = {
    passed: false,
    emaValue: null,
    price: null,
    distancePct: null,
    reclaimTime: null,
    followThroughConfirmed: false,
  };

  if (candles.length < config.period + 2) return empty;

  // Walk backward to find the most recent close-above-EMA that was preceded
  // by a close-below-EMA (i.e. an actual reclaim, not just "currently above").
  for (let i = candles.length - 1; i >= config.period; i--) {
    const ema = emaSeries[i];
    const prevEma = emaSeries[i - 1];
    if (Number.isNaN(ema) || Number.isNaN(prevEma)) continue;

    const closedAbove = candles[i].close > ema;
    const prevClosedBelow = candles[i - 1].close < prevEma;

    if (closedAbove && prevClosedBelow) {
      const bodySize = Math.abs(candles[i].close - candles[i].open);
      const meetsBodySize = bodySize >= config.minReclaimBodySizeDollars;
      const distancePct = (candles[i].close - ema) / ema;
      const meetsDistance = distancePct >= config.minPctAboveEma;

      let followThroughConfirmed = true;
      if (config.requireFollowThroughCandle) {
        const nextCandle = candles[i + 1];
        followThroughConfirmed = !!nextCandle && nextCandle.close > emaSeries[i + 1];
      }

      let risingSlopeOk = true;
      if (config.requireRisingSlope) {
        risingSlopeOk = ema > prevEma;
      }

      const passed = meetsBodySize && meetsDistance && risingSlopeOk && followThroughConfirmed;

      return {
        passed,
        emaValue: ema,
        price: candles[i].close,
        distancePct,
        reclaimTime: candles[i].time,
        followThroughConfirmed,
      };
    }
  }

  // No reclaim event found in the series — still report current EMA/price for display.
  const lastEma = emaSeries[emaSeries.length - 1];
  const lastCandle = candles[candles.length - 1];
  return {
    ...empty,
    emaValue: Number.isNaN(lastEma) ? null : lastEma,
    price: lastCandle?.close ?? null,
    distancePct:
      !Number.isNaN(lastEma) && lastCandle ? (lastCandle.close - lastEma) / lastEma : null,
  };
}
