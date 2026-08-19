import type { Candle, DataQuality, Timeframe } from "@/types/candle";
import type {
  ConvictionLevel,
  ConditionDistanceUnit,
  EntryStatus,
  InvalidationNote,
  SetupCondition,
  SetupResult,
  SetupStage,
  SetupStatus,
} from "@/types/setup";
import { CATEGORY_WEIGHT } from "@/types/setup";
import type { StrategyConfig } from "./config";
import { detectIntradayDecline, detectRecoveryFromLow } from "@/lib/indicators/sessionDecline";
import { detectConsecutiveBullish } from "@/lib/indicators/consecutiveBullish";
import { detectLiquiditySweep } from "@/lib/indicators/liquiditySweep";
import { detectStructureShift } from "@/lib/indicators/structureShift";
import { detectEmaReclaim } from "@/lib/indicators/emaReclaim";
import { detectDailySmaConfirmation } from "@/lib/indicators/dailySma";
import {
  detectBullishFairValueGaps,
  trackGapFillStatus,
  selectClosestGap,
} from "@/lib/indicators/fairValueGap";
import { detectPriorDayContinuation } from "@/lib/indicators/priorDayContinuation";
import { detectMomentumLadder } from "@/lib/indicators/momentumLadder";
import {
  detectBenchmarkAlignment,
  resolveBenchmarkSymbol,
} from "@/lib/indicators/benchmarkAlignment";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";
import { detectVolumeConfirmation } from "@/lib/indicators/volumeConfirmation";
import { detectStratConfirmation } from "@/lib/indicators/stratCandle";
import { detectVwapReclaim } from "@/lib/indicators/vwap";
import { calculateAtr } from "@/lib/indicators/atr";
import { calculateEma } from "@/lib/indicators/movingAverages";
import { classifyPressure } from "@/lib/indicators/pressure";

export interface ScoreSetupInput {
  symbol: string;
  timeframe: Timeframe;
  sessionCandles: Candle[]; // all candles so far in the current session, ascending time
  dailyCandles: Candle[]; // daily candles for the SMA confirmation
  prevClose: number;
  config: StrategyConfig;
  /**
   * ISO timestamp to stamp results with. Required (not computed internally
   * via `new Date()`) so this function stays a pure, deterministic function
   * of its inputs — calling `Date.now()` inside a "pure" rule-engine
   * function silently breaks that guarantee and, in a Next.js client
   * component, produces a different value on the server render pass than
   * on client hydration, causing a hydration mismatch. Callers own the
   * timestamp.
   */
  now: string;
  /**
   * The actual data quality reported by whichever provider supplied
   * `sessionCandles` (from `CandleSeries.quality`). Passed through
   * explicitly rather than assumed, so the UI always reflects reality —
   * hardcoding "simulated" here would silently mislabel real live data as
   * mock, exactly the kind of mistake `types/candle.ts` calls out as
   * something the UI must never let happen.
   */
  quality: DataQuality;
  /**
   * Today's premarket candles, for Rule A2. Optional: when omitted (or
   * empty) the continuation detector reports insufficientData rather
   * than a fail, so a caller that hasn't wired premarket data yet gets
   * an honest "not evaluated" instead of a fabricated "no reclaim".
   */
  premarketCandles?: Candle[];
  /**
   * The resolved benchmark's own candles, for Rule D1. Same contract as
   * above: absent means insufficientData, never "not aligned".
   * Fetched once per unique benchmark per scan by scanService, not
   * per symbol.
   */
  benchmarkCandles?: Candle[];
}

/**
 * Required conditions determine red/yellow/green. Optional conditions add
 * to the (weighted) score but never block green. This mirrors the spec: a
 * green status means all REQUIRED rules pass — optional confirmations are
 * extra context, not gates.
 *
 * Score is weighted by category (core/secondary/supporting/informational)
 * rather than one flat point per condition — a confirmed structure shift
 * says more than a volume confirmation, and the score should reflect that,
 * per the "not all signals are equal" principle.
 */
export function scoreSetup(input: ScoreSetupInput): SetupResult {
  const {
    symbol,
    timeframe,
    sessionCandles,
    dailyCandles,
    prevClose,
    config,
    now,
    quality,
    premarketCandles = [],
    benchmarkCandles = [],
  } = input;

  if (sessionCandles.length === 0) {
    return emptyResult(symbol, timeframe, now, quality);
  }

  const currentPrice = sessionCandles[sessionCandles.length - 1].close;

  const decline = detectIntradayDecline(sessionCandles, prevClose, config.intradayDecline);
  const recovery = detectRecoveryFromLow(sessionCandles, config.recoveryFromLow);
  const consecutive = detectConsecutiveBullish(sessionCandles, config.consecutiveBullish);
  const sweep = detectLiquiditySweep(sessionCandles, recovery.sessionLow, config.liquiditySweep);
  const sweepIndex = sweep.passed
    ? sessionCandles.findIndex((c) => c.time === sweep.reclaimCandleTime)
    : null;
  const structure = detectStructureShift(sessionCandles, sweepIndex, config.structureShift);
  const emaReclaim = detectEmaReclaim(sessionCandles, config.emaReclaim);

  const rawGaps = detectBullishFairValueGaps(sessionCandles, config.fairValueGap);
  const trackedGaps = rawGaps.map((gap) => {
    const afterIndex = sessionCandles.findIndex((c) => c.time === gap.candle3Time) + 1;
    return trackGapFillStatus(gap, sessionCandles.slice(afterIndex));
  });
  // Rule C2: rank ALL qualifying gaps by distance to current price and
  // take the closest, rather than whichever happened to be found first —
  // with several gaps on a chart, "first" was arbitrary.
  const gapSelection = selectClosestGap(trackedGaps, currentPrice);
  const activeGap = gapSelection.closest;

  const volume = detectVolumeConfirmation(sessionCandles, 20, config.volumeConfirmation);
  const dailySma = detectDailySmaConfirmation(
    dailyCandles,
    currentPrice,
    config.dailySma.period
  );
  const strat = config.strat.enabled ? detectStratConfirmation(sessionCandles) : null;
  const vwap = config.vwap.enabled ? detectVwapReclaim(sessionCandles) : null;

  // Rule A: prior-day rejection + premarket reclaim. The trading date is
  // derived from `now` rather than taken as a new parameter, so the
  // prior-candle lookup stays consistent with every other date-scoped
  // calculation in the pipeline.
  const continuation = detectPriorDayContinuation(
    dailyCandles,
    premarketCandles,
    getCurrentTradingDate(new Date(now)),
    config.priorDayContinuation
  );

  // Rule B: milestone ladder from the immutable session-open anchor.
  const ladder = detectMomentumLadder(sessionCandles, config.momentumLadder);

  // Rule D: is the symbol's benchmark itself in gear?
  const benchmarkSymbol = resolveBenchmarkSymbol(symbol, config.benchmarkAlignment);
  const benchmark = detectBenchmarkAlignment(
    benchmarkSymbol,
    benchmarkCandles,
    config.emaReclaim.period
  );

  // Buy/sell pressure on the most recent candle - folded into the volume
  // confirmation detail text rather than its own scored row, per the
  // "quality over quantity" UI principle - it's context on an existing
  // condition, not a new independent signal.
  const avgVolumeForPressure = computePressureAverageVolume(sessionCandles, config.pressure.lookback);
  const pressure = classifyPressure(
    sessionCandles[sessionCandles.length - 1],
    avgVolumeForPressure,
    config.pressure.minBodyPercent,
    config.pressure.minRelativeVolume
  );

  const rawConditions: SetupCondition[] = [
    {
      id: "intraday_decline",
      label: "Significant intraday decline",
      required: true,
      category: "informational",
      state: decline.passed ? "pass" : "fail",
      detail: `${(decline.declineFromOpenPct * 100).toFixed(1)}% from open, ${(
        decline.declineFromPrevClosePct * 100
      ).toFixed(1)}% from prev close`,
    },
    {
      id: "recovery_from_low",
      label: "Recovery from session low",
      required: true,
      category: "core",
      state: recovery.passed ? "pass" : "fail",
      detail: `$${recovery.dollarRecovery.toFixed(2)} (${(recovery.pctRecovery * 100).toFixed(
        1
      )}%) recovered from $${recovery.sessionLow.toFixed(2)} low`,
    },
    {
      id: "consecutive_bullish",
      label: "Consecutive bullish candles",
      required: true,
      category: "supporting",
      insufficientData: consecutive.insufficientData,
      state: consecutive.insufficientData ? "unavailable" : consecutive.passed ? "pass" : "fail",
      unavailableReason: consecutive.insufficientData ? "Insufficient candles" : undefined,
      // Three distinct outcomes, three distinct sentences. Previously a
      // broken streak and a total absence of data both rendered
      // "0-candle window, $0.00 total move".
      detail: consecutive.insufficientData
        ? `Not enough candles yet to evaluate (need ${config.consecutiveBullish.minCandles})`
        : consecutive.passed
        ? `${consecutive.candleCount}-candle window, ${formatSignedDollars(
            consecutive.totalMoveDollars
          )} total move`
        : `${consecutive.candleCount}-candle window, ${formatSignedDollars(
            consecutive.totalMoveDollars
          )} net move — streak broken`,
    },
    {
      id: "liquidity_sweep",
      label: "Liquidity sweep (experimental)",
      required: true,
      category: "core",
      insufficientData: sweep.insufficientData,
      state: sweep.insufficientData ? "unavailable" : sweep.passed ? "pass" : "fail",
      unavailableReason: sweep.insufficientData ? "Insufficient candles" : undefined,
      // Four distinct outcomes. "No qualifying sweep detected" previously
      // covered both an empty series and a fully-scanned one, and said
      // nothing about how close price actually got.
      detail: sweep.passed
        ? `Swept ${sweep.sweptLevelSource} at $${sweep.sweptLevel?.toFixed(2)}`
        : sweep.insufficientData
        ? "Not enough candles yet to evaluate (need 2)"
        : sweep.breachedWithoutReclaim
        ? `Dipped below $${sweep.watchedLevel?.toFixed(2)} but never reclaimed it in time`
        : sweep.watchedLevel !== null
        ? `No sweep — held above $${sweep.watchedLevel.toFixed(2)}`
        : "No qualifying sweep detected",
    },
    {
      id: "structure_shift",
      label: "Bullish market-structure shift",
      required: true,
      category: "core",
      state:
        structure.state === "confirmed" ? "pass"
        : structure.state === "invalidated" ? "invalidated"
        : structure.triggerSwingHigh === null ? "unavailable" : "waiting",
      unavailableReason: structure.triggerSwingHigh === null ? "Insufficient structure history" : undefined,
      detail:
        structure.state === "confirmed"
          ? `Closed above swing high $${structure.triggerSwingHigh?.toFixed(2)}`
          : structure.triggerSwingHigh
          ? `Needs close above $${structure.triggerSwingHigh.toFixed(2)}`
          : "No swing high identified yet",
    },
    {
      id: "ema_reclaim",
      label: "9 EMA reclaim",
      required: true,
      category: "secondary",
      state: emaReclaim.emaValue === null ? "unavailable" : emaReclaim.passed ? "pass" : "fail",
      unavailableReason: emaReclaim.emaValue === null ? "Insufficient EMA history" : undefined,
      detail:
        emaReclaim.emaValue !== null && emaReclaim.price !== null
          ? `Price $${emaReclaim.price.toFixed(2)} vs EMA $${emaReclaim.emaValue.toFixed(2)} (${(
              (emaReclaim.distancePct ?? 0) * 100
            ).toFixed(1)}%)`
          : "Not enough candles for EMA",
    },
    {
      id: "fair_value_gap",
      label: "Valid bullish fair value gap",
      // Rule C1: reclassified required -> optional. A gap is a
      // lower-conviction, more experimental signal than a confirmed
      // structure shift, so it should contribute to score without
      // GATING green/confirmed status. DELIBERATE BEHAVIOR CHANGE: the
      // required-condition count drops from 7 to 6, and green is now
      // reachable without a fair value gap ever forming. Category and
      // weight are unchanged (secondary, 2), so scoring is unaffected.
      required: false,
      category: "secondary",
      state: activeGap ? "pass" : "waiting",
      detail: activeGap
        ? `Gap $${activeGap.lower.toFixed(2)}–$${activeGap.upper.toFixed(2)}, ${activeGap.status}${
            gapSelection.totalGapsTracked > 1
              ? ` — closest of ${gapSelection.totalGapsTracked} gaps ($${gapSelection.distance!.toFixed(2)} away)`
              : ""
          }`
        : "No qualifying 3-candle gap yet",
    },
    {
      id: "gap_proximity",
      label: "Price approaching or entering the gap",
      required: false,
      category: "informational",
      state: activeGap && currentPrice <= activeGap.upper ? "pass" : "waiting",
      detail: activeGap ? `Current price $${currentPrice.toFixed(2)}` : "No gap selected",
    },
    {
      // Rule A3 — additive, optional. Language describes only what has
      // already happened; it never claims the move will continue.
      id: "prior_day_continuation",
      label: "Prior-day rejection reclaimed in premarket",
      required: false,
      category: "secondary",
      insufficientData: continuation.insufficientData,
      state: continuation.insufficientData ? "unavailable" : continuation.passed ? "pass" : "waiting",
      unavailableReason: continuation.insufficientData ? "Insufficient premarket history" : undefined,
      detail: continuation.detail,
    },
    {
      // Rule B3 — additive, optional. Does NOT replace consecutive_bullish.
      id: "momentum_ladder",
      label: "Momentum milestone holding",
      required: false,
      category: "supporting",
      insufficientData: ladder.insufficientData,
      state: ladder.insufficientData ? "unavailable" : ladder.passed ? "pass" : "waiting",
      unavailableReason: ladder.insufficientData ? "Insufficient ladder history" : undefined,
      detail: ladder.detail,
    },
    {
      // Rule D1 — additive, optional.
      id: "benchmark_alignment",
      label: "Benchmark alignment",
      required: false,
      category: "secondary",
      insufficientData: benchmark.insufficientData,
      state: benchmark.insufficientData ? "unavailable" : benchmark.passed ? "pass" : "waiting",
      unavailableReason: benchmark.insufficientData ? "Benchmark data unavailable" : undefined,
      detail: benchmark.detail,
    },
    {
      id: "volume_confirmation",
      label: "Volume confirmation",
      required: false,
      category: "supporting",
      state: volume.passed ? "pass" : "waiting",
      detail: `${(volume.relativeVolumePct * 100).toFixed(0)}% of average volume${
        pressure.label !== "neutral" ? ` · ${pressure.label.replace(/_/g, " ")}` : ""
      }`,
    },
    {
      id: "daily_sma_confirmation",
      label: "Above daily 20 SMA",
      required: false,
      category: "secondary",
      state: dailySma.smaValue === null ? "unavailable" : dailySma.passed ? "pass" : "waiting",
      unavailableReason: dailySma.smaValue === null ? "Insufficient daily SMA history" : undefined,
      detail:
        dailySma.smaValue !== null
          ? `Price $${currentPrice.toFixed(2)} vs daily SMA $${dailySma.smaValue.toFixed(2)} (${(
              (dailySma.distancePct ?? 0) * 100
            ).toFixed(1)}%)`
          : "Not enough daily candles for SMA",
    },
  ];

  if (strat) {
    rawConditions.push({
      id: "strat_confirmation",
      label: "Strat candle-type confirmation",
      required: false,
      category: "supporting",
      state: strat.passed ? "pass" : "waiting",
      detail: strat.pattern ? strat.pattern : "No qualifying Strat pattern",
    });
  }

  if (vwap) {
    rawConditions.push({
      id: "vwap_reclaim",
      label: "VWAP reclaim",
      required: false,
      category: "secondary",
      state: vwap.vwapValue === null ? "unavailable" : vwap.passed ? "pass" : "waiting",
      unavailableReason: vwap.vwapValue === null ? "Insufficient VWAP history" : undefined,
      detail:
        vwap.vwapValue !== null && vwap.price !== null
          ? `Price $${vwap.price.toFixed(2)} vs VWAP $${vwap.vwapValue.toFixed(2)} (${(
              (vwap.distancePct ?? 0) * 100
            ).toFixed(1)}%)`
          : "Not enough candles for VWAP",
    });
  }

  const measured = (
    condition: SetupCondition, observedValue: number, thresholdValue: number,
    distanceUnit: ConditionDistanceUnit, distanceToThreshold = observedValue - thresholdValue
  ): SetupCondition => condition.state === "unavailable" ? condition : {
    ...condition, observedValue, thresholdValue, distanceToThreshold, distanceUnit,
  };
  const binary = (condition: SetupCondition): SetupCondition =>
    measured(condition, condition.state === "pass" ? 1 : 0, 1, "boolean");
  const conditions = rawConditions.map((condition): SetupCondition => {
    switch (condition.id) {
      case "intraday_decline": {
        const observed = Math.max(
          decline.declineFromOpenPct / config.intradayDecline.minDeclineFromOpenPct,
          decline.declineFromPrevClosePct / config.intradayDecline.minDeclineFromPrevClosePct
        );
        return measured(condition, observed, 1, "ratio");
      }
      case "recovery_from_low": {
        const observed = config.recoveryFromLow.useEither
          ? Math.max(recovery.dollarRecovery / config.recoveryFromLow.minDollarRecovery, recovery.pctRecovery / config.recoveryFromLow.minPctRecovery)
          : Math.min(recovery.dollarRecovery / config.recoveryFromLow.minDollarRecovery, recovery.pctRecovery / config.recoveryFromLow.minPctRecovery);
        return measured(condition, observed, 1, "ratio");
      }
      case "consecutive_bullish":
        return measured(condition, consecutive.totalMoveDollars, config.consecutiveBullish.minTotalMoveDollars, "dollars");
      case "liquidity_sweep": return binary(condition);
      case "structure_shift": {
        const threshold = structure.triggerSwingHigh ?? currentPrice;
        return measured(condition, currentPrice, threshold, "percent", threshold === 0 ? 0 : (currentPrice - threshold) / threshold);
      }
      case "ema_reclaim":
        return measured(condition, emaReclaim.distancePct ?? 0, config.emaReclaim.minPctAboveEma, "percent");
      case "fair_value_gap": {
        const gapSize = activeGap ? activeGap.upper - activeGap.lower : 0;
        return measured(condition, gapSize, config.fairValueGap.minGapSizeDollars, "dollars");
      }
      case "gap_proximity": return binary(condition);
      case "prior_day_continuation": {
        const observed = continuation.reclaim.currentPremarketPrice ?? 0;
        const threshold = continuation.reclaim.reclaimLevel ?? 0;
        return measured(condition, observed, threshold, "percent", threshold === 0 ? 0 : (observed - threshold) / threshold);
      }
      case "momentum_ladder":
        return measured(condition, ladder.currentMovePct ?? 0, Math.min(...config.momentumLadder.tiers), "percent");
      case "benchmark_alignment": {
        const price = benchmark.benchmarkPrice ?? 0;
        const reference = Math.max(benchmark.benchmarkVwap ?? 0, benchmark.benchmarkEma ?? 0);
        return measured(condition, reference === 0 ? 0 : price / reference, 1, "ratio");
      }
      case "volume_confirmation":
        return measured(condition, volume.relativeVolumePct, config.volumeConfirmation.minRelativeVolumePct, "ratio");
      case "daily_sma_confirmation":
        return measured(condition, dailySma.distancePct ?? 0, 0, "percent");
      case "strat_confirmation": return binary(condition);
      case "vwap_reclaim":
        return measured(condition, vwap?.distancePct ?? 0, 0, "percent");
      default: throw new Error(`No numeric decision payload for condition ${condition.id}`);
    }
  });

  const requiredConditions = conditions.filter((c) => c.required);
  const requiredPassed = requiredConditions.filter((c) => c.state === "pass").length;
  const anyInvalidated = conditions.some((c) => c.state === "invalidated");

  // Weighted score: each passed condition contributes its category
  // weight, not a flat 1 point - core signals (structure, sweep,
  // recovery) count for more than supporting/informational ones.
  // Normalized to a fixed 0-10 scale (per the spec's own suggestion:
  // "Score may be normalized to 0-10 or 0-100") rather than showing raw
  // weighted points, which topped out at an arbitrary-feeling number
  // that would also shift any time a condition is added or removed.
  const { score, maxScore } = computeWeightedScore(conditions);

  let status: SetupStatus;
  if (anyInvalidated) {
    status = "red";
  } else if (requiredPassed === requiredConditions.length) {
    status = "green";
  } else if (requiredPassed > 0) {
    status = "yellow";
  } else {
    status = "red";
  }

  const flagStage = determineStage({
    decline: decline.passed,
    recovery: recovery.passed,
    consecutive: consecutive.passed,
    sweep: sweep.passed,
    structureConfirmed: structure.state === "confirmed",
    emaReclaim: emaReclaim.passed,
    hasGap: !!activeGap,
    gapProximity: !!activeGap && currentPrice <= activeGap.upper,
  });
  const stage = resolveStage(status, flagStage);

  // Conviction level: a coarser "how loudly should this be talking to me"
  // read than the raw score - WATCH for early signs, DEVELOPING once real
  // confluence is building, CONFIRMED once every required condition
  // passes (same moment status becomes green). This is what "talks to
  // you in stages" instead of one static number.
  const convictionLevel = determineConvictionLevel(status, requiredPassed, requiredConditions.length);

  const entryStatus = determineEntryStatus({
    sessionCandles,
    anyInvalidated,
    status,
    config,
  });

  const invalidationNote = determineInvalidationNote({
    structureTriggerLevel: structure.triggerSwingHigh,
    sessionLow: recovery.sessionLow,
    gapLowerBoundary: activeGap?.lower ?? null,
    emaValue: emaReclaim.emaValue,
    status,
  });

  const unavailableRequired = requiredConditions.filter((condition) => condition.state === "unavailable");
  const scoreCapReason = unavailableRequired.length > 0 ? "warming_up_required_unavailable" as const : null;
  const scoreCap = unavailableRequired.some((condition) => condition.category === "core")
    ? MISSING_CORE_SCORE_CAP
    : unavailableRequired.length > 0 ? MISSING_REQUIRED_SCORE_CAP : null;

  const lastCandle = sessionCandles[sessionCandles.length - 1];
  const latestCandleTime = lastCandle ? new Date(lastCandle.time * 1000).toISOString() : null;

  return {
    symbol,
    timeframe,
    quality,
    stage,
    status,
    score,
    maxScore,
    conditions,
    lastUpdated: now,
    latestCandleTime,
    convictionLevel,
    entryStatus,
    invalidationNote,
    scoreCapReason,
    scoreCap,
    // Read-only republication of what the detectors above already
    // returned. Same objects, no recomputation, no re-ordering — adding
    // this cannot change any value already in this result.
    evidence: { structureShift: structure, liquiditySweep: sweep, conditions },
  };
}

/** "+$7.33" / "−$2.10" / "$0.00" — the sign carries meaning on a net
 * move, so a bare "$7.33" on a down move would be actively wrong. */
export function formatSignedDollars(value: number): string {
  const rounded = Number(value.toFixed(2));
  if (rounded > 0) return `+$${rounded.toFixed(2)}`;
  if (rounded < 0) return `−$${Math.abs(rounded).toFixed(2)}`;
  return "$0.00";
}

/**
 * Average volume over the configured lookback window of candles
 * immediately preceding the current one - never includes the current
 * candle itself, and gracefully uses whatever's available if the session
 * is shorter than the configured lookback.
 *
 * FIX (Codex review): this used to average EVERY preceding candle in the
 * session regardless of `config.pressure.lookback`, so old session
 * volume (e.g. the quiet open, hours ago) could distort a "is this
 * candle's volume unusual right now" reading. Extracted as its own
 * function so the windowing behavior can be proven directly and
 * deterministically, independent of the rest of the scorer.
 */
export function computePressureAverageVolume(sessionCandles: Candle[], lookback: number): number {
  const precedingCandles = sessionCandles.slice(0, -1);
  const window = precedingCandles.slice(-lookback);
  if (window.length === 0) return 0;
  return window.reduce((sum, c) => sum + c.volume, 0) / window.length;
}

/**
 * Sums each passed condition's category weight and normalizes to a fixed
 * 0-10 scale. Extracted as its own exported function (rather than left
 * inline) specifically so the weighting behavior can be tested directly
 * and deterministically with hand-built condition sets, independent of
 * any candle fixture or detector logic.
 */
export const CONFIRMED_SCORE_FLOOR = 7;
export const MISSING_REQUIRED_SCORE_CAP = 6.9;
export const MISSING_CORE_SCORE_CAP = 6.5;

export function computeWeightedScore(conditions: SetupCondition[]): { score: number; maxScore: number } {
  const weightOf = (c: SetupCondition): number => CATEGORY_WEIGHT[c.category ?? "supporting"];

  // A condition the detector could not evaluate is dropped from BOTH the
  // numerator and the denominator — scored as though it does not exist.
  //
  // Previously it stayed in the denominator only, which silently made
  // "no data" behave identically to "checked and failed": a benchmark
  // whose candles never fetched, or a ladder with no session-open candle
  // yet, dragged the normalized score down exactly as if it had been
  // evaluated and found false. That is the same conflation already fixed
  // in the detectors themselves (consecutiveBullish, liquiditySweep) and
  // in the entry-status field; this closes it in the score.
  //
  // Deliberately keyed off the explicit insufficientData flag, NOT off
  // the state: a condition genuinely evaluated and sitting at
  // "waiting"/"fail" still counts fully against the score, unchanged.
  const evaluated = conditions.filter((c) => !c.insufficientData && c.state !== "unavailable");

  const rawScore = evaluated
    .filter((c) => c.state === "pass")
    .reduce((sum, c) => sum + weightOf(c), 0);
  const rawMaxScore = evaluated.reduce((sum, c) => sum + weightOf(c), 0);
  const baseScore = rawMaxScore === 0 ? 0 : (rawScore / rawMaxScore) * 10;
  const required = conditions.filter((condition) => condition.required);
  const allRequiredPass = required.length > 0 && required.every((condition) => condition.state === "pass");
  // Deliberate two-part unavailable policy: unavailable rows leave the arithmetic
  // denominator, but a REQUIRED unavailable row still prevents confirmation and
  // caps the result. Warm-up must never manufacture an alertable score.
  const missingRequired = required.some((condition) => condition.state !== "pass");
  const missingCore = required.some(
    (condition) => condition.category === "core" && condition.state !== "pass"
  );
  const score = allRequiredPass
    ? Math.max(baseScore, CONFIRMED_SCORE_FLOOR)
    : missingCore
    ? Math.min(baseScore, MISSING_CORE_SCORE_CAP)
    : missingRequired
    ? Math.min(baseScore, MISSING_REQUIRED_SCORE_CAP)
    : baseScore;
  return { score, maxScore: 10 };
}

/**
 * WATCH / DEVELOPING / CONFIRMED - extracted as its own exported function
 * for the same reason as computeWeightedScore: direct, deterministic
 * testing without needing to reverse-engineer a candle fixture. A setup
 * is DEVELOPING only when at least 50% of required conditions pass.
 */
export function determineConvictionLevel(
  status: SetupStatus,
  requiredPassed: number,
  requiredTotal: number
): ConvictionLevel {
  if (status === "green") return "confirmed";
  const requiredRatio = requiredTotal === 0 ? 0 : requiredPassed / requiredTotal;
  if (requiredRatio >= 0.5) return "developing";
  return "watch";
}

/**
 * ACTIONABLE_NOW / WAIT_FOR_PULLBACK / EXTENDED_DO_NOT_CHASE /
 * INVALIDATED — never a prediction, purely a description of how far
 * price already sits from a reference level (9 EMA) relative to recent
 * volatility (ATR). A technically valid setup can still be a bad place
 * to get involved if price has already run too far from it. Exported for
 * the same direct-testability reason as the two functions above.
 */
export function determineEntryStatus(params: {
  sessionCandles: Candle[];
  anyInvalidated: boolean;
  status: SetupStatus;
  config: StrategyConfig;
}): EntryStatus {
  const { sessionCandles, anyInvalidated, status, config } = params;

  if (anyInvalidated) return "invalidated";
  if (status !== "green") return "wait_for_pullback";

  const emaSeries = calculateEma(sessionCandles, config.emaReclaim.period);
  const atrSeries = calculateAtr(sessionCandles, config.extension.atrPeriod);
  const lastIndex = sessionCandles.length - 1;
  const ema = emaSeries[lastIndex];
  const atr = atrSeries[lastIndex];
  const price = sessionCandles[lastIndex].close;

  if (Number.isNaN(ema) || Number.isNaN(atr) || atr === 0) {
    // FIX (Codex review): this used to return "actionable_now" here,
    // which is unsafe and misleading — it looks identical to "checked,
    // and it's fine" when the truth is "couldn't check at all." A
    // distinct status makes the UI say exactly why no assessment is
    // available, instead of silently implying a green light.
    return "insufficient_data";
  }

  const distanceInAtrs = Math.abs(price - ema) / atr;
  if (distanceInAtrs > config.extension.extendedAtrMultiplier) {
    return "extended_do_not_chase";
  }

  return "actionable_now";
}

/**
 * A short, deterministic description of what would break the setup at
 * its current stage - computed from levels already known, never a
 * prediction of what price will do.
 */
export function determineInvalidationNote(params: {
  structureTriggerLevel: number | null;
  sessionLow: number;
  gapLowerBoundary: number | null;
  emaValue: number | null;
  status: SetupStatus;
}): InvalidationNote | null {
  const { structureTriggerLevel, sessionLow, gapLowerBoundary, emaValue, status } = params;

  if (status === "red") return null;

  if (status === "green") {
    if (gapLowerBoundary !== null) return { level: gapLowerBoundary, reason: "fair_value_gap_lost" };
    if (emaValue !== null) return { level: emaValue, reason: "ema_reclaim_lost" };
    return { level: sessionLow, reason: "session_low_lost" };
  }

  if (structureTriggerLevel !== null) {
    return { level: structureTriggerLevel, reason: "structure_failed" };
  }

  return { level: sessionLow, reason: "session_low_lost" };
}

/**
 * Reconciles the flag-based stage walk with `status`, which is the
 * authoritative "is this setup actually fully confirmed" signal — it is
 * literally defined as every required condition passing.
 *
 * Without this, `status` and `stage` were computed independently and
 * never compared, so a genuinely green setup still displayed whichever
 * milestone the hierarchy walk happened to land on. Because
 * determineStage checks the two gap branches FIRST, a fully-confirmed
 * setup that still had an active fair value gap reported
 * "gap_proximity" or "fair_value_gap" — the last named milestone that
 * fired, not the truth. "confirmed" was a declared SetupStage member
 * that nothing could ever produce, while stageProgression.ts already
 * mapped it (REACH_BY_STAGE) and a test already exercised
 * stageReach("confirmed") for a value the scanner never emitted.
 *
 * Deliberately a separate function rather than a branch inside
 * determineStage: that keeps the flag walk a pure hierarchy of detector
 * flags with no knowledge of status, and makes the override directly
 * testable — the same reason computeWeightedScore,
 * determineConvictionLevel and determineEntryStatus are exported.
 *
 * Non-green results are returned exactly as the flag walk produced
 * them, so no yellow/red stage value or its ordering changes.
 */
export function resolveStage(status: SetupStatus, flagStage: SetupStage): SetupStage {
  return status === "green" ? "confirmed" : flagStage;
}

function determineStage(flags: {
  decline: boolean;
  recovery: boolean;
  consecutive: boolean;
  sweep: boolean;
  structureConfirmed: boolean;
  emaReclaim: boolean;
  hasGap: boolean;
  gapProximity: boolean;
}): SetupStage {
  if (flags.gapProximity) return "gap_proximity";
  if (flags.hasGap) return "fair_value_gap";
  if (flags.emaReclaim) return "ema_reclaim";
  if (flags.structureConfirmed) return "structure_shift";
  if (flags.sweep) return "liquidity_sweep";
  if (flags.consecutive) return "consecutive_bullish";
  if (flags.recovery) return "recovery_from_low";
  if (flags.decline) return "intraday_decline";
  return "none";
}

function emptyResult(
  symbol: string,
  timeframe: Timeframe,
  now: string,
  quality: DataQuality
): SetupResult {
  return {
    symbol,
    timeframe,
    quality,
    stage: "none",
    status: "red",
    score: 0,
    scoreCapReason: null,
    scoreCap: null,
    evidence: {
      structureShift: { state: "waiting", triggerSwingHigh: null, shiftCandleTime: null, shiftPrice: null, triggerSwingHighConfirmedTime: null },
      liquiditySweep: { passed: false, sweptLevel: null, sweptLevelSource: null, sweepCandleTime: null, reclaimCandleTime: null, experimental: true, insufficientData: true, watchedLevel: null, breachedWithoutReclaim: false },
      conditions: [],
    },
    maxScore: 0,
    conditions: [],
    lastUpdated: now,
    latestCandleTime: null,
    convictionLevel: "watch",
    entryStatus: "wait_for_pullback",
    invalidationNote: null,
  };
}
