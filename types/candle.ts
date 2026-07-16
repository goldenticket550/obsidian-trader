/**
 * A single OHLCV candle. All prices are plain numbers (USD).
 * `time` is a Unix timestamp in seconds (UTC), matching most market-data APIs
 * and TradingView's lightweight-charts convention.
 */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = "5m" | "15m" | "1d";

/**
 * Marks whether a batch of candles is real-time, delayed, or simulated.
 * The UI must always surface this so the user never mistakes mock data
 * for a live feed.
 */
export type DataQuality = "simulated" | "delayed" | "realtime";

export interface CandleSeries {
  symbol: string;
  timeframe: Timeframe;
  quality: DataQuality;
  candles: Candle[];
}
