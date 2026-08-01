/**
 * The single place a UTC timestamp gets decomposed into US Eastern
 * calendar/clock parts.
 *
 * Before this existed, three separate modules each built their own
 * `Intl.DateTimeFormat` for America/New_York: `getCurrentTradingDate()`
 * (en-CA, date parts only), `getSessionTypeForTimestamp()` (en-US,
 * weekday + hour + minute), and nothing at all could report a bar's
 * minute-of-day without re-deriving it. Historical baselines need all
 * three facts about the same timestamp — trading date (to group bars into
 * sessions), minute-of-day (to compare "the identical elapsed interval"
 * across sessions), and weekday — so re-parsing the same instant two or
 * three times, once per module, is both wasteful and a real drift risk if
 * one copy's options ever change without the others.
 *
 * Formatter construction is the expensive part of `Intl`, not formatting,
 * so the formatter is built once at module load and reused. A 20-session
 * baseline over 1-minute premarket bars decomposes several thousand
 * timestamps per symbol per scan; constructing a formatter per call would
 * dominate that cost.
 */

/**
 * `hourCycle: "h23"` rather than `hour12: false`. They are nearly
 * synonymous, but under en-US with `hour12: false` some ICU versions
 * report midnight as hour "24" instead of "00" — which would make
 * midnight ET decompose to minute-of-day 1440 rather than 0. Nothing
 * depended on that before (midnight classifies as "closed" either way,
 * so `getSessionTypeForTimestamp` reached the same answer by accident),
 * but a minute-of-day that can exceed 1439 would silently break interval
 * comparisons, so it is pinned explicitly here.
 */
const EASTERN_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface EasternTimeParts {
  /** US Eastern calendar date as `YYYY-MM-DD`. */
  date: string;
  /**
   * Minutes elapsed since midnight US Eastern, 0-1439. This is what makes
   * "the identical elapsed interval" comparable across sessions: two bars
   * from different dates are at the same point in the trading day exactly
   * when their `minutesSinceMidnight` match, regardless of whether either
   * date fell in EST or EDT.
   */
  minutesSinceMidnight: number;
  /** Abbreviated weekday in US Eastern, e.g. "Mon". */
  weekday: string;
  /** False for Saturday/Sunday in US Eastern. Says nothing about holidays. */
  isWeekday: boolean;
}

export function getEasternTimeParts(timestamp: Date): EasternTimeParts {
  const parts = EASTERN_PARTS_FORMATTER.formatToParts(timestamp);
  const find = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";

  const year = find("year") || "1970";
  const month = find("month") || "01";
  const day = find("day") || "01";
  const weekday = find("weekday");
  const hour = Number(find("hour") || "0");
  const minute = Number(find("minute") || "0");

  return {
    date: `${year}-${month}-${day}`,
    minutesSinceMidnight: hour * 60 + minute,
    weekday,
    isWeekday: !["Sat", "Sun"].includes(weekday),
  };
}

/** Convenience for the very common candle case (`time` is epoch seconds). */
export function getEasternTimePartsForCandleTime(timeSeconds: number): EasternTimeParts {
  return getEasternTimeParts(new Date(timeSeconds * 1000));
}
