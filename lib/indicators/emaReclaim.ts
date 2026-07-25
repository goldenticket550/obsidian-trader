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
 * Detects a 9 EMA reclaim that is CURRENTLY HELD: price genuinely crossed
 * from below the EMA to above it at some point, AND has not closed back
 * below the EMA since. Always reports the CURRENT price and CURRENT EMA
 * value, never a stale historical pair from whenever the crossing
 * happened — `reclaimTime` is preserved separately (unix seconds of the
 * original crossing candle) for the UI/alerts to reference when the
 * crossing itself occurred, distinct from the current evaluation.
 *
 * Validity semantics (documented explicitly, per review, same pattern as
 * VWAP's detectVwapReclaim): a reclaim that has since failed (price
 * closed back below the EMA) reports `passed: false` — a stale reclaim
 * the market has already rejected isn't meaningfully different from
 * "never reclaimed" for a REQUIRED scoring condition. A second genuine
 * reclaim later in the session can become valid again; this always finds
 * the most recent unbroken above-EMA streak, not a stale earlier one.
 *
 * The optional stronger confirmations work as follows once a currently-
 * held reclaim is found:
 * - `minReclaimBodySizeDollars`, `requireFollowThroughCandle`, and
 *   `requireRisingSlope` are evaluated AT THE ORIGINAL CROSSING CANDLE —
 *   they measure the quality of that crossing event itself.
 * - `minPctAboveEma` is evaluated using the CURRENT distance from the
 *   CURRENT EMA — "is this reclaim currently meaningful" is a
 *   present-state question, not a property of the crossing moment.
 *
 * FIX (Codex review): the previous version walked backward through the
 * ENTIRE candle history looking for any historical crossing and returned
 * `passed: true` using THAT old candle's price/EMA — even after price
 * had since closed back below the EMA. Since EMA reclaim is a REQUIRED
 * setup condition, this meant a stale, already-failed reclaim could keep
 * a setup at yellow/green status indefinitely.
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

  const lastIndex = candles.length - 1;
  const currentEma = emaSeries[lastIndex];
  const currentPrice = candles[lastIndex].close;

  if (Number.isNaN(currentEma)) return empty;

  const currentDistancePct = (currentPrice - currentEma) / currentEma;
  const currentlyAbove = currentPrice > currentEma;

  if (!currentlyAbove) {
    // Whatever happened earlier, the reclaim (if any) is not currently
    // held - report accurate current values, not a stale historical pair.
    return {
      passed: false,
      emaValue: currentEma,
      price: currentPrice,
      distancePct: currentDistancePct,
      reclaimTime: null,
      followThroughConfirmed: false,
    };
  }

  // Walk backward while price stays above the EMA, looking for the
  // moment it crossed up from below. Finds the MOST RECENT unbroken
  // streak, so a second genuine reclaim after an earlier one failed is
  // found correctly rather than the stale first one.
  for (let i = lastIndex; i >= config.period; i--) {
    const ema = emaSeries[i];
    const prevEma = emaSeries[i - 1];
    if (Number.isNaN(ema) || Number.isNaN(prevEma)) break;

    const closedAboveHere = candles[i].close > ema;
    if (!closedAboveHere) break; // streak broken before finding a genuine cross

    const prevClosedBelow = candles[i - 1].close < prevEma;
    if (prevClosedBelow) {
      // Found the genuine crossing candle - evaluate the optional
      // stronger confirmations against it (crossing quality), but use
      // CURRENT price/EMA for distance and for what gets reported.
      const bodySize = Math.abs(candles[i].close - candles[i].open);
      const meetsBodySize = bodySize >= config.minReclaimBodySizeDollars;
      const meetsDistance = currentDistancePct >= config.minPctAboveEma;

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
        emaValue: currentEma,
        price: currentPrice,
        distancePct: currentDistancePct,
        reclaimTime: candles[i].time,
        followThroughConfirmed,
      };
    }
  }

  // Above the EMA for the whole visible series with no genuine crossing
  // ever found - "always above," not a reclaim.
  return {
    passed: false,
    emaValue: currentEma,
    price: currentPrice,
    distancePct: currentDistancePct,
    reclaimTime: null,
    followThroughConfirmed: false,
  };
}
