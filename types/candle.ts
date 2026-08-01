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

/**
 * "1m" exists for early-detection work only (Expansion Monitor Phase 1):
 * one-minute bars drive the unconfirmed acceleration heads-up, while
 * every confirmation/structure decision still runs on 5m. The setup
 * timeframe toggle deliberately does NOT offer it — UI call sites narrow
 * to `"5m" | "15m"` explicitly, so widening this union cannot leak a
 * 1-minute option into the dashboard.
 */
export type Timeframe = "1m" | "5m" | "15m" | "1d";

/**
 * Marks whether a batch of candles is real-time, delayed, or simulated.
 * The UI must always surface this so the user never mistakes mock data
 * for a live feed.
 */
export type DataQuality = "simulated" | "delayed" | "realtime";

/**
 * Whether a provider actually returned everything the request asked for.
 *
 * Necessary because providers paginate OLDEST-FIRST: a response cut short
 * loses the NEWEST bars, including today's, while still looking like a
 * perfectly ordinary array. A consumer that cannot tell the difference
 * will build a baseline out of a window that silently stops days ago.
 */
export interface PaginationStatus {
  /** True only when the page chain ended with no token left to follow. */
  complete: boolean;
  pagesFetched: number;
  nextPageTokenRemaining: boolean;
  truncationReason: "page_cap_reached" | "deadline_reached" | "provider_error" | null;
}

export interface CandleSeries {
  symbol: string;
  timeframe: Timeframe;
  quality: DataQuality;
  candles: Candle[];
  /**
   * Optional: providers with no pagination concept (the mock provider)
   * omit it. Absent means "not reported", never "known to be complete".
   */
  pagination?: PaginationStatus;
}
