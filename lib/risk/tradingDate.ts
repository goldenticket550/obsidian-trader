import { getEasternTimeParts } from "@/lib/market-data/easternTime";

/**
 * Returns the current trading date (YYYY-MM-DD) in US Eastern time. This
 * is deliberately separate from the server's local date, since "today"
 * for trading purposes always means the Eastern calendar day regardless
 * of where the server or user physically is.
 */
export function getCurrentTradingDate(now: Date = new Date()): string {
  return getEasternTimeParts(now).date;
}
