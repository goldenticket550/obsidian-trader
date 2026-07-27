import type { Candle } from "@/types/candle";
import type { DataQuality } from "@/types/candle";

/**
 * The three context instruments the dashboard shows. Deliberately limited
 * to symbols the existing equity/ETF provider can genuinely return:
 * USO (oil ETF), SPY (S&P 500 ETF), IWM (Russell 2000 ETF).
 *
 * Not included, because no supported data source exists in this app:
 * market breadth, VIX, the Dollar Index, 10Y yield, spot gold, or crypto.
 * Those would each need a new provider, and inventing them is exactly the
 * failure mode this module is built to avoid.
 */
export const MARKET_CONTEXT_SYMBOLS = [
  { symbol: "USO", label: "USO ETF" },
  { symbol: "SPY", label: "SPY" },
  { symbol: "IWM", label: "IWM" },
] as const;

export interface MarketContextQuote {
  symbol: string;
  label: string;
  /** Null whenever the provider returned no usable candle. Never a placeholder. */
  price: number | null;
  /** Null unless a genuine prior-session close was available to compare against. */
  changePct: number | null;
  /** Open time of the candle the price came from, ISO. Null when unavailable. */
  asOf: string | null;
  quality: DataQuality | null;
  unavailableReason?: string;
}

/**
 * Derives a quote from a daily candle series. `changePct` requires at
 * least two daily candles — with only one we know today's price but have
 * nothing honest to compare it to, so the change stays null rather than
 * defaulting to zero (which would read as "flat" instead of "unknown").
 */
export function quoteFromDailyCandles(
  symbol: string,
  label: string,
  candles: Candle[],
  quality: DataQuality
): MarketContextQuote {
  if (candles.length === 0) {
    return {
      symbol,
      label,
      price: null,
      changePct: null,
      asOf: null,
      quality: null,
      unavailableReason: "No data returned by the market-data provider",
    };
  }

  const latest = candles[candles.length - 1];
  const prior = candles.length >= 2 ? candles[candles.length - 2] : null;
  const changePct =
    prior && prior.close !== 0 ? (latest.close - prior.close) / prior.close : null;

  return {
    symbol,
    label,
    price: latest.close,
    changePct,
    asOf: new Date(latest.time * 1000).toISOString(),
    quality,
  };
}
