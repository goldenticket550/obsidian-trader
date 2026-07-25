import type { Candle } from "@/types/candle";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";

/**
 * Groups candles by their US Eastern trading date and keeps only the
 * MOST RECENT date's candles.
 *
 * Fixes a real bug (Codex review): fetching "the last N candles" from a
 * multi-day lookback window can silently mix bars from previous trading
 * sessions in with the current one — for example, shortly after market
 * open there simply aren't 100 candles from today yet, so a naive "keep
 * the most recent 100" would pull in leftover candles from prior days.
 * Session-scoped calculations (VWAP, which is defined to reset every
 * session; session high/low; decline-from-open) are only meaningful
 * within a single session — mixing days doesn't just add noise, it
 * changes what the numbers actually mean.
 *
 * This works correctly both during live trading (the most recent date
 * present is today, so this correctly isolates today's candles so far)
 * and when markets are closed (the most recent date present is the last
 * real trading day, e.g. Friday's session on a Saturday scan) — it never
 * needs to know about holidays or calendars, it just groups by the
 * calendar date each candle actually occurred on and keeps the latest
 * group.
 *
 * Only meaningful for intraday timeframes (5m/15m) — daily candles are
 * already one-per-session by definition and should not be filtered.
 */
export function filterToLatestSession(candles: Candle[]): Candle[] {
  if (candles.length === 0) return candles;

  const latestDate = getCurrentTradingDate(new Date(candles[candles.length - 1].time * 1000));

  return candles.filter(
    (c) => getCurrentTradingDate(new Date(c.time * 1000)) === latestDate
  );
}

/**
 * Finds the most recent daily candle's close that's from a trading date
 * strictly BEFORE `todayTradingDate` — i.e. the real previous close,
 * determined explicitly by date rather than by array position.
 *
 * Fixes a real bug (Codex review): the previous logic assumed the
 * second-to-last daily candle was always "yesterday," which is only true
 * when the last daily candle represents today. Before today's daily bar
 * exists yet (e.g. early in the session, or depending on provider
 * timing), that assumption silently selects the close from two sessions
 * ago instead of one. This version works correctly in both cases without
 * needing to know which one applies — it just walks backward from the
 * end of the array until it finds a candle whose date is genuinely
 * earlier than today, however many (or few) candles that takes.
 *
 * Returns null if no such candle exists (e.g. an empty or very short
 * daily series) — callers should have their own fallback for that case.
 */
export function findPreviousClose(dailyCandles: Candle[], todayTradingDate: string): number | null {
  for (let i = dailyCandles.length - 1; i >= 0; i--) {
    const candleDate = getCurrentTradingDate(new Date(dailyCandles[i].time * 1000));
    if (candleDate < todayTradingDate) {
      return dailyCandles[i].close;
    }
  }
  return null;
}
