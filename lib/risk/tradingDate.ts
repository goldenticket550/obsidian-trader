/**
 * Returns the current trading date (YYYY-MM-DD) in US Eastern time. This
 * is deliberately separate from the server's local date, since "today"
 * for trading purposes always means the Eastern calendar day regardless
 * of where the server or user physically is.
 */
export function getCurrentTradingDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
}
