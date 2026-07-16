import type { SessionInfo } from "./types";

/**
 * Computes the current US equity market session from a UTC timestamp.
 * V1 limitation (documented, not hidden): this only accounts for the
 * standard weekday/hour schedule — it does NOT account for market
 * holidays (Thanksgiving, Christmas, etc.) or early-close days. A real
 * holiday calendar is a reasonable Phase 4 follow-up once a provider's
 * calendar endpoint is wired in (Alpaca and Polygon both expose one).
 */
export function computeSessionInfo(now: Date = new Date()): SessionInfo {
  // Convert to US Eastern time using the Intl API (handles DST correctly
  // without pulling in a date library).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutesSinceMidnight = hour * 60 + minute;

  const isWeekday = !["Sat", "Sun"].includes(weekday);

  const PRE_MARKET_START = 4 * 60; // 4:00 AM ET
  const REGULAR_START = 9 * 60 + 30; // 9:30 AM ET
  const REGULAR_END = 16 * 60; // 4:00 PM ET
  const AFTER_HOURS_END = 20 * 60; // 8:00 PM ET

  if (!isWeekday) {
    return { isOpen: false, session: "closed", nextOpenTime: null };
  }

  if (minutesSinceMidnight >= REGULAR_START && minutesSinceMidnight < REGULAR_END) {
    return { isOpen: true, session: "regular", nextOpenTime: null };
  }
  if (minutesSinceMidnight >= PRE_MARKET_START && minutesSinceMidnight < REGULAR_START) {
    return { isOpen: false, session: "pre-market", nextOpenTime: null };
  }
  if (minutesSinceMidnight >= REGULAR_END && minutesSinceMidnight < AFTER_HOURS_END) {
    return { isOpen: false, session: "after-hours", nextOpenTime: null };
  }

  return { isOpen: false, session: "closed", nextOpenTime: null };
}
