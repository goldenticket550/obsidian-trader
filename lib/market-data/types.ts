import type { Candle, CandleSeries, DataQuality, Timeframe } from "@/types/candle";
import type { SessionScope } from "./sessionFilter";

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
export interface MarketDataProvider {
  name: string;
  getCandles(params: GetCandlesParams): Promise<CandleSeries>;
  getSessionInfo(): Promise<SessionInfo>;
}

export function emptySeries(
  symbol: string,
  timeframe: Timeframe,
  quality: DataQuality
): CandleSeries {
  return { symbol, timeframe, quality, candles: [] };
}

export type { Candle, CandleSeries, DataQuality, Timeframe };
