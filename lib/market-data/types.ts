import type {
  Candle,
  CandleSeries,
  DataQuality,
  PaginationStatus,
  Timeframe,
} from "@/types/candle";
import type { SessionScope } from "./sessionFilter";

/**
 * Corporate-action adjustment mode. Raw and adjusted bars for the same
 * symbol and session are different numbers, so this belongs in every cache
 * identity that holds bars — an adjusted entry served to a raw request
 * shifts historical prices without any error.
 */
export type BarAdjustment = "raw" | "split" | "dividend" | "all";

export const DEFAULT_BAR_ADJUSTMENT: BarAdjustment = "raw";

export interface GetCandlesParams {
  symbol: string;
  timeframe: Timeframe;
  /** How many most-recent candles to return. */
  limit?: number;
  /**
   * Absolute epoch ms after which a provider should stop retrying and
   * fail fast instead of waiting — added specifically so a bounded
   * execution environment (e.g. the cron route's 60-second Vercel
   * function limit) can tell a provider "don't let a single retry delay
   * consume the entire remaining budget." Optional; providers without a
   * meaningful concept of retry delay (like the mock provider) simply
   * ignore it.
   */
  deadlineAt?: number;
  /**
   * Which part of the trading day the returned intraday candles should
   * cover. Omitted means `"regular"` — today's exact existing behavior,
   * so every current caller is unaffected.
   *
   * Added for Rule A2 (premarket reclaim), which genuinely needs
   * premarket bars: the provider otherwise session-scopes intraday
   * candles to regular hours and premarket data never reaches the
   * scorer. This only lets a caller ASK for a scope filterToLatestSession
   * already knows how to produce — that function's logic is untouched.
   * Providers with no session concept (mockProvider) ignore it, exactly
   * as they already ignore `deadlineAt`.
   */
  sessionScope?: SessionScope;
  /**
   * How many trading sessions of intraday candles to return, most recent
   * first-to-last. Omitted means `1` — today's exact existing behavior
   * (collapse to the single latest session), so every current caller is
   * unaffected.
   *
   * Added for the historical baselines in Rules A2/A3, which compare
   * today's elapsed premarket volume and range against the same elapsed
   * interval across the previous ~20 sessions. A single-session response
   * cannot express that at all, and asking for "more bars" via `limit`
   * is not a substitute: `limit` is a bar count applied *after* session
   * collapsing, so raising it returns more bars from one day rather than
   * bars from more days.
   *
   * Ignored for `1d` (daily bars are already one per session by
   * definition) and by providers with no session concept.
   */
  sessionCount?: number;
  /**
   * Corporate-action adjustment. Omitted means `"raw"` — today's exact
   * existing behavior, which every current caller relies on. Present so a
   * cache can key on it rather than silently mixing adjustment modes.
   */
  adjustment?: BarAdjustment;
}

export type SessionType = "pre-market" | "regular" | "after-hours" | "closed";

export interface SessionInfo {
  isOpen: boolean;
  session: SessionType;
  /** ISO timestamp of the next session open, if closed. */
  nextOpenTime: string | null;
}

/**
 * Every market-data provider (Alpaca, Polygon/Massive, Twelve Data, or the
 * mock provider) must implement this interface. The rule engine and
 * scanner service never import a specific provider directly — they only
 * depend on this shape, so swapping providers later means writing a new
 * adapter, not touching strategy code.
 */
/**
 * What a provider knows about its own feed.
 *
 * Delay is a property of the feed CONFIGURATION, never something inferred
 * from how old a bar looks — an old bar on a real-time feed is stale data,
 * not a delayed feed. Centralized on the provider so the mapping (Alpaca
 * IEX or paid → real-time; free SIP → 15-minute delay) lives in one place
 * instead of being re-derived by every consumer.
 *
 * Structurally compatible with the expansion detector's `FeedDelayInfo`,
 * deliberately: market-data concerns stay in market-data, and the
 * indicator layer keeps its own type without importing this one.
 */
export interface ProviderFeedInfo {
  /** Feed identifier used to keep cached bars from different feeds apart. */
  feed: string;
  delayed: boolean;
  /** Null means the delay is not bounded/known, which cannot clear an alert gate. */
  knownDelayMinutes: number | null;
}

export interface MarketDataProvider {
  name: string;
  getCandles(params: GetCandlesParams): Promise<CandleSeries>;
  getSessionInfo(): Promise<SessionInfo>;
  /**
   * Optional: providers with no real feed (the mock provider) omit it and
   * consumers fall back to a conservative "no known delay".
   */
  feedInfo?(): ProviderFeedInfo;
}

export function emptySeries(
  symbol: string,
  timeframe: Timeframe,
  quality: DataQuality
): CandleSeries {
  return { symbol, timeframe, quality, candles: [] };
}

export type { Candle, CandleSeries, DataQuality, PaginationStatus, Timeframe };
