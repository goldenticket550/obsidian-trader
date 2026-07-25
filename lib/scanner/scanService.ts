import type { SetupResult } from "@/types/setup";
import type { WatchlistSymbol } from "@/types/watchlist";
import { scoreSetup } from "@/lib/strategies/scorer";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import type { ScanInput } from "@/lib/mock/scanInputs";
import type { MarketDataProvider } from "@/lib/market-data/types";
import { findPreviousClose } from "@/lib/market-data/sessionFilter";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";

export interface ScanOutput {
  watchlist: WatchlistSymbol[];
  resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }>;
  /**
   * Symbols that failed to scan (provider errors, bad tickers, etc).
   * FIX (Codex review): previously one bad symbol's error would throw
   * and take down the ENTIRE scan, silently losing every other symbol's
   * real data too. Now a failed symbol is reported here and simply
   * excluded from watchlist/resultsBySymbol — it never falls back to
   * fabricated/simulated data pretending to be real.
   */
  errors: { symbol: string; message: string }[];
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
 * genuinely happens in real time.
 *
 * Must stay exported: lib/mock/scanInputs.ts imports this exact same
 * value to anchor its mock candle series to a real, non-1970 date (see
 * anchorToMockNow() there). Making this private again would either break
 * that anchoring fix or force a duplicated, driftable copy of this
 * timestamp in two files — export it, don't inline a second constant. */
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

  return { watchlist, resultsBySymbol, errors: [] };
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
  const errors: { symbol: string; message: string }[] = [];
  const todayTradingDate = getCurrentTradingDate(new Date(now));

  for (const { symbol, exchange } of symbols) {
    // FIX (Codex review): one bad symbol (rate limit, malformed ticker,
    // transient network error) used to throw and take down the ENTIRE
    // scan, silently losing every other symbol's real data too.
    // Isolating each symbol's work in its own try/catch means a single
    // failure is reported and skipped, not fatal to everyone else.
    try {
      const [series5m, series15m, seriesDaily] = await Promise.all([
        provider.getCandles({ symbol, timeframe: "5m", limit: 100 }),
        provider.getCandles({ symbol, timeframe: "15m", limit: 100 }),
        provider.getCandles({ symbol, timeframe: "1d", limit: 30 }),
      ]);

      const dailyCandles = seriesDaily.candles;

      // FIX (Codex review): previous-close ambiguity. The old logic
      // assumed the second-to-last daily candle was always "yesterday,"
      // which only holds when the last daily candle represents today.
      // findPreviousClose() determines this explicitly by trading date
      // instead of by array position, so it's correct whether or not
      // today's daily bar has been posted yet.
      const prevClose =
        findPreviousClose(dailyCandles, todayTradingDate) ??
        dailyCandles[dailyCandles.length - 1]?.close ??
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scan error";
      errors.push({ symbol, message });
      // Deliberately do NOT push a watchlist row or a resultsBySymbol
      // entry for this symbol — no fabricated/simulated data pretending
      // to be real. The caller sees this symbol is simply absent, plus
      // the explicit error explaining why.
    }
  }

  return { watchlist, resultsBySymbol, errors };
}
