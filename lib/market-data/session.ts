import { getEasternTimeParts } from "./easternTime";
import type { SessionInfo, SessionType } from "./types";

// US Eastern minute-of-day boundaries. Exported so other modules (like
// sessionFilter.ts) can filter candles by the exact same regular-hours
// definition used here, instead of redefining their own copy that could
// drift out of sync.
export const PRE_MARKET_START_MINUTES = 4 * 60; // 4:00 AM ET
export const REGULAR_START_MINUTES = 9 * 60 + 30; // 9:30 AM ET
export const REGULAR_END_MINUTES = 16 * 60; // 4:00 PM ET
export const AFTER_HOURS_END_MINUTES = 20 * 60; // 8:00 PM ET

/**
 * Classifies a single timestamp into a session type, in US Eastern time.
 * The timestamp-agnostic core of computeSessionInfo() below — extracted
 * so candle-level filtering (sessionFilter.ts) can classify each
 * candle's own timestamp, not just "right now."
 *
 * Same V1 limitation as computeSessionInfo: does not account for market
 * holidays or early closes.
 */
export function getSessionTypeForTimestamp(timestamp: Date): SessionType {
  const { minutesSinceMidnight, isWeekday } = getEasternTimeParts(timestamp);

  if (!isWeekday) return "closed";

  if (minutesSinceMidnight >= REGULAR_START_MINUTES && minutesSinceMidnight < REGULAR_END_MINUTES) {
    return "regular";
  }
  if (
    minutesSinceMidnight >= PRE_MARKET_START_MINUTES &&
    minutesSinceMidnight < REGULAR_START_MINUTES
  ) {
    return "pre-market";
  }
  if (minutesSinceMidnight >= REGULAR_END_MINUTES && minutesSinceMidnight < AFTER_HOURS_END_MINUTES) {
    return "after-hours";
  }
  return "closed";
}

/**
 * Computes the current US equity market session from a UTC timestamp.
 * V1 limitation (documented, not hidden): this only accounts for the
 * standard weekday/hour schedule — it does NOT account for market
 * holidays (Thanksgiving, Christmas, etc.) or early-close days. A real
 * holiday calendar is a reasonable Phase 4 follow-up once a provider's
 * calendar endpoint is wired in (Alpaca and Polygon both expose one).
 */
export function computeSessionInfo(now: Date = new Date()): SessionInfo {
  const session = getSessionTypeForTimestamp(now);
  return { isOpen: session === "regular", session, nextOpenTime: null };
}
