import type { SetupEvidence, SetupResult } from "@/types/setup";
import type { WatchlistSymbol } from "@/types/watchlist";
import { scoreSetup } from "@/lib/strategies/scorer";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import type { ScanInput } from "@/lib/mock/scanInputs";
import type { MarketDataProvider, ProviderFeedInfo } from "@/lib/market-data/types";
import { findPreviousClose, findPreviousDailyCandle } from "@/lib/market-data/sessionFilter";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";
import {
  getSessionTypeForTimestamp,
  PRE_MARKET_START_MINUTES,
} from "@/lib/market-data/session";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import { resolveBenchmarkSymbol } from "@/lib/indicators/benchmarkAlignment";
import { calculateAtr } from "@/lib/indicators/atr";
import {
  clampToPremarketCutoff,
  collectTimeOfDayBars,
  computeCompletedBarCutoff,
  filterToCompletedBars,
  median,
  splitBaseline,
  HistoricalBarCache,
  type BarSourceIncompleteReason,
} from "@/lib/market-data/historicalBaseline";
import {
  assessFreshness,
  computePremarketRanges,
  detectPremarketExpansion,
  freshnessAllowsNewCandidate,
  type PremarketExpansionResult,
} from "@/lib/indicators/premarketExpansion";
import {
  evaluateExpansionMonitor,
  type SymbolExpansionMonitor,
} from "./expansionMonitor";
import {
  loadCompletedOneMinute,
  type CompletedOneMinuteHistory,
} from "./oneMinuteHistory";
import {
  runReclaimForSymbol,
  type DirectionalLevel,
  type ReclaimSymbolResult,
} from "./reclaimRunner";
import type { ReclaimSweepEvidence } from "./reclaimContinuation";
import {
  buildReclaimTimeframeSeries,
  findOpeningRangeAvailableFromIndex,
  RECLAIM_FIVE_MINUTE_ATR_PERIOD,
  RECLAIM_OPENING_RANGE_MINUTES,
} from "./reclaimTimeframe";
import { computeOpeningRange } from "./expansionMonitor";
import type { Candle } from "@/types/candle";

/** Both directions of the Premarket Expansion Candidate for one symbol. */
export interface SymbolExpansion {
  bullish: PremarketExpansionResult;
  bearish: PremarketExpansionResult;
}

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
  /**
   * Premarket Expansion Candidate results, per symbol, in both
   * directions. A SEPARATE setup type, evaluated independently of the
   * reversal checklist — it never contributes to `resultsBySymbol` or to
   * a symbol's score.
   *
   * Optional so every existing consumer, route and test is unaffected:
   * absent means the evaluation was disabled or could not run, never that
   * a symbol was found uninteresting.
   */
  expansionBySymbol?: Record<string, SymbolExpansion>;
  /**
   * The ONE-MINUTE Expansion Monitor layer: early acceleration, the
   * dollar-volume context, the momentum ladder, and the stage resolved
   * with live impulse taken into account.
   *
   * Separate from `expansionBySymbol` and equally optional — it carries
   * its own provider cost and its own enable flag, and a symbol can have
   * a five-minute candidate with no usable one-minute history.
   */
  expansionMonitorBySymbol?: Record<string, SymbolExpansionMonitor>;
  /**
   * Symbols whose expansion evaluation failed. Deliberately NOT merged
   * into `errors`, which means "this symbol was excluded from the scan
   * entirely" — an expansion failure costs a symbol nothing but its
   * expansion result.
   */
  expansionErrors?: { symbol: string; message: string }[];
  /**
   * Reclaim & Continuation results, per symbol.
   *
   * DISPLAY-ONLY in this phase: the runner derives a tier from rules, but
   * `alertingEnabled` is false and no Reclaim alert path exists yet, so
   * nothing here emits, queues, or notifies.
   *
   * Optional and additive, like the Expansion fields — absent means "not
   * evaluated", never "evaluated and found nothing".
   */
  reclaimBySymbol?: Record<string, ReclaimSymbolResult>;
  /** Symbols whose Reclaim evaluation failed. Never merged into `errors`. */
  reclaimErrors?: { symbol: string; message: string }[];
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
 * The historical raw-bar cache, held at MODULE level so its ~15-minute TTL
 * actually amortizes across scan cycles.
 *
 * A per-call instance would refetch ~21 sessions of bars for every symbol
 * on every cycle and defeat the entire point of the cache — at a 60-second
 * refresh that is fifteen times the necessary provider load. On a warm
 * serverless instance this persists; a cold start refills it, which is
 * acceptable and self-correcting.
 *
 * Keyed on the provider instance so a test (or a provider swap) never
 * serves one provider's bars from another's cache.
 */
let baselineCache: HistoricalBarCache | null = null;
let baselineCacheProvider: MarketDataProvider | null = null;

function getBaselineCache(provider: MarketDataProvider): HistoricalBarCache {
  if (baselineCache === null || baselineCacheProvider !== provider) {
    baselineCache = new HistoricalBarCache(provider);
    baselineCacheProvider = provider;
  }
  return baselineCache;
}

/** For tests — drops the cached bars so each case starts from a known state. */
export function resetExpansionBaselineCache(): void {
  baselineCache = null;
  baselineCacheProvider = null;
}

/**
 * The FIVE-minute ATR both Reclaim machines measure against.
 *
 * Computed from the completed five-minute series with the repository's
 * existing ATR helper. Deliberately NOT the daily ATR the Expansion path
 * uses — a daily yardstick would make "0.35 ATR" mean an entirely
 * different dollar amount on a five-minute chart.
 *
 * Returns NaN when it cannot be computed, which the detector reports as
 * unavailable rather than substituting a fallback.
 */
function fiveMinuteAtr(candles: Candle[]): number {
  const series = calculateAtr(candles, RECLAIM_FIVE_MINUTE_ATR_PERIOD);
  const last = series[series.length - 1];
  return Number.isFinite(last) ? last : Number.NaN;
}

/**
 * The tracked level PRICES Reclaim measures against, each as a high/low
 * pair. Availability INDICES are handled separately by
 * `buildReclaimTimeframeSeries`.
 *
 * Every value here comes from a computation the scan already performs, or
 * from the same exported helper the existing feature uses, so a level can
 * never drift from its established definition. Anything without a real
 * source is null — never zero, never a guess.
 */
function reclaimLevelsFor(args: {
  dailyCandles: Candle[];
  todayTradingDate: string;
  completedPremarketCandles: Candle[];
  openingRangeCandles: Candle[];
  minReferenceBars: number;
}): {
  priorDayLevel: DirectionalLevel | null;
  premarketLevel: DirectionalLevel | null;
  openingRangeLevel: DirectionalLevel | null;
} {
  // Prior day: the most recent fully-closed prior session, located by DATE
  // via the existing helper rather than by array position — during market
  // hours the last daily element is today's still-forming bar.
  const prior = findPreviousDailyCandle(args.dailyCandles, args.todayTradingDate);

  // Premarket: the existing premarket-range computation. `sessionHigh` /
  // `sessionLow` span all completed premarket bars, which is exactly the
  // premarket high/low the Expansion path already reports.
  const ranges = computePremarketRanges(args.completedPremarketCandles, args.minReferenceBars);

  // Opening range: the existing helper, given RECLAIM's own window. Null
  // until the window has actually closed, so a partial range is never
  // presented as a level.
  const openingRangeComplete =
    findOpeningRangeAvailableFromIndex(args.openingRangeCandles) !== null;
  const openingRange = openingRangeComplete
    ? computeOpeningRange(args.openingRangeCandles, RECLAIM_OPENING_RANGE_MINUTES)
    : null;

  return {
    priorDayLevel: prior === null ? null : { high: prior.high, low: prior.low },
    premarketLevel:
      ranges.sessionHigh === null || ranges.sessionLow === null
        ? null
        : { high: ranges.sessionHigh, low: ranges.sessionLow },
    openingRangeLevel:
      openingRange === null ? null : { high: openingRange.high, low: openingRange.low },
  };
}

/**
 * The structure level Reclaim measures against, taken from the
 * structure-shift result the scorer already computed.
 *
 * `triggerSwingHigh` is a swing HIGH — the level a bullish shift has to
 * close above. It is resistance, so it belongs on the bullish side only.
 * The repo's structure-shift detector has no bearish mirror, so `low`
 * stays null rather than borrowing the high and relabelling it support.
 */
function structureLevelFrom(evidence: SetupEvidence | undefined): {
  structureLevel: DirectionalLevel | null;
  structureAvailableFromTime: number | null;
} {
  const structure = evidence?.structureShift;
  const unavailable = { structureLevel: null, structureAvailableFromTime: null };
  if (!structure) return unavailable;

  // A swing high is derived from a PIVOT, which exists only once the bars
  // to its right have completed — so `triggerSwingHigh` on its own is a
  // hindsight price with no honest availability bound. The pivot's own
  // index is not part of StructureShiftResult, so the only availability
  // time this repo actually exposes is `shiftCandleTime`: the bar that
  // closed above the level and thereby confirmed the shift. By then the
  // level is certainly knowable.
  //
  // That is CONSERVATIVE, not exact — the level was usually knowable a few
  // bars earlier. A level is therefore supplied only for a CONFIRMED
  // shift. While the shift is still "waiting", `triggerSwingHigh` is
  // populated but nothing tells us when it became real, and a level whose
  // availability is unknown is treated as unavailable rather than trusted.
  if (structure.state !== "confirmed") return unavailable;
  if (structure.triggerSwingHigh === null || structure.shiftCandleTime === null) {
    return unavailable;
  }

  return {
    // The swing high is RESISTANCE, so it is the bullish side only. The
    // repo has no bearish structure detector, so `low` stays null.
    structureLevel: { high: structure.triggerSwingHigh, low: null },
    structureAvailableFromTime: structure.shiftCandleTime,
  };
}

/**
 * The sweep evidence Reclaim consumes, taken from the liquidity-sweep
 * result the scorer already computed.
 *
 * The detector is BULLISH-only, so the direction is a constant here, not
 * an inference. A bearish sweep stays null until a real bearish detector
 * exists — the alternative would be presenting a bullish sweep as bearish
 * evidence, which is worse than having none.
 *
 * Every field is required by `ReclaimSweepEvidence`, so a sweep is only
 * mapped when all three are actually present — a partial sweep is not a
 * sweep.
 */
function sweepEvidenceFrom(evidence: SetupEvidence | undefined): ReclaimSweepEvidence | null {
  const sweep = evidence?.liquiditySweep;
  if (!sweep || !sweep.passed) return null;
  if (
    sweep.sweptLevel === null ||
    sweep.sweepCandleTime === null ||
    sweep.reclaimCandleTime === null
  ) {
    return null;
  }
  return {
    direction: "bullish",
    sweptLevel: sweep.sweptLevel,
    sweepCandleTime: sweep.sweepCandleTime,
    reclaimCandleTime: sweep.reclaimCandleTime,
  };
}

/** A provider with no feed concept is treated as having no KNOWN delay. */
function resolveFeedInfo(provider: MarketDataProvider): ProviderFeedInfo {
  return provider.feedInfo?.() ?? { feed: provider.name, delayed: false, knownDelayMinutes: null };
}

/** Everything the benchmark contributes, fetched once per unique benchmark per cycle. */
interface BenchmarkBundle {
  /** Regular-hours 5m bars — what Rule D's benchmark alignment already used. */
  regular: Candle[];
  /** Today's completed premarket 5m bars, for relative premarket performance. */
  premarket: Candle[];
  daily: Candle[];
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
  const expansionBySymbol: Record<string, SymbolExpansion> = {};
  const expansionMonitorBySymbol: Record<string, SymbolExpansionMonitor> = {};
  const expansionErrors: { symbol: string; message: string }[] = [];
  const reclaimBySymbol: Record<string, ReclaimSymbolResult> = {};
  const reclaimErrors: { symbol: string; message: string }[] = [];
  const todayTradingDate = getCurrentTradingDate(new Date(now));

  // Scoped to THIS scan cycle, so benchmark data can never go stale
  // across cycles while still being fetched only once within one.
  const benchmarkCache = new Map<string, BenchmarkBundle>();

  const expansionEnabled = config.premarketExpansion.enabled;
  // The one-minute layer is gated separately: it carries its own provider
  // load, so it must be switchable off without disabling the candidate.
  const monitorEnabled = expansionEnabled && config.premarketExpansion.monitorEnabled;
  // Deliberately independent of the Expansion flags: Reclaim is a separate
  // setup type and must not require Expansion to be on.
  const reclaimEnabled = config.reclaimContinuation.enabled;
  // One raw 1m history serves both consumers. Fetched when either needs
  // it, never twice, and not at all when neither does.
  const needsOneMinuteHistory = monitorEnabled || reclaimEnabled;
  const feedInfo = resolveFeedInfo(provider);

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
      const benchmark = await getBenchmarkBundle(
        benchmarkSymbol,
        provider,
        benchmarkCache,
        todayTradingDate,
        now,
        expansionEnabled,
        deadlineAt
      );
      const benchmarkCandles = benchmark.regular;

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

      // The shared one-minute history: loaded at most ONCE per symbol,
      // whenever EITHER consumer needs it.
      //
      // Both consumers read the same completed bars independently, so two
      // consumers cost one fetch, not two — and Reclaim does not depend on
      // the Expansion monitor being on to have a one-minute scout.
      let oneMinuteHistory: CompletedOneMinuteHistory | null = null;
      if (needsOneMinuteHistory) {
        try {
          oneMinuteHistory = await loadCompletedOneMinute({
            symbol,
            cache: getBaselineCache(provider),
            scannedAt: new Date(now),
            todayTradingDate,
            feedInfo,
            expansionConfig: config.premarketExpansion,
            deadlineAt,
          });
        } catch {
          // Absorbed: both consumers treat a missing 1m history as
          // unavailable rather than as an absence of signal.
          oneMinuteHistory = null;
        }
      }

      // The Premarket Expansion Candidate is a SEPARATE setup type, so it
      // gets its own try/catch INSIDE this symbol's. A baseline fetch that
      // fails, or a config that will not validate, must cost this symbol
      // its expansion result and nothing else — the reversal rows above
      // are already committed and stay exactly as they are.
      if (expansionEnabled) {
        let expansion: SymbolExpansion | null = null;
        try {
          expansion = await evaluateExpansion({
            symbol,
            provider,
            config,
            now,
            todayTradingDate,
            extendedCandles: seriesPremarket.candles,
            confirmationCandles: series5m.candles,
            dailyCandles,
            benchmarkSymbol,
            benchmark,
            feedInfo,
            deadlineAt,
          });
          expansionBySymbol[symbol] = expansion;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown expansion evaluation error";
          expansionErrors.push({ symbol, message });
        }

        // The one-minute layer gets its OWN try/catch, nested one level
        // deeper again: a 1m history that cannot be fetched must cost this
        // symbol only its monitor data — not its five-minute candidate,
        // and certainly not its reversal row.
        if (monitorEnabled && expansion !== null && oneMinuteHistory !== null) {
          try {
            expansionMonitorBySymbol[symbol] = await evaluateMonitor({
              symbol,
              provider,
              config,
              now,
              todayTradingDate,
              expansion,
              regularSessionCandles: series5m.candles,
              dailyCandles,
              feedInfo,
              oneMinuteHistory,
              deadlineAt,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "Unknown expansion monitor error";
            expansionErrors.push({ symbol, message });
          }
        }
      }

      // Reclaim & Continuation — EVALUATION MODE.
      //
      // A separate setup type again, with its own try/catch at the same
      // depth as Expansion's: any error in here costs this symbol its
      // Reclaim field and nothing else. Deliberately independent of
      // Expansion — it does not require a candidate to have qualified,
      // and it runs whether or not Expansion is enabled.
      //
      // Display-only: the runner computes a rules-derived tier, and this
      // phase emits NO alert of any kind. `alertingEnabled` is the only
      // switch that could ever change that, and no alert path exists yet.
      if (reclaimEnabled) {
        try {
          reclaimBySymbol[symbol] = runReclaimForSymbol(
            {
              symbol,
              sessionDate: todayTradingDate,
              fiveMinute: buildReclaimTimeframeSeries(series5m.candles),
              // Reuses the ALREADY-FETCHED one-minute bars; null when no
              // 1m history is available, which the runner reports as an
              // unavailable scout rather than as "found nothing".
              oneMinute:
                oneMinuteHistory === null
                  ? null
                  : buildReclaimTimeframeSeries(oneMinuteHistory.completedOneMinuteBars),
              atr: fiveMinuteAtr(series5m.candles),
              // Sourced only from what this scan already computed. Every
              // field without a real source is null — never zero, and
              // never invented.
              ...reclaimLevelsFor({
                dailyCandles,
                todayTradingDate,
                completedPremarketCandles: filterToCompletedBars(
                  premarketCandles,
                  5,
                  new Date(now)
                ),
                // Prefer the one-minute bars when they exist — the window
                // is defined in one-minute candles — and fall back to the
                // completed five-minute series, whose 9:30 bar spans the
                // identical clock window.
                openingRangeCandles:
                  oneMinuteHistory?.completedOneMinuteBars ??
                  filterToCompletedBars(series5m.candles, 5, new Date(now)),
                minReferenceBars: config.premarketExpansion.minReferenceBars,
              }),
              // Read off the SetupResult already scored above, from the
              // SAME five-minute candles this runner is given. No detector
              // is called a second time.
              ...structureLevelFrom(result5m.evidence),
              sweepEvidence: sweepEvidenceFrom(result5m.evidence),
              freshness: oneMinuteHistory?.freshness.status ?? null,
              volumePace: null,
              benchmarkRelativeMove: null,
              previousSetupKeys: undefined,
            },
            config.reclaimContinuation
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown reclaim evaluation error";
          reclaimErrors.push({ symbol, message });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scan error";
      errors.push({ symbol, message });
      // Deliberately do NOT push a watchlist row or a resultsBySymbol
      // entry for this symbol — no fabricated/simulated data pretending
      // to be real. The caller sees this symbol is simply absent, plus
      // the explicit error explaining why.
    }
  }

  return {
    watchlist,
    resultsBySymbol,
    errors,
    // Omitted entirely rather than emitted empty when the feature is off,
    // so an absent field never reads as "evaluated, found nothing".
    ...(expansionEnabled ? { expansionBySymbol } : {}),
    ...(monitorEnabled ? { expansionMonitorBySymbol } : {}),
    ...(expansionErrors.length > 0 ? { expansionErrors } : {}),
    ...(reclaimEnabled ? { reclaimBySymbol } : {}),
    ...(reclaimErrors.length > 0 ? { reclaimErrors } : {}),
  };
}

interface MonitorEvaluationArgs {
  symbol: string;
  provider: MarketDataProvider;
  config: StrategyConfig;
  now: string;
  todayTradingDate: string;
  expansion: SymbolExpansion;
  /** Today's regular-session 5m candles — the momentum ladder's anchor. */
  regularSessionCandles: Candle[];
  dailyCandles: Candle[];
  feedInfo: ProviderFeedInfo;
  /**
   * The shared one-minute history, loaded ONCE per symbol by the caller so
   * that every consumer reads the same cached bars. Passing it in rather
   * than loading it here is what lets Reclaim reuse it without either
   * feature depending on the other being enabled.
   */
  oneMinuteHistory: CompletedOneMinuteHistory;
  deadlineAt?: number;
}

/**
 * Builds the one-minute layer for a symbol.
 *
 * The 1m history is fetched through the SAME `HistoricalBarCache` as the
 * 5m baseline, so it inherits the completeness plumbing wholesale: a
 * truncated page chain or a missing session is reported rather than
 * silently returning a short window, and the same rule applies about which
 * reasons actually block — a young symbol is not a truncated one.
 */
async function evaluateMonitor(args: MonitorEvaluationArgs): Promise<SymbolExpansionMonitor> {
  const {
    symbol,
    provider,
    config,
    now,
    todayTradingDate,
    expansion,
    regularSessionCandles,
    dailyCandles,
    feedInfo,
    oneMinuteHistory,
  } = args;

  const scannedAt = new Date(now);
  const expansionConfig = config.premarketExpansion;
  const cache = getBaselineCache(provider);

  // Already loaded once for this symbol by the caller — same request, same
  // cache key, same completed-bar filter and freshness rule as before.
  const { request, entry, completedOneMinuteBars, evaluationBar, blockingReason, freshness } =
    oneMinuteHistory;

  const minuteOfDay =
    evaluationBar === null
      ? null
      : getEasternTimeParts(new Date(evaluationBar.time * 1000)).minutesSinceMidnight;

  // The baseline for a 1m shock is MATCHING minute-of-day bars from prior
  // sessions — a cumulative figure cannot answer "is this 9:31 bar unusual
  // for a 9:31 bar".
  const timeOfDayBaseline =
    minuteOfDay === null
      ? []
      : collectTimeOfDayBars(entry.candles, minuteOfDay, todayTradingDate, "extended");

  const cumulativeBaselineMedian = await loadCumulativeDollarVolumeMedian({
    cache,
    request,
    candles: entry.candles,
    scannedAt,
    todayTradingDate,
    expansionConfig,
  });

  const atrSeries = calculateAtr(dailyCandles, config.extension.atrPeriod);
  const lastAtr = atrSeries[atrSeries.length - 1];

  return evaluateExpansionMonitor(
    {
      symbol,
      completedOneMinuteBars,
      timeOfDayBaseline,
      cumulativeBaselineMedian,
      regularSessionCandles,
      bullishExpansion: expansion.bullish,
      bearishExpansion: expansion.bearish,
      dailyAtr: Number.isFinite(lastAtr) ? lastAtr : null,
      feed: feedInfo,
      freshness: freshness.status,
      freshnessPermitsAlerting: freshnessAllowsNewCandidate(freshness.status, feedInfo),
      oneMinuteInsufficientData: blockingReason !== null || evaluationBar === null,
      oneMinuteReason: blockingReason ?? (evaluationBar === null ? "no_completed_bar" : null),
    },
    config
  );
}

/**
 * Median cumulative dollar volume across prior sessions, over the same
 * elapsed window today has run.
 *
 * Deliberately NOT clamped to the premarket open: this figure is the
 * denominator for "today's cumulative dollar volume so far", which keeps
 * accumulating through the regular session. Routed through the cache's
 * memoized aggregation so the 21-session walk is not repeated per render.
 */
async function loadCumulativeDollarVolumeMedian(args: {
  cache: HistoricalBarCache;
  request: Parameters<HistoricalBarCache["getAggregation"]>[0];
  candles: Candle[];
  scannedAt: Date;
  todayTradingDate: string;
  expansionConfig: StrategyConfig["premarketExpansion"];
}): Promise<number | null> {
  const { cache, request, candles, scannedAt, todayTradingDate, expansionConfig } = args;

  const cutoffMinutes = computeCompletedBarCutoff(candles, 1, scannedAt);
  if (cutoffMinutes === null || cutoffMinutes <= PRE_MARKET_START_MINUTES) return null;

  const aggregation = await cache.getAggregation(request, {
    startMinutes: PRE_MARKET_START_MINUTES,
    cutoffMinutes,
    intervalMinutes: 1,
  });

  const split = splitBaseline(
    aggregation,
    todayTradingDate,
    expansionConfig.lookbackSessions,
    expansionConfig.minBaselineSessions
  );

  // Null rather than 0 for an empty baseline: a zero denominator would
  // render as an infinite relative volume.
  return median(split.baseline.map((s) => s.dollarVolume));
}

interface ExpansionEvaluationArgs {
  symbol: string;
  provider: MarketDataProvider;
  config: StrategyConfig;
  now: string;
  todayTradingDate: string;
  /** Today's "extended"-scoped 5m series, before any premarket narrowing. */
  extendedCandles: Candle[];
  /** Regular-scope 5m series used for the acceptance test. */
  confirmationCandles: Candle[];
  dailyCandles: Candle[];
  benchmarkSymbol: string;
  benchmark: BenchmarkBundle;
  feedInfo: ProviderFeedInfo;
  deadlineAt?: number;
}

/**
 * Builds the detector's input from data this scan already has, plus the
 * one genuinely new dependency (the historical baseline), and evaluates
 * BOTH directions.
 *
 * Both directions are always evaluated: they share every fetch, so the
 * second one is pure CPU over data already in memory. A bearish expansion
 * is not a rarer event than a bullish one, and evaluating only one would
 * make the feature silently directional.
 */
async function evaluateExpansion(args: ExpansionEvaluationArgs): Promise<SymbolExpansion> {
  const {
    symbol,
    provider,
    config,
    now,
    todayTradingDate,
    extendedCandles,
    confirmationCandles,
    dailyCandles,
    benchmarkSymbol,
    benchmark,
    feedInfo,
    deadlineAt,
  } = args;

  const scannedAt = new Date(now);
  const expansionConfig = config.premarketExpansion;

  // Everything the detector sees must be a COMPLETED bar. A forming 5m
  // candle carries whatever volume and range it has accumulated so far,
  // which is exactly the shape of an expansion that may not survive the
  // next four minutes.
  const premarketCandles = filterToCompletedBars(
    premarketOnly(extendedCandles, todayTradingDate),
    5,
    scannedAt
  );

  // The comparison window runs from the premarket open to the latest
  // COMPLETED bar, clamped at 9:30 — past the open, "premarket" stops
  // accumulating rather than quietly becoming "the morning so far".
  const rawCutoff = computeCompletedBarCutoff(extendedCandles, 5, scannedAt);
  const cutoffMinutes = rawCutoff === null ? null : clampToPremarketCutoff(rawCutoff);

  const { todaySession, baseline, datasetIncomplete } =
    cutoffMinutes === null || cutoffMinutes <= PRE_MARKET_START_MINUTES
      ? // No completed premarket bar yet: there is no window to compare,
        // so the baseline request is skipped rather than spent on an
        // empty one. Incomplete by definition, not by failure.
        { todaySession: null, baseline: [], datasetIncomplete: true }
      : await loadBaseline({
          symbol,
          provider,
          expansionConfig,
          feed: feedInfo.feed,
          todayTradingDate,
          cutoffMinutes,
          deadlineAt,
        });

  const elapsedPremarketMinutes =
    cutoffMinutes === null ? null : Math.max(0, cutoffMinutes - PRE_MARKET_START_MINUTES);

  const atrSeries = calculateAtr(dailyCandles, config.extension.atrPeriod);
  const lastAtr = atrSeries[atrSeries.length - 1];
  const dailyAtr = Number.isFinite(lastAtr) ? lastAtr : null;

  const sharedInput = {
    symbol,
    premarketCandles,
    confirmationCandles: filterToCompletedBars(confirmationCandles, 5, scannedAt),
    dailyCandles,
    todayTradingDate,
    todaySession,
    baseline,
    elapsedPremarketMinutes,
    dailyAtr,
    benchmarkSymbol,
    benchmarkPremarketCandles: benchmark.premarket,
    benchmarkDailyCandles: benchmark.daily,
    feed: { delayed: feedInfo.delayed, knownDelayMinutes: feedInfo.knownDelayMinutes },
    datasetIncomplete,
    candleIntervalMinutes: 5,
    scannedAt,
  };

  return {
    bullish: detectPremarketExpansion({ ...sharedInput, direction: "bullish" }, expansionConfig),
    bearish: detectPremarketExpansion({ ...sharedInput, direction: "bearish" }, expansionConfig),
  };
}

/**
 * Today's premarket window and the comparable window on each prior
 * session, from the shared historical bar cache.
 *
 * `todayTradingDate` is passed into the request deliberately: without it
 * the cache cannot tell a complete history from one whose newest sessions
 * were lost to an oldest-first truncation, and would report a short
 * window as a good one.
 */
async function loadBaseline(args: {
  symbol: string;
  provider: MarketDataProvider;
  expansionConfig: StrategyConfig["premarketExpansion"];
  feed: string;
  todayTradingDate: string;
  cutoffMinutes: number;
  deadlineAt?: number;
}) {
  const { symbol, provider, expansionConfig, feed, todayTradingDate, cutoffMinutes, deadlineAt } =
    args;

  const aggregation = await getBaselineCache(provider).getAggregation(
    {
      symbol,
      timeframe: "5m",
      sessionScope: "extended",
      // Today plus the full lookback: today is the measurement, the rest
      // are the comparison.
      sessionCount: expansionConfig.lookbackSessions + 1,
      feed,
      adjustment: "raw",
      todayTradingDate,
      deadlineAt,
    },
    {
      startMinutes: PRE_MARKET_START_MINUTES,
      cutoffMinutes,
      intervalMinutes: 5,
    }
  );

  const split = splitBaseline(
    aggregation,
    todayTradingDate,
    expansionConfig.lookbackSessions,
    expansionConfig.minBaselineSessions
  );

  // Short history is gated by `minBaselineSessions`, not by freshness:
  // `insufficient_sessions` can only be reported once pagination completed
  // AND today is present, so it means "young symbol", not "data lost".
  // Every other reason — including any added later — still forces
  // `partial`, which keeps the default fail-safe.
  const reason = split.sourceIncompleteReason;
  const datasetIncomplete = reason !== null && reason !== "insufficient_sessions";

  return {
    todaySession: split.today,
    baseline: split.baseline,
    datasetIncomplete,
  };
}

/**
 * Rule D's efficiency requirement: fetch each unique benchmark ONCE per
 * scan cycle and reuse it for every symbol mapped to it. Five
 * semiconductor names all resolving to SMH must produce one SMH request,
 * not five — a real rate-limit consideration, not optional polish.
 *
 * The expansion candidate needs two more benchmark series (today's
 * premarket, and daily for the prior close), so they are fetched here
 * under the same one-per-cycle guarantee rather than per symbol.
 *
 * A failed benchmark fetch is cached as empty arrays rather than retried
 * per symbol: the benchmark being unavailable is not a reason to fail the
 * whole symbol's scan. detectBenchmarkAlignment turns an empty series into
 * insufficientData ("unknown"), never "not aligned", and the expansion
 * detector reports an unavailable relative move rather than a bearish one.
 */
async function getBenchmarkBundle(
  benchmarkSymbol: string,
  provider: MarketDataProvider,
  cache: Map<string, BenchmarkBundle>,
  todayTradingDate: string,
  now: string,
  /**
   * When false, only the regular-hours series Rule D needs is fetched —
   * the premarket and daily series exist solely for the expansion
   * candidate, so disabling it must not spend those requests.
   */
  includeExpansionSeries: boolean,
  deadlineAt?: number
): Promise<BenchmarkBundle> {
  const cached = cache.get(benchmarkSymbol);
  if (cached) return cached;

  // `allSettled`, not `all`: each series must degrade on its OWN failure.
  // Under a shared catch, a premarket or daily rejection also blanked
  // `regular` — and `regular` feeds Rule D on the REVERSAL path, so an
  // expansion-only fetch failure would have changed the reversal score of
  // every symbol sharing this benchmark. That is exactly the isolation
  // this integration is supposed to preserve.
  const [regularResult, premarketResult, dailyResult] = await Promise.allSettled([
    provider.getCandles({
      symbol: benchmarkSymbol,
      timeframe: "5m",
      limit: 100,
      deadlineAt,
    }),
    includeExpansionSeries
      ? provider.getCandles({
          symbol: benchmarkSymbol,
          timeframe: "5m",
          limit: 100,
          deadlineAt,
          sessionScope: "extended",
        })
      : Promise.resolve(null),
    includeExpansionSeries
      ? provider.getCandles({
          symbol: benchmarkSymbol,
          timeframe: "1d",
          limit: 30,
          deadlineAt,
        })
      : Promise.resolve(null),
  ]);

  const premarketSeries =
    premarketResult.status === "fulfilled" ? premarketResult.value : null;

  const bundle: BenchmarkBundle = {
    regular: regularResult.status === "fulfilled" ? regularResult.value.candles : [],
    premarket: premarketSeries
      ? filterToCompletedBars(
          premarketOnly(premarketSeries.candles, todayTradingDate),
          5,
          new Date(now)
        )
      : [],
    daily: dailyResult.status === "fulfilled" ? (dailyResult.value?.candles ?? []) : [],
  };

  cache.set(benchmarkSymbol, bundle);
  return bundle;
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
