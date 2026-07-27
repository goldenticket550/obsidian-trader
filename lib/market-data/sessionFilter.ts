import type { Candle } from "@/types/candle";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";
import { getSessionTypeForTimestamp } from "./session";

export type SessionScope = "regular" | "extended" | "all";

/**
 * Groups candles by their US Eastern trading date and keeps only the
 * MOST RECENT date's candles — AND, by default, restricts further to
 * regular trading hours (9:30am-4:00pm ET) within that date.
 *
 * FIX (Codex review, two rounds): round 1 fixed cross-day contamination
 * (candles from a previous trading day leaking in), but that alone
 * wasn't sufficient — a candle array can still legitimately span a
 * single Eastern calendar date while mixing pre-market (starting 4am
 * ET), regular hours, and after-hours (until 8pm ET) bars together.
 * Since this strategy's "session open," session low, VWAP, and volume
 * averages are all defined relative to REGULAR trading hours, silently
 * including pre/post-market bars in those calculations is a real form
 * of contamination too, just within the same calendar day rather than
 * across days. `sessionScope` defaults to `"regular"` for that reason —
 * pass `"extended"` or `"all"` explicitly if you actually want
 * pre/after-hours bars included.
 *
 * "Latest date" is computed as the MAXIMUM trading date across every
 * candle, not assumed from the last array element — a provider is
 * expected to return bars in ascending order, but computing this
 * explicitly means the function's own documentation ("keeps the most
 * recent date") is actually true regardless of input order, not just
 * true for the current provider's specific behavor.
 *
 * FIX (round 4 follow-up, found on the live dashboard): the scope filter
 * must be applied BEFORE picking the latest date, not after. Picking the
 * date first meant a single pre-market print today moved "latest date" to
 * today, and the regular-hours filter then matched nothing — silently
 * throwing away the previous session's complete, valid data. On a
 * pre-market scan two watchlist symbols showed 0.0 scores and no candle
 * purely because they had ticked pre-market, while a third symbol that
 * happened not to tick still showed Friday's session correctly. Same
 * situation, different answer, which is the tell.
 *
 * Filtering first means "the most recent date that actually HAS candles
 * of the requested kind" — so the last completed regular session survives
 * until a new one genuinely begins. Callers still surface the candle's
 * real timestamp, so a Friday session viewed on Monday is labelled as
 * Friday rather than passed off as current.
 *
 * If no candles match the scope at all, this still returns an empty array
 * and callers still treat that as insufficient data.
 */
export function filterToLatestSession(
  candles: Candle[],
  sessionScope: SessionScope = "regular"
): Candle[] {
  if (candles.length === 0) return candles;

  const inScope = candles.filter((c) => {
    if (sessionScope === "all") return true;
    const sessionType = getSessionTypeForTimestamp(new Date(c.time * 1000));
    if (sessionScope === "regular") return sessionType === "regular";
    // "extended": anything except fully closed (pre-market, regular, after-hours)
    return sessionType !== "closed";
  });

  if (inScope.length === 0) return [];

  const dates = inScope.map((c) => getCurrentTradingDate(new Date(c.time * 1000)));
  const latestDate = dates.reduce((max, d) => (d > max ? d : max), dates[0]);

  return inScope.filter((_, i) => dates[i] === latestDate);
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
 * daily series, or a newly-listed symbol) — callers must NOT substitute
 * today's own (partial) close as a fallback, since that silently
 * mislabels "no data" as "today equals yesterday," corrupting
 * decline-from-previous-close calculations. Treat null as genuinely
 * unavailable.
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
