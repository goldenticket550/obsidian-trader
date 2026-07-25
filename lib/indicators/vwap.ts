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
 * Detects a VWAP reclaim that is CURRENTLY HELD: price genuinely crossed
 * from below VWAP to above it at some point, AND has not closed back
 * below VWAP since. Always reports the current price and current VWAP
 * value, never a stale historical pair from whenever the crossing
 * happened.
 *
 * Validity semantics (documented explicitly, per review): this is
 * intentionally NOT "was there ever a reclaim in this session" — a
 * reclaim that has since failed (price closed back below VWAP) reports
 * `passed: false`, because a stale reclaim the market has already
 * rejected is not meaningfully different from "never reclaimed" for
 * scoring purposes. This condition type doesn't carry its own
 * "invalidated" state in the UI (unlike structure_shift) — a failed
 * reclaim simply stops passing and can be attempted again later in the
 * session if price reclaims VWAP a second time.
 *
 * FIX (Codex review): the previous version walked backward through the
 * ENTIRE session looking for any historical crossing and returned
 * `passed: true` using THAT old candle's price/VWAP — meaning a reclaim
 * from an hour ago that had since failed would still show as passing,
 * with stale values to boot. Fixed to first check whether the CURRENT
 * candle is above VWAP at all (if not, immediately not passing), then
 * walk backward only to confirm that streak-of-being-above traces back
 * to a genuine cross rather than the session simply opening above VWAP.
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
  const lastIndex = sessionCandles.length - 1;
  const price = sessionCandles[lastIndex].close;
  const vwapValue = vwapSeries[lastIndex];
  const distancePct = vwapValue === 0 ? 0 : (price - vwapValue) / vwapValue;

  const currentlyAbove = price > vwapValue;
  if (!currentlyAbove) {
    // Whatever happened earlier in the session, the reclaim (if any) is
    // not currently being held - report accurate current values, not
    // stale ones from wherever the last crossing was.
    return { passed: false, vwapValue, price, distancePct };
  }

  // Walk backward while price stays above VWAP, looking for the moment
  // it crossed up from below. If the streak breaks (price dips back
  // below VWAP) before we find a genuine cross, this isn't a currently-
  // held reclaim. If we reach the start of the series still above VWAP
  // the whole way with no crossing ever found, that's "always been
  // above" rather than a genuine reclaim - same "reclaim, not just
  // currently above" distinction the 9 EMA detector makes.
  for (let i = lastIndex; i >= 1; i--) {
    const closedAboveHere = sessionCandles[i].close > vwapSeries[i];
    if (!closedAboveHere) break;

    const prevClosedBelow = sessionCandles[i - 1].close < vwapSeries[i - 1];
    if (prevClosedBelow) {
      return { passed: true, vwapValue, price, distancePct };
    }
  }

  return { passed: false, vwapValue, price, distancePct };
}
