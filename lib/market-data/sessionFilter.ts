import type { Candle } from "@/types/candle";
import { getEasternTimeParts } from "./easternTime";
import { getSessionTypeForTimestamp } from "./session";

export type SessionScope = "regular" | "extended" | "all";

/** One trading date's worth of in-scope candles. */
export interface SessionGroup {
  /** US Eastern trading date, `YYYY-MM-DD`. */
  tradingDate: string;
  /** In-scope candles for that date, in the order they appeared in the input. */
  candles: Candle[];
}

/**
 * Splits a multi-day candle array into one group per US Eastern trading
 * date, after applying the same scope filter `filterToLatestSession` has
 * always applied.
 *
 * This is the grouping step that already lived inside
 * `filterToLatestSession` — it grouped candles by session date and then
 * discarded everything except the latest group. Collapsing to the single
 * latest session is exactly right for the live scorer (session VWAP,
 * session low, decline-from-open are all defined against *the* current
 * session), but it is wrong for a historical baseline, which needs the
 * prior N sessions specifically in order to compare today against them.
 * Rather than write a second, subtly-different copy of the day-bucketing
 * rules for baselines to use, the general operation is exposed here and
 * `filterToLatestSession` becomes the one-line special case of it — the
 * same relationship `findPreviousClose` already has to
 * `findPreviousDailyCandle`, so there is one implementation to get right
 * and one place a fix lands.
 *
 * Order guarantees, both relied on by callers:
 * - Groups are returned ascending by trading date, so `groups.at(-1)` is
 *   the most recent session and `groups.slice(-n)` is the most recent n.
 *   The ordering is computed from the dates themselves, never assumed
 *   from array position — a provider is *expected* to return bars in
 *   ascending order, but this function's documentation is true either way.
 * - Within a group, candles keep their input order (unchanged behavior).
 *
 * The scope filter is applied BEFORE grouping, for the round-4 reason
 * `filterToLatestSession` documents below: a date with no in-scope
 * candles must not exist as an empty group that outranks a genuinely
 * complete earlier session.
 */
export function groupBySession(
  candles: Candle[],
  sessionScope: SessionScope = "regular"
): SessionGroup[] {
  const byDate = new Map<string, Candle[]>();

  for (const candle of candles) {
    const timestamp = new Date(candle.time * 1000);
    if (sessionScope !== "all") {
      const sessionType = getSessionTypeForTimestamp(timestamp);
      const inScope =
        sessionScope === "regular"
          ? sessionType === "regular"
          : // "extended": anything except fully closed (pre-market, regular, after-hours)
            sessionType !== "closed";
      if (!inScope) continue;
    }

    const tradingDate = getEasternTimeParts(timestamp).date;
    const existing = byDate.get(tradingDate);
    if (existing) {
      existing.push(candle);
    } else {
      byDate.set(tradingDate, [candle]);
    }
  }

  return [...byDate.entries()]
    .map(([tradingDate, groupCandles]) => ({ tradingDate, candles: groupCandles }))
    .sort((a, b) => (a.tradingDate < b.tradingDate ? -1 : a.tradingDate > b.tradingDate ? 1 : 0));
}

/**
 * The most recent `count` session groups, oldest first — i.e. what a
 * historical baseline actually asks for. Returns fewer than `count` when
 * fewer sessions are present; callers are responsible for treating a
 * short result as insufficient data rather than quietly averaging over
 * whatever happened to be there.
 */
export function filterToRecentSessions(
  candles: Candle[],
  count: number,
  sessionScope: SessionScope = "regular"
): SessionGroup[] {
  if (count <= 0) return [];
  return groupBySession(candles, sessionScope).slice(-count);
}

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
 *
 * All of the above is now implemented by `groupBySession` — this is the
 * "just the latest group" special case of it, exactly as
 * `findPreviousClose` is the "just the close" special case of
 * `findPreviousDailyCandle`. Behavior is unchanged; the reasoning above
 * is kept here because this is the function callers read.
 */
export function filterToLatestSession(
  candles: Candle[],
  sessionScope: SessionScope = "regular"
): Candle[] {
  return groupBySession(candles, sessionScope).at(-1)?.candles ?? [];
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
  return findPreviousDailyCandle(dailyCandles, todayTradingDate)?.close ?? null;
}

/**
 * The whole prior-session daily candle, not just its close.
 *
 * Identifying "the prior daily candle" positionally is unsafe:
 * alpacaProvider deliberately does not session-filter the `1d` series, so
 * during market hours the array's last element is TODAY's still-forming
 * bar rather than yesterday's completed one. Walking backward by date is
 * the already-proven fix that findPreviousClose used; this exposes the
 * full candle so callers needing `.high` as well as `.close` (Rule A1's
 * prior-day rejection level) reuse that same tested lookup instead of
 * reimplementing it — and cannot accidentally reimplement it wrongly.
 *
 * Returns null when no candle has an ET date strictly before today's, for
 * exactly the reasons findPreviousClose documents: callers must treat
 * that as genuinely unavailable and must NOT fall back to today's own
 * partial candle, which would silently manufacture a "prior day" out of
 * the current session.
 */
export function findPreviousDailyCandle(
  dailyCandles: Candle[],
  todayTradingDate: string
): Candle | null {
  for (let i = dailyCandles.length - 1; i >= 0; i--) {
    const candleDate = getEasternTimeParts(new Date(dailyCandles[i].time * 1000)).date;
    if (candleDate < todayTradingDate) {
      return dailyCandles[i];
    }
  }
  return null;
}
