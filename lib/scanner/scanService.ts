import type { SetupResult } from "@/types/setup";
import type { WatchlistSymbol } from "@/types/watchlist";
import { scoreSetup } from "@/lib/strategies/scorer";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import type { ScanInput } from "@/lib/mock/scanInputs";
import type { MarketDataProvider } from "@/lib/market-data/types";
import { findPreviousClose } from "@/lib/market-data/sessionFilter";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";
import { getSessionTypeForTimestamp } from "@/lib/market-data/session";
import { resolveBenchmarkSymbol } from "@/lib/indicators/benchmarkAlignment";
import type { Candle } from "@/types/candle";

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
  now: string = new Date().toISOString(),
  /**
   * Absolute epoch ms after which providers should stop retrying and
   * fail fast (see GetCandlesParams.deadlineAt) — pass this from
   * bounded-execution callers like the cron route so a single symbol's
   * retry delays can't consume the entire route's time budget and starve
   * every later symbol/user.
   */
  deadlineAt?: number
): Promise<ScanOutput> {
  const watchlist: WatchlistSymbol[] = [];
  const resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }> = {};
  const errors: { symbol: string; message: string }[] = [];
  const todayTradingDate = getCurrentTradingDate(new Date(now));

  // Scoped to THIS scan cycle, so benchmark data can never go stale
  // across cycles while still being fetched only once within one.
  const benchmarkCache = new Map<string, Candle[]>();

  for (const { symbol, exchange } of symbols) {
    // FIX (Codex review): one bad symbol (rate limit, malformed ticker,
    // transient network error) used to throw and take down the ENTIRE
    // scan, silently losing every other symbol's real data too.
    // Isolating each symbol's work in its own try/catch means a single
    // failure is reported and skipped, not fatal to everyone else.
    try {
      const [series5m, series15m, seriesDaily, seriesPremarket] = await Promise.all([
        provider.getCandles({ symbol, timeframe: "5m", limit: 100, deadlineAt }),
        provider.getCandles({ symbol, timeframe: "15m", limit: 100, deadlineAt }),
        provider.getCandles({ symbol, timeframe: "1d", limit: 30, deadlineAt }),
        // Rule A2 needs premarket bars, which the default "regular" scope
        // filters out entirely. Requested explicitly here rather than by
        // changing any default, so every other caller is unaffected.
        provider.getCandles({
          symbol,
          timeframe: "5m",
          limit: 100,
          deadlineAt,
          sessionScope: "extended",
        }),
      ]);

      // Rule D efficiency requirement: one fetch per UNIQUE benchmark per
      // scan cycle, reused across every symbol mapped to it — five
      // semiconductor names sharing SMH must not issue five SMH requests.
      const benchmarkSymbol = resolveBenchmarkSymbol(symbol, config.benchmarkAlignment);
      const benchmarkCandles = await getBenchmarkCandles(
        benchmarkSymbol,
        provider,
        benchmarkCache,
        deadlineAt
      );

      const premarketCandles = premarketOnly(seriesPremarket.candles, todayTradingDate);

      const dailyCandles = seriesDaily.candles;

      // FIX (Codex round 3): previous-close ambiguity. findPreviousClose()
      // determines this explicitly by trading date instead of by array
      // position, so it's correct whether or not today's daily bar has
      // posted yet.
      //
      // FIX (Codex round 4): the old fallback, when findPreviousClose()
      // returned null, substituted the latest daily candle's close —
      // which could BE today's own (partial) bar, silently mislabeling
      // "no previous close available" as "today equals yesterday" and
      // corrupting decline-from-previous-close. Now genuinely unavailable
      // history is treated as a real per-symbol failure (caught below,
      // reported in `errors`, same mechanism as any other provider
      // failure) rather than silently substituting a wrong value.
      const prevClose = findPreviousClose(dailyCandles, todayTradingDate);
      if (prevClose === null) {
        throw new Error(
          `Insufficient daily history to determine previous close for ${symbol} ` +
            `(need at least one daily candle from before ${todayTradingDate})`
        );
      }

      const result5m = scoreSetup({
        symbol,
        timeframe: "5m",
        sessionCandles: series5m.candles,
        dailyCandles,
        prevClose,
        config,
        now,
        quality: series5m.quality,
        premarketCandles,
        benchmarkCandles,
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
        premarketCandles,
        benchmarkCandles,
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

/**
 * Rule D's efficiency requirement: fetch each unique benchmark ONCE per
 * scan cycle and reuse it for every symbol mapped to it. Five
 * semiconductor names all resolving to SMH must produce one SMH request,
 * not five — a real rate-limit consideration, not optional polish.
 *
 * A failed benchmark fetch is cached as an empty array rather than
 * retried per symbol: the benchmark being unavailable is not a reason to
 * fail the whole symbol's scan, and detectBenchmarkAlignment turns an
 * empty series into insufficientData ("unknown"), never "not aligned".
 */
async function getBenchmarkCandles(
  benchmarkSymbol: string,
  provider: MarketDataProvider,
  cache: Map<string, Candle[]>,
  deadlineAt?: number
): Promise<Candle[]> {
  const cached = cache.get(benchmarkSymbol);
  if (cached) return cached;

  try {
    const series = await provider.getCandles({
      symbol: benchmarkSymbol,
      timeframe: "5m",
      limit: 100,
      deadlineAt,
    });
    cache.set(benchmarkSymbol, series.candles);
    return series.candles;
  } catch {
    cache.set(benchmarkSymbol, []);
    return [];
  }
}

/**
 * Narrows an "extended"-scoped series to TODAY's premarket window only.
 *
 * The extended scope also carries regular and after-hours bars, and
 * (like every other session-scoped series here) can span more than one
 * date near a session boundary. Rule A2 is specifically about today's
 * premarket, so both filters are applied rather than assuming the
 * provider already narrowed it.
 */
function premarketOnly(candles: Candle[], todayTradingDate: string): Candle[] {
  return candles.filter((c) => {
    const at = new Date(c.time * 1000);
    if (getSessionTypeForTimestamp(at) !== "pre-market") return false;
    return getCurrentTradingDate(at) === todayTradingDate;
  });
}
