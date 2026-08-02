import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";
import type { ProviderFeedInfo } from "@/lib/market-data/types";
import {
  filterToCompletedBars,
  type BarSourceIncompleteReason,
  type HistoricalBarCache,
  type HistoricalBarCacheEntry,
  type HistoricalBarRequest,
} from "@/lib/market-data/historicalBaseline";
import { assessFreshness, type ExpansionFreshness } from "@/lib/indicators/premarketExpansion";

/**
 * The shared one-minute history boundary.
 *
 * One place fetches and prepares completed 1-minute bars, so every
 * consumer sees the SAME cached data. This is deliberately NEUTRAL: it
 * returns the raw entry, the completed bars, why the data is unusable if
 * it is, and the 1-minute freshness — and nothing feature-specific. The
 * Expansion Monitor and (later) the Reclaim runner each interpret it
 * themselves.
 *
 * The cache instance is passed IN rather than owned here, so the request
 * shape and cache key stay exactly as the Expansion Monitor already
 * issues them. Extracting this must not add a single provider call.
 */

export interface CompletedOneMinuteHistory {
  /**
   * The exact cache request used. Returned so a caller needing the
   * derived aggregation reuses the identical key rather than building a
   * second one that would miss the cache.
   */
  request: HistoricalBarRequest;
  /** The raw cache entry, including its completeness metadata. */
  entry: HistoricalBarCacheEntry;
  /** Today's completed 1-minute bars. Never includes a forming bar. */
  completedOneMinuteBars: Candle[];
  /** The latest completed bar, or null when none has closed yet. */
  evaluationBar: Candle | null;
  /**
   * Why the history cannot be trusted, or null. A SHORT history is a young
   * symbol rather than lost data, so `insufficient_sessions` deliberately
   * does not block.
   */
  blockingReason: BarSourceIncompleteReason | null;
  /** Freshness of the ONE-MINUTE series specifically. */
  freshness: ExpansionFreshness;
}

export interface LoadCompletedOneMinuteArgs {
  symbol: string;
  cache: HistoricalBarCache;
  scannedAt: Date;
  todayTradingDate: string;
  feedInfo: ProviderFeedInfo;
  /**
   * Supplies `lookbackSessions` for the request and
   * `freshnessIntervalAllowance` for the freshness assessment — the
   * repository's existing definitions, not a second set of thresholds.
   */
  expansionConfig: StrategyConfig["premarketExpansion"];
  deadlineAt?: number;
}

/**
 * Fetches (or serves from cache) the 1-minute history for one symbol and
 * prepares it.
 *
 * Every step here is lifted verbatim from the Expansion Monitor's previous
 * inline implementation — the same request, the same completed-bar filter,
 * the same blocking-reason rule, the same freshness call — so the
 * extraction cannot change an Expansion result.
 */
export async function loadCompletedOneMinute(
  args: LoadCompletedOneMinuteArgs
): Promise<CompletedOneMinuteHistory> {
  const { symbol, cache, scannedAt, todayTradingDate, feedInfo, expansionConfig, deadlineAt } =
    args;

  const request: HistoricalBarRequest = {
    symbol,
    timeframe: "1m",
    sessionScope: "extended",
    sessionCount: expansionConfig.lookbackSessions + 1,
    feed: feedInfo.feed,
    adjustment: "raw",
    todayTradingDate,
    deadlineAt,
  };

  // `getBars` absorbs a provider failure into an explicitly incomplete
  // entry rather than throwing, so an unavailable 1m history arrives here
  // as empty candles with a reason — never as an exception.
  const entry = await cache.getBars(request);

  const completedOneMinuteBars = filterToCompletedBars(entry.candles, 1, scannedAt);
  const evaluationBar =
    completedOneMinuteBars.length > 0
      ? completedOneMinuteBars[completedOneMinuteBars.length - 1]
      : null;

  // Short history is a young symbol, not lost data — the same distinction
  // the five-minute baseline draws.
  const blockingReason: BarSourceIncompleteReason | null =
    entry.reason !== null && entry.reason !== "insufficient_sessions" ? entry.reason : null;

  // A 1m bar ten minutes old is stale even when the 5m series is current.
  const freshness = assessFreshness(
    scannedAt,
    evaluationBar,
    1,
    feedInfo,
    blockingReason !== null,
    expansionConfig
  );

  return { request, entry, completedOneMinuteBars, evaluationBar, blockingReason, freshness };
}
