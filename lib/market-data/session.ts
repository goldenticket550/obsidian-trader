import {
  EXCHANGE_AFTER_HOURS_CLOSE_MINUTES,
  EXCHANGE_PREMARKET_OPEN_MINUTES,
  EXCHANGE_REGULAR_CLOSE_MINUTES,
  EXCHANGE_REGULAR_OPEN_MINUTES,
  exchangeSessionForTimestamp,
  nextExchangeOpen,
} from "@/lib/attention/exchangeCalendar";
import type { SessionInfo, SessionType } from "./types";

// Compatibility exports: every existing session filter consumes the same
// boundaries while the exchange calendar supplies holiday/early-close rules.
export const PRE_MARKET_START_MINUTES = EXCHANGE_PREMARKET_OPEN_MINUTES;
export const REGULAR_START_MINUTES = EXCHANGE_REGULAR_OPEN_MINUTES;
export const REGULAR_END_MINUTES = EXCHANGE_REGULAR_CLOSE_MINUTES;
export const AFTER_HOURS_END_MINUTES = EXCHANGE_AFTER_HOURS_CLOSE_MINUTES;

export function getSessionTypeForTimestamp(timestamp: Date): SessionType {
  return exchangeSessionForTimestamp(timestamp);
}

export function computeSessionInfo(now: Date = new Date()): SessionInfo {
  const session = getSessionTypeForTimestamp(now);
  return {
    isOpen: session === "regular",
    session,
    nextOpenTime: session === "regular" ? null : nextExchangeOpen(now).toISOString(),
  };
}
