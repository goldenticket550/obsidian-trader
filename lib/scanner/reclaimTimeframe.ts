import type { Candle } from "@/types/candle";
import { getEasternTimePartsForCandleTime } from "@/lib/market-data/easternTime";
import { getSessionTypeForTimestamp, REGULAR_START_MINUTES } from "@/lib/market-data/session";
import type { ReclaimTimeframeSeries } from "./reclaimRunner";

/**
 * Turns a completed candle series into the `ReclaimTimeframeSeries` the
 * runner consumes, deriving the availability indices the detector's
 * `availableFromIndex` checks depend on.
 *
 * Every index returned is a position in the SAME array passed in, so the
 * detector's "was this level available when that candle printed" test
 * lines up exactly. Session boundaries come from the repository's existing
 * helpers (`getSessionTypeForTimestamp`, `REGULAR_START_MINUTES`,
 * `getEasternTimePartsForCandleTime`) rather than a second definition.
 *
 * Pure: no fetching, no clock reads, no mutation of the input array.
 */

/**
 * The opening range is the first five completed one-minute regular-session
 * candles — 9:30 through 9:34:59 ET.
 *
 * This is a SESSION DEFINITION, not a tunable threshold: it is fixed by
 * the spec's session rules rather than configured, which is why it is a
 * named constant here instead of a `reclaimContinuation` key. Expressed in
 * minutes so the same boundary applies to any bar size.
 */
export const RECLAIM_OPENING_RANGE_MINUTES = 5;

/**
 * Period for the FIVE-MINUTE ATR both Reclaim machines measure against.
 *
 * UNVALIDATED DEFAULT. 14 matches the period the repository already uses
 * everywhere else it computes an ATR, so the yardstick is consistent
 * rather than tuned — it has not been observed against live data and is
 * expected to need review.
 *
 * Deliberately its own named constant rather than borrowing
 * `extension.atrPeriod`: that setting belongs to the reversal path's
 * extension rule, and silently coupling the two would mean tuning one
 * moved the other.
 */
export const RECLAIM_FIVE_MINUTE_ATR_PERIOD = 14;

/** Eastern minute-of-day for a candle, via the existing helper. */
function minuteOfDay(candle: Candle): number {
  return getEasternTimePartsForCandleTime(candle.time).minutesSinceMidnight;
}

/**
 * Index of the first completed bar that belongs to the regular session.
 *
 * Null when the series holds no regular-session bar yet — a premarket-only
 * series has no session extreme to track, and saying "index 0" would let
 * premarket bars masquerade as session structure.
 */
export function findRegularSessionStartIndex(candles: readonly Candle[]): number | null {
  for (let i = 0; i < candles.length; i++) {
    if (getSessionTypeForTimestamp(new Date(candles[i].time * 1000)) === "regular") return i;
  }
  return null;
}

/**
 * First index at/after which the premarket range is FINAL.
 *
 * Premarket ends at the regular open, so the premarket high/low can only
 * be treated as a fixed level from the first regular-session bar onward.
 * Before that the range is still forming, and using it would be the same
 * hindsight the detector exists to avoid.
 */
export function findPremarketAvailableFromIndex(candles: readonly Candle[]): number | null {
  return findRegularSessionStartIndex(candles);
}

/**
 * First index at/after which every required opening-range candle has
 * completed.
 *
 * A bar starting at or after 9:35 proves the 9:30–9:34:59 window is behind
 * us, whatever the bar size: for one-minute bars that is the sixth bar,
 * for five-minute bars the second. Null until such a bar exists.
 */
export function findOpeningRangeAvailableFromIndex(candles: readonly Candle[]): number | null {
  const completeFrom = REGULAR_START_MINUTES + RECLAIM_OPENING_RANGE_MINUTES;
  for (let i = 0; i < candles.length; i++) {
    if (
      getSessionTypeForTimestamp(new Date(candles[i].time * 1000)) === "regular" &&
      minuteOfDay(candles[i]) >= completeFrom
    ) {
      return i;
    }
  }
  return null;
}

/**
 * Builds the runner's per-timeframe series.
 *
 * Identical logic for five-minute and one-minute inputs — the boundaries
 * are clock times, not bar counts, so one implementation serves both and
 * neither can drift from the other.
 */
export function buildReclaimTimeframeSeries(
  candles: readonly Candle[]
): ReclaimTimeframeSeries {
  return {
    candles,
    regularSessionStartIndex: findRegularSessionStartIndex(candles),
    premarketAvailableFromIndex: findPremarketAvailableFromIndex(candles),
    openingRangeAvailableFromIndex: findOpeningRangeAvailableFromIndex(candles),
  };
}
