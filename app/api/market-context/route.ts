import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMarketDataProvider } from "@/lib/market-data/providerFactory";
import {
  MARKET_CONTEXT_SYMBOLS,
  quoteFromDailyCandles,
  type MarketContextQuote,
} from "@/lib/market-data/marketContext";

/**
 * Broad-market context for the dashboard's left column.
 *
 * Uses daily candles specifically: recent daily bars give the current
 * price, a real prior-session close, and an honest compact trend trace. The
 * daily cache TTL (5 minutes) is the longest in the app — so this endpoint
 * adds at most 5 provider calls per 5 minutes, which is negligible against
 * the 200/min free-tier budget the scanner also shares.
 *
 * Each symbol is fetched independently: one failing instrument reports as
 * unavailable rather than blanking the whole panel, matching how the
 * scanner isolates per-symbol failures.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const provider = getMarketDataProvider();

  const quotes: MarketContextQuote[] = await Promise.all(
    MARKET_CONTEXT_SYMBOLS.map(async ({ symbol, label }) => {
      try {
        const series = await provider.getCandles({ symbol, timeframe: "1d", limit: 12 });
        return quoteFromDailyCandles(symbol, label, series.candles, series.quality);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return {
          symbol,
          label,
          price: null,
          changePct: null,
          asOf: null,
          quality: null,
          sparkline: [],
          unavailableReason: message,
        };
      }
    })
  );

  return NextResponse.json({ provider: provider.name, quotes });
}
