import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";

export type GapFillStatus = "open" | "partially_filled" | "fully_filled" | "invalidated";

export interface FairValueGap {
  upper: number; // candle 3's low (top of gap)
  lower: number; // candle 1's high (bottom of gap)
  createdAt: number; // time of candle 3
  candle1Time: number;
  candle3Time: number;
  status: GapFillStatus;
}

/**
 * Stage 7: a bullish fair value gap exists across 3 consecutive candles
 * when candle 3's low is above candle 1's high — an untraded price gap.
 * This is computed directly from OHLC data; nothing here is inferred.
 */
export function detectBullishFairValueGaps(
  candles: Candle[],
  config: StrategyConfig["fairValueGap"]
): FairValueGap[] {
  const gaps: FairValueGap[] = [];

  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c3 = candles[i];

    if (c3.low > c1.high) {
      const gapSize = c3.low - c1.high;
      const gapSizePct = c1.high === 0 ? 0 : gapSize / c1.high;

      if (gapSize >= config.minGapSizeDollars || gapSizePct >= config.minGapSizePct) {
        gaps.push({
          upper: c3.low,
          lower: c1.high,
          createdAt: c3.time,
          candle1Time: c1.time,
          candle3Time: c3.time,
          status: "open",
        });
      }
    }
  }

  return gaps;
}

/**
 * Stage 8 support: updates a gap's fill status against candles that occurred
 * after it was created. A gap is:
 * - open: price hasn't touched it
 * - partially_filled: price has entered but not closed the gap
 * - fully_filled: price has traded through the entire gap
 * - invalidated: price closed back below the gap's lower boundary after
 *   filling it (the setup that created the gap failed)
 */
export function trackGapFillStatus(gap: FairValueGap, candlesAfterGap: Candle[]): FairValueGap {
  let status: GapFillStatus = "open";

  for (const candle of candlesAfterGap) {
    const touchesGap = candle.low <= gap.upper;
    const fullyFills = candle.low <= gap.lower;

    if (fullyFills) {
      status = "fully_filled";
    } else if (touchesGap && status === "open") {
      status = "partially_filled";
    }

    // Invalidation: after any fill, a close below the gap's lower boundary
    // means the bullish premise behind the gap has failed.
    if (status !== "open" && candle.close < gap.lower) {
      status = "invalidated";
    }
  }

  return { ...gap, status };
}

export interface GapProximityResult {
  withinDollarDistance: boolean;
  withinPctDistance: boolean;
  touchesUpper: boolean;
  entersGap: boolean;
  reachesMidpoint: boolean;
  fullyFills: boolean;
  distanceToUpper: number;
}

/** Stage 8: checks the current price's proximity to a selected gap. */
export function checkGapProximity(
  gap: FairValueGap,
  currentPrice: number,
  config: StrategyConfig["gapProximity"]
): GapProximityResult {
  const distanceToUpper = currentPrice - gap.upper;
  const midpoint = (gap.upper + gap.lower) / 2;

  return {
    withinDollarDistance: Math.abs(distanceToUpper) <= config.alertDistanceDollars,
    withinPctDistance: Math.abs(distanceToUpper) / gap.upper <= config.alertDistancePct,
    touchesUpper: currentPrice <= gap.upper,
    entersGap: currentPrice <= gap.upper && currentPrice > gap.lower,
    reachesMidpoint: currentPrice <= midpoint,
    fullyFills: currentPrice <= gap.lower,
    distanceToUpper,
  };
}

export interface RankedGapSelection {
  /** The qualifying gap closest to current price, or null if none. */
  closest: FairValueGap | null;
  /** Distance from current price to that gap's midpoint, in usd. */
  distance: number | null;
  /** How many gaps qualified, so the UI can say "closest of 3". */
  totalGapsTracked: number;
}

/**
 * Rule C2 — pick the RIGHT gap, not just the first one found.
 *
 * The scorer previously took the first tracked gap with an open or
 * partially-filled status, which is arbitrary when a chart carries
 * several: the one that matters is the one nearest to where price
 * actually is. Qualifying gaps are ranked by absolute distance from
 * current price to the gap's midpoint, ascending, and the closest wins.
 *
 * The status filter is the positive form — `open` or `partially_filled`
 * — matching the scorer line this replaces exactly. A fully filled or
 * invalidated gap is no longer a valid target.
 *
 * Zero qualifying gaps returns nulls with a count of 0; the caller keeps
 * rendering "waiting" rather than fabricating a gap.
 */
export function selectClosestGap(gaps: FairValueGap[], currentPrice: number): RankedGapSelection {
  const qualifying = gaps.filter(
    (g) => g.status === "open" || g.status === "partially_filled"
  );

  if (qualifying.length === 0) {
    return { closest: null, distance: null, totalGapsTracked: 0 };
  }

  const distanceTo = (gap: FairValueGap) =>
    Math.abs(currentPrice - (gap.lower + gap.upper) / 2);

  // Stable: ties keep the earlier-detected gap, since sort() is stable
  // in every engine this runs on and the input is creation-ordered.
  const ranked = [...qualifying].sort((a, b) => distanceTo(a) - distanceTo(b));
  const closest = ranked[0];

  return { closest, distance: distanceTo(closest), totalGapsTracked: qualifying.length };
}
