import type { SetupResult } from "@/types/setup";
import type { WatchlistSymbol } from "@/types/watchlist";
import { scoreSetup } from "@/lib/strategies/scorer";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import type { ScanInput } from "@/lib/mock/scanInputs";
import type { MarketDataProvider } from "@/lib/market-data/types";

export interface ScanOutput {
  watchlist: WatchlistSymbol[];
  resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }>;
}

function toWatchlistStatus(result: SetupResult): "red" | "yellow" | "green" {
  return result.status;
}

/**
 * Runs the setup scorer across every symbol's 5m and 15m candle series and
 * produces both the row-level watchlist summary and the full per-symbol
 * checklist results the setup detail panel needs. This is the seam where
 * Phase 4 will later swap mock candle series for a real market-data
 * provider — everything downstream of ScanInput stays the same.
 */
/** Deterministic placeholder "now" for mock/simulated scans, so results
 * don't vary between server and client renders. Phase 4 (live data) will
 * replace this with a real, client-only-computed timestamp once scanning
 * genuinely happens in real time. Exported so lib/mock/scanInputs.ts can
 * anchor its candle timestamps to the same instant instead of drifting
 * from the Unix epoch (see lib/mock/scanInputs.ts for why that matters). */
export const MOCK_SCAN_TIME = "2026-07-11T14:32:00Z";

export function scanWatchlist(
  inputs: ScanInput[],
  config: StrategyConfig = defaultStrategyConfig,
  now: string = MOCK_SCAN_TIME
): ScanOutput {
  const watchlist: WatchlistSymbol[] = [];
  const resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }> = {};

  for (const input of inputs) {
    const result5m = scoreSetup({
      symbol: input.symbol,
      timeframe: "5m",
      sessionCandles: input.sessionCandles5m,
      dailyCandles: input.dailyCandles,
      prevClose: input.prevClose,
      config,
      now,
      quality: "simulated",
    });
    const result15m = scoreSetup({
      symbol: input.symbol,
      timeframe: "15m",
      sessionCandles: input.sessionCandles15m,
      dailyCandles: input.dailyCandles,
      prevClose: input.prevClose,
      config,
      now,
      quality: "simulated",
    });

    resultsBySymbol[input.symbol] = { "5m": result5m, "15m": result15m };

    const last5m = input.sessionCandles5m[input.sessionCandles5m.length - 1];
    const currentPrice = last5m?.close ?? input.prevClose;
    const dailyChangePct =
      input.prevClose === 0 ? 0 : (currentPrice - input.prevClose) / input.prevClose;
    const sessionLow = Math.min(...input.sessionCandles5m.map((c) => c.low));
    const distanceFromSessionLowPct =
      sessionLow === 0 ? 0 : (currentPrice - sessionLow) / sessionLow;

    const hasAnyPass = result5m.conditions.some((c) => c.state === "pass");

    watchlist.push({
      ticker: input.symbol,
      exchange: input.exchange,
      price: currentPrice,
      dailyChangePct,
      distanceFromSessionLowPct,
      score5m: result5m.score,
      score15m: result15m.score,
      status5m: toWatchlistStatus(result5m),
      status15m: toWatchlistStatus(result15m),
      lastSignalTime: hasAnyPass ? result5m.lastUpdated : null,
    });
  }

  return { watchlist, resultsBySymbol };
}

export interface WatchedSymbol {
  symbol: string;
  exchange: string;
}

/**
 * Provider-driven scan: fetches real (or mock, via MockProvider) candles
 * through the MarketDataProvider interface instead of using pre-built
 * ScanInput fixtures. This is the function the /api/scan route uses —
 * strategy code (scoreSetup) is completely unaware of which provider
 * supplied the candles.
 */
export async function scanWatchlistWithProvider(
  symbols: WatchedSymbol[],
  provider: MarketDataProvider,
  config: StrategyConfig = defaultStrategyConfig,
  now: string = new Date().toISOString()
): Promise<ScanOutput> {
  const watchlist: WatchlistSymbol[] = [];
  const resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }> = {};

  for (const { symbol, exchange } of symbols) {
    const [series5m, series15m, seriesDaily] = await Promise.all([
      provider.getCandles({ symbol, timeframe: "5m", limit: 100 }),
      provider.getCandles({ symbol, timeframe: "15m", limit: 100 }),
      provider.getCandles({ symbol, timeframe: "1d", limit: 30 }),
    ]);

    const dailyCandles = seriesDaily.candles;
    // Previous close = the daily candle before today's, if available;
    // falls back to the most recent daily close, then to the current
    // 5m price, so scoring degrades gracefully instead of throwing when
    // history is thin (e.g. a newly-listed symbol or a quiet mock feed).
    const prevClose =
      dailyCandles.length >= 2
        ? dailyCandles[dailyCandles.length - 2].close
        : dailyCandles[dailyCandles.length - 1]?.close ??
          series5m.candles[series5m.candles.length - 1]?.close ??
          0;

    const result5m = scoreSetup({
      symbol,
      timeframe: "5m",
      sessionCandles: series5m.candles,
      dailyCandles,
      prevClose,
      config,
      now,
      quality: series5m.quality,
    });
    const result15m = scoreSetup({
      symbol,
      timeframe: "15m",
      sessionCandles: series15m.candles,
      dailyCandles,
      prevClose,
      config,
      now,
      quality: series15m.quality,
    });

    resultsBySymbol[symbol] = { "5m": result5m, "15m": result15m };

    const last5m = series5m.candles[series5m.candles.length - 1];
    const currentPrice = last5m?.close ?? prevClose;
    const dailyChangePct = prevClose === 0 ? 0 : (currentPrice - prevClose) / prevClose;
    const lows5m = series5m.candles.map((c) => c.low);
    const sessionLow = lows5m.length > 0 ? Math.min(...lows5m) : currentPrice;
    const distanceFromSessionLowPct =
      sessionLow === 0 ? 0 : (currentPrice - sessionLow) / sessionLow;
    const hasAnyPass = result5m.conditions.some((c) => c.state === "pass");

    watchlist.push({
      ticker: symbol,
      exchange,
      price: currentPrice,
      dailyChangePct,
      distanceFromSessionLowPct,
      score5m: result5m.score,
      score15m: result15m.score,
      status5m: toWatchlistStatus(result5m),
      status15m: toWatchlistStatus(result15m),
      lastSignalTime: hasAnyPass ? result5m.lastUpdated : null,
    });
  }

  return { watchlist, resultsBySymbol };
}
