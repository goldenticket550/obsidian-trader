import type { Candle, CandleSeries, DataQuality, Timeframe } from "@/types/candle";

export interface GetCandlesParams {
  symbol: string;
  timeframe: Timeframe;
  /** How many most-recent candles to return. */
  limit?: number;
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
