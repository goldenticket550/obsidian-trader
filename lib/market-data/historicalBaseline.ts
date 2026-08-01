import type { Candle, CandleSeries, PaginationStatus, Timeframe } from "@/types/candle";
import { getEasternTimeParts } from "./easternTime";
import { PRE_MARKET_START_MINUTES, REGULAR_START_MINUTES } from "./session";
import { groupBySession, type SessionGroup, type SessionScope } from "./sessionFilter";
import { TtlCache } from "./cache";
import { DEFAULT_BAR_ADJUSTMENT } from "./types";
import type { BarAdjustment, MarketDataProvider } from "./types";

/**
 * Historical baselines: "is today's elapsed premarket unusual for THIS
 * symbol," answered by comparing today's cumulative volume and range
 * against the identical elapsed interval on each of the previous N
 * sessions (Rules A2/A3).
 *
 * The whole correctness burden of this module is the phrase "identical
 * elapsed interval." Comparing today's 4:00-9:24 window against a prior
 * session's *entire* premarket would make every morning look quiet, and
 * comparing against a prior session's 4:00-9:24 measured in UTC would be
 * off by an hour across a DST boundary. Both are avoided the same way:
 * every bar is placed by its minute-of-day in US Eastern
 * (`getEasternTimeParts`), and a window is a pair of Eastern
 * minute-of-day bounds that means the same clock interval on every date
 * regardless of EST/EDT.
 */

/** Rule A2/A3 default: compare against the previous 20 eligible sessions. */
export const DEFAULT_LOOKBACK_SESSIONS = 20;

/**
 * Rule A2/A3 hard floor: fewer than this many *eligible* comparison
 * sessions and the baseline reports `insufficientData` instead of a
 * number. A median over three sessions is not a baseline, and quoting one
 * as though it were is exactly the kind of false precision the rest of
 * this codebase's `insufficientData` discipline exists to prevent.
 */
export const MIN_BASELINE_SESSIONS = 10;

/** Bar duration in minutes, per intraday timeframe. */
const TIMEFRAME_MINUTES: Record<Exclude<Timeframe, "1d">, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
};

export function barIntervalMinutes(timeframe: Exclude<Timeframe, "1d">): number {
  return TIMEFRAME_MINUTES[timeframe];
}

/**
 * Why a session was left out of a baseline. Reported rather than silently
 * dropped, so the UI can honestly say "18 of 20 sessions eligible"
 * instead of implying all 20 were used.
 */
export type IneligibleReason =
  /** No bars at all fell inside the comparison window on that date. */
  | "no_bars_in_window"
  /**
   * The session's bars stop well before the cutoff — the signature of a
   * truncated/half day or a provider gap, not of a quiet stock.
   */
  | "truncated_before_cutoff"
  /**
   * Almost nothing printed across the whole window. Distinct from
   * `truncated_before_cutoff`: the data reaches the cutoff, there is just
   * so little of it that a range or volume comparison is meaningless.
   */
  | "sparse_coverage";

export interface ExcludedSession {
  tradingDate: string;
  reason: IneligibleReason;
  barCount: number;
}

/** One session's aggregate over the comparison window. Only ever built for eligible sessions. */
export interface SessionWindowAggregate {
  tradingDate: string;
  /** Cumulative volume across the window. */
  volume: number;
  /** Sum of `close × volume` per bar — the dollar-volume context Part 2 asks for. */
  dollarVolume: number;
  high: number;
  low: number;
  /** `high - low` across the window. Rule A3's `currentRange`. */
  range: number;
  /** Open of the first bar in the window; close of the last. */
  open: number;
  close: number;
  barCount: number;
  /** How many bars a gapless session would have held over this window. */
  expectedBarCount: number;
  /** `barCount / expectedBarCount`. Below 1 for any symbol that does not print every bar. */
  coverage: number;
  /** Eastern minute-of-day of the first and last bars actually present. */
  firstBarMinutes: number;
  lastBarMinutes: number;
}

export interface CutoffWindowOptions {
  /**
   * Eastern minute-of-day the window opens at, inclusive. Defaults to
   * 4:00 AM ET — the premarket open, which is what Rules A2/A3 measure
   * "cumulative volume from" and "range across."
   */
  startMinutes?: number;
  /**
   * Eastern minute-of-day the window closes at, exclusive of any bar that
   * would still be forming at that moment. A bar is included only if it
   * has fully COMPLETED by the cutoff (`barStart + interval <= cutoff`),
   * never merely started — the same completed-bar discipline Rule A1
   * requires, applied to the historical side so today is not compared
   * against baselines built from partial bars.
   */
  cutoffMinutes: number;
  /** Bar duration, needed both for the completion test and for coverage. */
  intervalMinutes: number;
  /**
   * Largest gap tolerated between the last bar's end and the cutoff,
   * expressed as a fraction of the window's width, before the session is
   * treated as truncated rather than quiet.
   *
   * The distinction this encodes: a stock being illiquid early in
   * premarket is real information that belongs in the baseline (excluding
   * quiet days would bias every median upward and make today look less
   * unusual than it is), whereas data that simply *stops* well before the
   * cutoff is a truncated session or a provider gap. A late first print
   * is weak evidence of either; a missing tail is strong evidence of
   * truncation, because a symbol that traded at all that morning prints
   * near the cutoff. So the gate is on the tail only.
   *
   * Unvalidated scanner default, not a probability.
   */
  maxTailGapFraction?: number;
  /**
   * Minimum `barCount / expectedBarCount` for a session to count. Set
   * deliberately low: its job is to drop sessions with essentially no
   * data (three prints across five hours), not to enforce liquidity.
   * Unvalidated scanner default.
   */
  minCoverage?: number;
}

export interface CutoffAggregation {
  /** Eligible sessions only, ascending by trading date. */
  sessions: SessionWindowAggregate[];
  /** Sessions present in the input but excluded, with the reason why. */
  excluded: ExcludedSession[];
  /** The window these were computed over, echoed back for display/caching. */
  window: { startMinutes: number; cutoffMinutes: number; intervalMinutes: number };
  /**
   * What is known about the bars this was computed FROM, when they came
   * through `HistoricalBarCache`. Absent for a direct call on caller-owned
   * candles — absent means "not reported", never "known to be complete".
   */
  source?: BarSourceStatus;
}

const DEFAULT_MAX_TAIL_GAP_FRACTION = 0.1;
const DEFAULT_MIN_COVERAGE = 0.05;

/**
 * Aggregates each trading session in `candles` over the identical Eastern
 * clock window `[startMinutes, cutoffMinutes)`, returning one aggregate
 * per eligible session plus an explicit list of what was excluded.
 *
 * Built directly on `groupBySession` — the multi-session grouping that
 * `filterToLatestSession` used to keep private. This function does not
 * re-derive session boundaries or re-implement day bucketing; it only
 * decides which bars inside each already-grouped session fall in the
 * window, and whether that session is comparable at all.
 *
 * Pure and synchronous: no fetching, no caching, no clock reads. The
 * cutoff is an input, so a test can pin it exactly and the cache above
 * can key on it.
 */
export function aggregateThroughCutoff(
  candles: Candle[],
  options: CutoffWindowOptions,
  sessionScope: SessionScope = "extended"
): CutoffAggregation {
  const {
    startMinutes = PRE_MARKET_START_MINUTES,
    cutoffMinutes,
    intervalMinutes,
    maxTailGapFraction = DEFAULT_MAX_TAIL_GAP_FRACTION,
    minCoverage = DEFAULT_MIN_COVERAGE,
  } = options;

  const window = { startMinutes, cutoffMinutes, intervalMinutes };
  const windowWidth = cutoffMinutes - startMinutes;

  if (windowWidth <= 0 || intervalMinutes <= 0) {
    return { sessions: [], excluded: [], window };
  }

  const expectedBarCount = Math.max(1, Math.floor(windowWidth / intervalMinutes));
  const maxTailGapMinutes = windowWidth * maxTailGapFraction;

  const sessions: SessionWindowAggregate[] = [];
  const excluded: ExcludedSession[] = [];

  for (const group of groupBySession(candles, sessionScope)) {
    const aggregate = aggregateOneSession(group, {
      startMinutes,
      cutoffMinutes,
      intervalMinutes,
      expectedBarCount,
    });

    if (!aggregate) {
      excluded.push({ tradingDate: group.tradingDate, reason: "no_bars_in_window", barCount: 0 });
      continue;
    }

    const tailGap = cutoffMinutes - (aggregate.lastBarMinutes + intervalMinutes);
    if (tailGap > maxTailGapMinutes) {
      excluded.push({
        tradingDate: group.tradingDate,
        reason: "truncated_before_cutoff",
        barCount: aggregate.barCount,
      });
      continue;
    }

    if (aggregate.coverage < minCoverage) {
      excluded.push({
        tradingDate: group.tradingDate,
        reason: "sparse_coverage",
        barCount: aggregate.barCount,
      });
      continue;
    }

    sessions.push(aggregate);
  }

  return { sessions, excluded, window };
}

function aggregateOneSession(
  group: SessionGroup,
  bounds: {
    startMinutes: number;
    cutoffMinutes: number;
    intervalMinutes: number;
    expectedBarCount: number;
  }
): SessionWindowAggregate | null {
  const { startMinutes, cutoffMinutes, intervalMinutes, expectedBarCount } = bounds;

  let volume = 0;
  let dollarVolume = 0;
  let high = -Infinity;
  let low = Infinity;
  let barCount = 0;
  let firstBarMinutes = Infinity;
  let lastBarMinutes = -Infinity;
  let open = 0;
  let close = 0;

  for (const candle of group.candles) {
    const minutes = getEasternTimeParts(new Date(candle.time * 1000)).minutesSinceMidnight;
    // Completed-bar test, not merely "started before the cutoff".
    if (minutes < startMinutes || minutes + intervalMinutes > cutoffMinutes) continue;

    volume += candle.volume;
    dollarVolume += candle.close * candle.volume;
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
    barCount += 1;

    // Chronological extremes are taken by Eastern minute-of-day rather
    // than array position, so an out-of-order input still yields the true
    // first and last bar of the window (same guarantee groupBySession makes).
    if (minutes < firstBarMinutes) {
      firstBarMinutes = minutes;
      open = candle.open;
    }
    if (minutes > lastBarMinutes) {
      lastBarMinutes = minutes;
      close = candle.close;
    }
  }

  if (barCount === 0) return null;

  return {
    tradingDate: group.tradingDate,
    volume,
    dollarVolume,
    high,
    low,
    range: high - low,
    open,
    close,
    barCount,
    expectedBarCount,
    coverage: barCount / expectedBarCount,
    firstBarMinutes,
    lastBarMinutes,
  };
}

/**
 * The Eastern minute-of-day of the latest bar that has fully COMPLETED as
 * of `now`, plus one interval — i.e. the cutoff that "through the latest
 * completed bar" means today.
 *
 * Returns null when no bar in `candles` has completed yet, which callers
 * must treat as genuinely insufficient data rather than substituting the
 * current wall-clock minute: a cutoff with no bar behind it would compare
 * an empty window against full historical ones and report today as
 * anomalously quiet.
 *
 * `candles` is expected to be today's session only; bars from other dates
 * are ignored so a multi-session array cannot pull the cutoff forward.
 */
export function computeCompletedBarCutoff(
  candles: Candle[],
  intervalMinutes: number,
  now: Date = new Date()
): number | null {
  const { date: todayDate, minutesSinceMidnight: nowMinutes } = getEasternTimeParts(now);

  let latestCompletedEnd: number | null = null;

  for (const candle of candles) {
    const parts = getEasternTimeParts(new Date(candle.time * 1000));
    if (parts.date !== todayDate) continue;

    const barEnd = parts.minutesSinceMidnight + intervalMinutes;
    if (barEnd > nowMinutes) continue; // still forming
    if (latestCompletedEnd === null || barEnd > latestCompletedEnd) latestCompletedEnd = barEnd;
  }

  return latestCompletedEnd;
}

/**
 * Today's bars that have fully COMPLETED as of `now`, using the same
 * cutoff `computeCompletedBarCutoff` derives.
 *
 * Every consumer of intraday bars needs this and none of them should
 * re-derive it: an unfinished candle carries whatever volume and range it
 * has accumulated so far, which on a fast one-minute bar is exactly the
 * shape of a shock. Discarding it is not an optimization — a bar that
 * finishes flat would have produced an alert on evidence that no longer
 * exists by the time the bar closes.
 *
 * Returns an empty array when nothing has completed yet, which callers
 * must treat as insufficient data rather than as an absence of activity.
 */
export function filterToCompletedBars(
  candles: Candle[],
  intervalMinutes: number,
  now: Date = new Date()
): Candle[] {
  const cutoff = computeCompletedBarCutoff(candles, intervalMinutes, now);
  if (cutoff === null) return [];

  const { date: todayDate } = getEasternTimeParts(now);

  return candles
    .filter((c) => {
      const parts = getEasternTimeParts(new Date(c.time * 1000));
      if (parts.date !== todayDate) return false;
      return parts.minutesSinceMidnight + intervalMinutes <= cutoff;
    })
    .sort((a, b) => a.time - b.time);
}

/**
 * Premarket cutoff clamp: the premarket comparison window can never
 * extend past 9:30 AM ET. Without this, a scan run at 10:15 would build
 * a "premarket" window running to 10:15 for today and compare it against
 * historical windows doing the same — internally consistent, but no
 * longer measuring premarket at all.
 */
export function clampToPremarketCutoff(cutoffMinutes: number): number {
  return Math.min(cutoffMinutes, REGULAR_START_MINUTES);
}

/** One prior session's bar at a specific Eastern minute-of-day, plus the bar before it. */
export interface TimeOfDayBar {
  tradingDate: string;
  bar: Candle;
  /**
   * The immediately preceding bar in the SAME session, needed for a true
   * range (which is defined against the previous close). Null when the
   * target bar is that session's first, in which case true range falls
   * back to high − low, exactly as `trueRange()` already does.
   */
  previousBar: Candle | null;
}

/**
 * Collects the bar at one specific Eastern minute-of-day from every
 * session present, excluding `excludeTradingDate` (today).
 *
 * This is the baseline shape the early-acceleration test needs, and it is
 * deliberately different from `aggregateThroughCutoff`'s cumulative
 * window: a dollar-volume or true-range shock asks "is THIS 9:31 bar
 * unusual for a 9:31 bar," which a cumulative-since-4am figure cannot
 * answer. Matching on minute-of-day rather than elapsed time is what
 * makes the comparison like-for-like, since volume and range both vary
 * enormously across the morning.
 *
 * Sessions with no bar at that exact minute are simply absent from the
 * result — a symbol that did not print at 9:31 that day contributes no
 * data point rather than a zero, which would drag the median down and
 * manufacture a shock.
 */
export function collectTimeOfDayBars(
  candles: Candle[],
  minuteOfDay: number,
  excludeTradingDate: string | null = null,
  sessionScope: SessionScope = "extended"
): TimeOfDayBar[] {
  const result: TimeOfDayBar[] = [];

  for (const group of groupBySession(candles, sessionScope)) {
    if (group.tradingDate === excludeTradingDate) continue;

    // Sort within the session so "the previous bar" is chronological, not
    // positional — same guarantee groupBySession makes about ordering.
    const ordered = [...group.candles].sort((a, b) => a.time - b.time);
    const index = ordered.findIndex(
      (c) => getEasternTimeParts(new Date(c.time * 1000)).minutesSinceMidnight === minuteOfDay
    );
    if (index === -1) continue;

    result.push({
      tradingDate: group.tradingDate,
      bar: ordered[index],
      previousBar: index > 0 ? ordered[index - 1] : null,
    });
  }

  return result;
}

/** Median of a numeric list. Null for an empty list — never 0, which reads as a real measurement. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------------------------------------------------------------------------
// Raw-bar cache
// ---------------------------------------------------------------------------

export interface HistoricalBarRequest {
  symbol: string;
  timeframe: Exclude<Timeframe, "1d">;
  /**
   * The provider feed these bars came from (e.g. "iex" / "sip").
   *
   * Part of the cache key, and not optional in spirit: IEX and SIP return
   * materially different premarket coverage for the same symbol and
   * session, so a baseline built from one and compared against the other
   * would be measuring the feed rather than the stock. Entries for the
   * two feeds must never collide.
   */
  feed?: string;
  /**
   * Corporate-action adjustment mode. Also part of the cache identity:
   * raw and split-adjusted bars are different prices for the same session,
   * and serving one to a request for the other rewrites history silently.
   */
  adjustment?: BarAdjustment;
  /** How many trading sessions of history to hold, today included. */
  sessionCount?: number;
  sessionScope?: SessionScope;
  /**
   * Today's Eastern trading date, when the caller expects today's session
   * to be present. Supplied, a response missing it is reported incomplete
   * rather than accepted — which is exactly what an oldest-first truncated
   * page chain leaves behind.
   */
  todayTradingDate?: string;
  deadlineAt?: number;
}

/** Why a fetched bar set cannot be treated as an authoritative baseline source. */
export type BarSourceIncompleteReason =
  /** The provider's page chain was cut short; the NEWEST bars are missing. */
  | "pagination_truncated"
  /** Today's session was expected and is not in the response. */
  | "today_session_missing"
  /** Fewer distinct sessions came back than were asked for. */
  | "insufficient_sessions"
  /** The provider returned no bars at all. */
  | "empty_response"
  /** The provider call failed outright. */
  | "provider_error";

/** What is known about a fetched bar set, independent of the bars themselves. */
export interface BarSourceStatus {
  /**
   * True only when the provider's pagination finished cleanly AND the
   * session coverage the caller asked for is actually present.
   */
  complete: boolean;
  /** Never true while `complete` is false — the two are the same judgment. */
  insufficientData: boolean;
  reason: BarSourceIncompleteReason | null;
  pagination: PaginationStatus;
  expectedSessionCount: number;
  actualEligibleSessionCount: number;
  todayExpected: boolean;
  todayPresent: boolean;
  fetchedAt: string;
}

/**
 * A cached bar set together with everything needed to judge whether it may
 * be used — never a bare `Candle[]`.
 *
 * A bare array cannot express the difference between "20 complete sessions"
 * and "20 sessions with the newest four missing because the page chain was
 * cut", and those two look identical to every consumer downstream.
 */
export interface HistoricalBarCacheEntry extends BarSourceStatus {
  candles: Candle[];
  /** Eastern trading dates actually present, ascending. */
  coveredTradingDates: string[];
  provider: string;
  feed: string;
  symbol: string;
  timeframe: Exclude<Timeframe, "1d">;
  sessionScope: SessionScope;
  adjustment: BarAdjustment;
}

/** Pagination status for a provider that reported none. */
const UNREPORTED_PAGINATION: PaginationStatus = {
  complete: true,
  pagesFetched: 1,
  nextPageTokenRemaining: false,
  truncationReason: null,
};

/**
 * How long an INCOMPLETE or empty response is held.
 *
 * Short and separate from the normal TTL on purpose: caching a failure for
 * fifteen minutes hides it, and caching it for zero re-issues a multi-page
 * fetch on every render of a failing symbol. Long enough to prevent a
 * request storm, short enough that the failure is retried promptly.
 */
export const HISTORICAL_BAR_FAILURE_TTL_MS = 30_000;

/**
 * How long a fetched multi-session bar set stays usable.
 *
 * Deliberately much longer than `CANDLE_CACHE_TTL_MS`: that cache exists
 * so the live scorer sees a fresh current bar, whereas this one holds
 * mostly *completed prior sessions*, which are immutable — Friday's 4:07
 * AM bar will never change again. The only volatile part of the response
 * is today's tail, and the aggregation layer above already refuses to use
 * a bar that has not completed, so a slightly stale tail cannot leak into
 * a baseline as anything except "not enough sessions yet."
 *
 * This is the actual point of the cache: a 20-session 1-minute fetch is
 * ~8,000 bars across multiple paginated pages, which must not be re-issued
 * per symbol per render.
 */
export const HISTORICAL_BAR_CACHE_TTL_MS = 15 * 60_000;

/**
 * Caches raw multi-session bars per symbol, so the expensive part (the
 * provider round-trip) happens once per TTL while the cheap part (the
 * aggregation, which changes every time the cutoff advances a bar) stays
 * a pure recomputation over cached data.
 *
 * Splitting it this way is what makes an advancing cutoff affordable:
 * keying the *fetch* on the cutoff would miss on every new bar and refetch
 * 8,000 bars every five minutes for no reason, since the historical bars
 * involved are identical either way.
 */
export class HistoricalBarCache {
  private bars: TtlCache<HistoricalBarCacheEntry>;
  /**
   * Second layer, keyed by cutoff as well. Aggregation is pure and fast,
   * but it runs per symbol per render across 20 sessions of bars, and the
   * result is stable for as long as the cutoff is — which is a whole bar
   * interval. Memoizing it is what satisfies the spec's "do not recompute
   * 20 historical sessions on every render."
   */
  private aggregates: TtlCache<CutoffAggregation>;

  constructor(
    private readonly provider: MarketDataProvider,
    ttlMs: number = HISTORICAL_BAR_CACHE_TTL_MS,
    options: {
      /** TTL for incomplete/empty responses. See HISTORICAL_BAR_FAILURE_TTL_MS. */
      failureTtlMs?: number;
      /** Injectable clock — the TTL rules are behaviour worth testing directly. */
      now?: () => number;
    } = {}
  ) {
    this.bars = new TtlCache<HistoricalBarCacheEntry>(ttlMs);
    this.aggregates = new TtlCache<CutoffAggregation>(ttlMs);
    this.ttlMs = ttlMs;
    this.failureTtlMs = options.failureTtlMs ?? HISTORICAL_BAR_FAILURE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  private readonly ttlMs: number;
  private readonly failureTtlMs: number;
  private readonly now: () => number;

  private resolve(request: HistoricalBarRequest) {
    return {
      symbol: request.symbol,
      timeframe: request.timeframe,
      feed: request.feed ?? "default",
      adjustment: request.adjustment ?? DEFAULT_BAR_ADJUSTMENT,
      sessionCount: request.sessionCount ?? DEFAULT_LOOKBACK_SESSIONS + 1,
      sessionScope: request.sessionScope ?? ("extended" as SessionScope),
    };
  }

  private barsKey(resolved: ReturnType<HistoricalBarCache["resolve"]>): string {
    const { feed, adjustment, symbol, timeframe, sessionCount, sessionScope } = resolved;
    // Provider and feed first, so an IEX entry can never be served to a SIP
    // request, nor one provider's bars to another's. Adjustment is in the
    // key because raw and adjusted bars are different prices for the same
    // session. Deliberately NO cutoff time: the raw bars are identical
    // whatever the cutoff, and keying on it would refetch thousands of
    // bars every interval to obtain exactly the same data.
    return `${this.provider.name}:${feed}:${adjustment}:${symbol}:${timeframe}:${sessionCount}:${sessionScope}`;
  }

  /**
   * Fetches (or serves from cache) the bars covering `sessionCount`
   * sessions, together with an honest account of what arrived.
   *
   * Returns an entry rather than an array so a truncated or failed fetch
   * cannot be mistaken for a whole one anywhere downstream.
   */
  async getBars(request: HistoricalBarRequest): Promise<HistoricalBarCacheEntry> {
    const resolved = this.resolve(request);
    const key = this.barsKey(resolved);
    const now = this.now();

    const cached = this.bars.get(key, now);
    if (cached) return cached;

    // Bars per session is an upper bound, not an estimate: asking for too
    // few would silently truncate the oldest sessions out of the baseline.
    // Premarket + regular + after-hours is 16 hours, so 960 one-minute bars.
    const barsPerSession = Math.ceil((16 * 60) / barIntervalMinutes(resolved.timeframe));

    let series: CandleSeries;
    try {
      series = await this.provider.getCandles({
        symbol: resolved.symbol,
        timeframe: resolved.timeframe,
        limit: barsPerSession * resolved.sessionCount,
        sessionScope: resolved.sessionScope,
        sessionCount: resolved.sessionCount,
        adjustment: resolved.adjustment,
        deadlineAt: request.deadlineAt,
      });
    } catch {
      // A failed call is not a data point. Nothing is written, so an
      // existing valid entry (live or merely expired) is never replaced by
      // a transient failure, and the next call retries cleanly.
      return this.buildEntry(resolved, request, [], {
        complete: false,
        pagesFetched: 0,
        nextPageTokenRemaining: false,
        truncationReason: "provider_error",
      }, "provider_error", now);
    }

    const entry = this.buildEntry(
      resolved,
      request,
      series.candles,
      series.pagination ?? UNREPORTED_PAGINATION,
      null,
      now
    );

    // A complete entry gets the normal TTL. An incomplete or empty one gets
    // the short failure TTL: cached enough to stop a request storm, never
    // long enough to pass as an answer.
    this.bars.set(key, entry, entry.complete ? this.ttlMs : this.failureTtlMs, now);
    return entry;
  }

  private buildEntry(
    resolved: ReturnType<HistoricalBarCache["resolve"]>,
    request: HistoricalBarRequest,
    candles: Candle[],
    pagination: PaginationStatus,
    forcedReason: BarSourceIncompleteReason | null,
    now: number
  ): HistoricalBarCacheEntry {
    const coveredTradingDates = groupBySession(candles, resolved.sessionScope).map(
      (g) => g.tradingDate
    );
    const todayExpected = request.todayTradingDate !== undefined;
    const todayPresent =
      todayExpected && coveredTradingDates.includes(request.todayTradingDate as string);

    // Ordered by which failure most misrepresents the data if ignored.
    const reason: BarSourceIncompleteReason | null =
      forcedReason ??
      (candles.length === 0
        ? "empty_response"
        : !pagination.complete
        ? "pagination_truncated"
        : todayExpected && !todayPresent
        ? "today_session_missing"
        : coveredTradingDates.length < resolved.sessionCount
        ? "insufficient_sessions"
        : null);

    const complete = reason === null;

    return {
      candles,
      coveredTradingDates,
      complete,
      insufficientData: !complete,
      reason,
      pagination,
      expectedSessionCount: resolved.sessionCount,
      actualEligibleSessionCount: coveredTradingDates.length,
      todayExpected,
      todayPresent,
      fetchedAt: new Date(now).toISOString(),
      provider: this.provider.name,
      feed: resolved.feed,
      symbol: resolved.symbol,
      timeframe: resolved.timeframe,
      sessionScope: resolved.sessionScope,
      adjustment: resolved.adjustment,
    };
  }

  /**
   * The full baseline path: raw bars from cache (or provider), aggregated
   * over the identical elapsed window on every session present. Memoized
   * on the cutoff so repeated renders within one bar interval are free.
   */
  async getAggregation(
    request: HistoricalBarRequest,
    options: CutoffWindowOptions
  ): Promise<CutoffAggregation> {
    const resolved = this.resolve(request);
    const startMinutes = options.startMinutes ?? PRE_MARKET_START_MINUTES;
    const now = this.now();

    // The DERIVED aggregate legitimately depends on the cutoff, so this
    // second-layer key includes it — unlike the raw-bar key above.
    const key =
      `${this.barsKey(resolved)}:` +
      `${startMinutes}:${options.cutoffMinutes}:${options.intervalMinutes}`;

    const cached = this.aggregates.get(key, now);
    if (cached) return cached;

    const entry = await this.getBars(request);
    const aggregation: CutoffAggregation = {
      ...aggregateThroughCutoff(entry.candles, options, resolved.sessionScope),
      // Completeness travels with the aggregate: the window arithmetic is
      // just as correct over a truncated bar set, which is precisely why it
      // has to be carried rather than inferred.
      source: sourceStatusOf(entry),
    };

    // An aggregate is only as cacheable as the bars behind it.
    this.aggregates.set(key, aggregation, entry.complete ? this.ttlMs : this.failureTtlMs, now);
    return aggregation;
  }

  clear(): void {
    this.bars.clear();
    this.aggregates.clear();
  }

  /** Test/diagnostic visibility into how much is currently held. */
  sizes(): { bars: number; aggregates: number } {
    return { bars: this.bars.size(), aggregates: this.aggregates.size() };
  }
}

/**
 * Splits an aggregation into "today" and "the comparison baseline,"
 * which is the shape Rules A2/A3 actually consume: today's window is the
 * measurement, every strictly-earlier eligible session is the baseline.
 *
 * `insufficientData` is true whenever the baseline has fewer than
 * `minSessions` sessions — reported rather than papered over, exactly as
 * `consecutiveBullish`/`liquiditySweep` already distinguish "no data"
 * from "checked and found nothing."
 */
export interface BaselineSplit {
  today: SessionWindowAggregate | null;
  baseline: SessionWindowAggregate[];
  baselineSampleSize: number;
  excluded: ExcludedSession[];
  insufficientData: boolean;
  /**
   * Set when the underlying fetch was incomplete. A truncated bar set can
   * still yield ten or more eligible sessions and look like a perfectly
   * good sample — it just is not one, because the sessions it is missing
   * are the newest ones.
   */
  sourceIncompleteReason: BarSourceIncompleteReason | null;
}

/** Narrows a cache entry to the status half, for carrying alongside an aggregate. */
export function sourceStatusOf(entry: BarSourceStatus): BarSourceStatus {
  return {
    complete: entry.complete,
    insufficientData: entry.insufficientData,
    reason: entry.reason,
    pagination: entry.pagination,
    expectedSessionCount: entry.expectedSessionCount,
    actualEligibleSessionCount: entry.actualEligibleSessionCount,
    todayExpected: entry.todayExpected,
    todayPresent: entry.todayPresent,
    fetchedAt: entry.fetchedAt,
  };
}

export function splitBaseline(
  aggregation: CutoffAggregation,
  todayTradingDate: string,
  lookbackSessions: number = DEFAULT_LOOKBACK_SESSIONS,
  minSessions: number = MIN_BASELINE_SESSIONS
): BaselineSplit {
  const today = aggregation.sessions.find((s) => s.tradingDate === todayTradingDate) ?? null;
  const baseline = aggregation.sessions
    .filter((s) => s.tradingDate < todayTradingDate)
    .slice(-lookbackSessions);

  const sourceIncompleteReason =
    aggregation.source && !aggregation.source.complete ? aggregation.source.reason : null;

  return {
    today,
    baseline,
    baselineSampleSize: baseline.length,
    excluded: aggregation.excluded,
    // Sample size is necessary but not sufficient: bars that never arrived
    // cannot qualify a baseline however many sessions did.
    insufficientData: baseline.length < minSessions || sourceIncompleteReason !== null,
    sourceIncompleteReason,
  };
}
