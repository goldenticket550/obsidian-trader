import { getEasternTimeParts } from "@/lib/market-data/easternTime";

export const EXCHANGE_PREMARKET_OPEN_MINUTES = 4 * 60;
export const EXCHANGE_REGULAR_OPEN_MINUTES = 9 * 60 + 30;
export const EXCHANGE_REGULAR_CLOSE_MINUTES = 16 * 60;
export const EXCHANGE_EARLY_CLOSE_MINUTES = 13 * 60;
export const EXCHANGE_AFTER_HOURS_CLOSE_MINUTES = 20 * 60;
export const EXCHANGE_EARLY_AFTER_HOURS_CLOSE_MINUTES = 17 * 60;

export type ExchangeSessionPhase = "pre-market" | "regular" | "after-hours" | "closed";
export type ExchangeDayKind = "regular" | "early_close" | "holiday" | "weekend";

export interface ExchangeCalendarDay {
  tradingDate: string;
  kind: ExchangeDayKind;
  isTradingDay: boolean;
  regularOpenMinutes: number | null;
  regularCloseMinutes: number | null;
  premarketOpenMinutes: number | null;
  afterHoursCloseMinutes: number | null;
  reason: string | null;
}

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseDate(date: string): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid trading date: ${date}`);
  const [year, month, day] = date.split("-").map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.toISOString().slice(0, 10) !== date) throw new Error(`Invalid trading date: ${date}`);
  return { year, month, day };
}

function dateString(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function weekday(date: string): number {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nthWeekday(year: number, month: number, targetWeekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const day = 1 + ((targetWeekday - first.getUTCDay() + 7) % 7) + (nth - 1) * 7;
  return dateString(year, month, day);
}

function lastWeekday(year: number, month: number, targetWeekday: number): string {
  const last = new Date(Date.UTC(year, month, 0));
  const day = last.getUTCDate() - ((last.getUTCDay() - targetWeekday + 7) % 7);
  return dateString(year, month, day);
}

function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateString(year, month, day);
}

function observedFixedHoliday(year: number, month: number, day: number, saturdayObserved = true): string {
  const actual = dateString(year, month, day);
  const dayOfWeek = weekday(actual);
  if (dayOfWeek === 0) return addDays(actual, 1);
  if (dayOfWeek === 6 && saturdayObserved) return addDays(actual, -1);
  return actual;
}

function holidayMap(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  // NYSE does not move a Saturday New Year's Day to the preceding Friday.
  holidays.set(observedFixedHoliday(year, 1, 1, false), "New Year's Day");
  holidays.set(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  holidays.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  holidays.set(addDays(easterSunday(year), -2), "Good Friday");
  holidays.set(lastWeekday(year, 5, 1), "Memorial Day");
  if (year >= 2022) holidays.set(observedFixedHoliday(year, 6, 19), "Juneteenth");
  holidays.set(observedFixedHoliday(year, 7, 4), "Independence Day");
  holidays.set(nthWeekday(year, 9, 1, 1), "Labor Day");
  holidays.set(nthWeekday(year, 11, 4, 4), "Thanksgiving Day");
  holidays.set(observedFixedHoliday(year, 12, 25), "Christmas Day");

  const adHocClosures: Record<string, string> = {
    "2001-09-11": "September 11 closure", "2001-09-12": "September 11 closure",
    "2001-09-13": "September 11 closure", "2001-09-14": "September 11 closure",
    "2004-06-11": "National day of mourning", "2007-01-02": "National day of mourning",
    "2012-10-29": "Hurricane Sandy", "2012-10-30": "Hurricane Sandy",
    "2018-12-05": "National day of mourning",
  };
  for (const [date, reason] of Object.entries(adHocClosures)) {
    if (date.startsWith(`${year}-`)) holidays.set(date, reason);
  }
  return holidays;
}

function earlyCloseDates(year: number): Set<string> {
  const dates = new Set<string>();
  const dayAfterThanksgiving = addDays(nthWeekday(year, 11, 4, 4), 1);
  if (weekday(dayAfterThanksgiving) >= 1 && weekday(dayAfterThanksgiving) <= 5) dates.add(dayAfterThanksgiving);
  const christmasEve = dateString(year, 12, 24);
  if (weekday(christmasEve) >= 1 && weekday(christmasEve) <= 5 && !holidayMap(year).has(christmasEve)) dates.add(christmasEve);
  // NYSE's published schedules identify these Independence-Day early closes.
  for (const date of ["2025-07-03", "2028-07-03"]) if (date.startsWith(`${year}-`)) dates.add(date);
  return dates;
}

function buildExchangeCalendarDay(tradingDate: string): ExchangeCalendarDay {
  const { year } = parseDate(tradingDate);
  const dayOfWeek = weekday(tradingDate);
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { tradingDate, kind: "weekend", isTradingDay: false, regularOpenMinutes: null, regularCloseMinutes: null, premarketOpenMinutes: null, afterHoursCloseMinutes: null, reason: "weekend" };
  }
  const holiday = holidayMap(year).get(tradingDate);
  if (holiday) {
    return { tradingDate, kind: "holiday", isTradingDay: false, regularOpenMinutes: null, regularCloseMinutes: null, premarketOpenMinutes: null, afterHoursCloseMinutes: null, reason: holiday };
  }
  const early = earlyCloseDates(year).has(tradingDate);
  return {
    tradingDate,
    kind: early ? "early_close" : "regular",
    isTradingDay: true,
    regularOpenMinutes: EXCHANGE_REGULAR_OPEN_MINUTES,
    regularCloseMinutes: early ? EXCHANGE_EARLY_CLOSE_MINUTES : EXCHANGE_REGULAR_CLOSE_MINUTES,
    premarketOpenMinutes: EXCHANGE_PREMARKET_OPEN_MINUTES,
    afterHoursCloseMinutes: early ? EXCHANGE_EARLY_AFTER_HOURS_CLOSE_MINUTES : EXCHANGE_AFTER_HOURS_CLOSE_MINUTES,
    reason: early ? "scheduled early close" : null,
  };
}

const calendarDayCache = new Map<string, ExchangeCalendarDay>();

export function exchangeCalendarDay(tradingDate: string): ExchangeCalendarDay {
  const cached = calendarDayCache.get(tradingDate);
  if (cached) return cached;
  const day = Object.freeze(buildExchangeCalendarDay(tradingDate));
  calendarDayCache.set(tradingDate, day);
  return day;
}

export function exchangeSessionForTimestamp(timestamp: Date): ExchangeSessionPhase {
  const parts = getEasternTimeParts(timestamp);
  const day = exchangeCalendarDay(parts.date);
  if (!day.isTradingDay) return "closed";
  const minute = parts.minutesSinceMidnight;
  if (minute >= day.regularOpenMinutes! && minute < day.regularCloseMinutes!) return "regular";
  if (minute >= day.premarketOpenMinutes! && minute < day.regularOpenMinutes!) return "pre-market";
  if (minute >= day.regularCloseMinutes! && minute < day.afterHoursCloseMinutes!) return "after-hours";
  return "closed";
}

function easternLocalToUtc(tradingDate: string, minutes: number): Date {
  const { year, month, day } = parseDate(tradingDate);
  const targetWallMs = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let candidate = new Date(targetWallMs);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(dateFormatter.formatToParts(candidate).map((part) => [part.type, part.value]));
    const representedWallMs = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    candidate = new Date(candidate.getTime() + targetWallMs - representedWallMs);
  }
  return candidate;
}

export function exchangeRegularCloseAt(tradingDate: string): Date {
  const day = exchangeCalendarDay(tradingDate);
  if (!day.isTradingDay || day.regularCloseMinutes === null) {
    throw new Error("No regular-session close exists for " + tradingDate + ".");
  }
  return easternLocalToUtc(tradingDate, day.regularCloseMinutes);
}

export function exchangeRegularOpenAt(tradingDate: string): Date {
  const day = exchangeCalendarDay(tradingDate);
  if (!day.isTradingDay || day.regularOpenMinutes === null) {
    throw new Error("No regular-session open exists for " + tradingDate + ".");
  }
  return easternLocalToUtc(tradingDate, day.regularOpenMinutes);
}

export function exchangePremarketOpenAt(tradingDate: string): Date {
  const day = exchangeCalendarDay(tradingDate);
  if (!day.isTradingDay || day.premarketOpenMinutes === null) {
    throw new Error("No premarket open exists for " + tradingDate + ".");
  }
  return easternLocalToUtc(tradingDate, day.premarketOpenMinutes);
}

export function previousExchangeTradingDate(tradingDate: string): string {
  parseDate(tradingDate);
  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = addDays(tradingDate, -offset);
    if (exchangeCalendarDay(candidate).isTradingDay) return candidate;
  }
  throw new Error("Could not resolve previous exchange session within 14 calendar days.");
}
/**
 * Alert emission spans the configured extended session on ordinary days.
 * Scheduled early closes are a hard regular-session cutoff until their
 * close-relative auction baseline exists.
 */
export function exchangeAlertEmissionCloseAt(tradingDate: string): Date {
  const day = exchangeCalendarDay(tradingDate);
  if (!day.isTradingDay || day.regularCloseMinutes === null || day.afterHoursCloseMinutes === null) {
    throw new Error("No alert-session close exists for " + tradingDate + ".");
  }
  const close = day.kind === "early_close" ? day.regularCloseMinutes : day.afterHoursCloseMinutes;
  return easternLocalToUtc(tradingDate, close);
}
export function nextExchangeOpen(after: Date): Date {
  const start = getEasternTimeParts(after).date;
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addDays(start, offset);
    const day = exchangeCalendarDay(date);
    if (!day.isTradingDay) continue;
    const open = easternLocalToUtc(date, day.regularOpenMinutes!);
    if (open.getTime() > after.getTime()) return open;
  }
  throw new Error("Could not resolve next exchange open within 14 calendar days.");
}

export function tradingSessionsSince(listedSince: string, throughTradingDate: string): number {
  parseDate(listedSince);
  parseDate(throughTradingDate);
  if (listedSince > throughTradingDate) return 0;
  let sessions = 0;
  for (let date = listedSince; date <= throughTradingDate; date = addDays(date, 1)) {
    if (exchangeCalendarDay(date).isTradingDay) sessions += 1;
  }
  return sessions;
}
