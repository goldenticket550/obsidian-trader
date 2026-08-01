import type { Timeframe } from "@/types/candle";

const TIMEFRAME_TO_TV_INTERVAL: Record<Timeframe, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1d": "D",
};

/**
 * Builds a direct TradingView chart URL. This never reads from a
 * TradingView account or API — it only constructs a public chart link
 * to open in a new tab.
 */
export function buildTradingViewUrl(
  ticker: string,
  exchange: string,
  timeframe: Timeframe = "5m"
): string {
  const symbol = `${exchange}:${ticker}`.toUpperCase();
  const interval = TIMEFRAME_TO_TV_INTERVAL[timeframe];
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}`;
}
