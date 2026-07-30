import type { Candle, DataQuality, Timeframe } from "@/types/candle";
import type {
  ConvictionLevel,
  EntryStatus,
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
} from "@/lib/indicators/fairValueGap";
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
  const { symbol, timeframe, sessionCandles, dailyCandles, prevClose, config, now, quality } = input;

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
  const activeGap = trackedGaps.find((g) => g.status === "open" || g.status === "partially_filled");

  const volume = detectVolumeConfirmation(sessionCandles, 20, config.volumeConfirmation);
  const dailySma = detectDailySmaConfirmation(
    dailyCandles,
    currentPrice,
    config.dailySma.period
  );
  const strat = config.strat.enabled ? detectStratConfirmation(sessionCandles) : null;
  const vwap = config.vwap.enabled ? detectVwapReclaim(sessionCandles) : null;

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

  const conditions: SetupCondition[] = [
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
      state: consecutive.passed ? "pass" : "fail",
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
      state: sweep.passed ? "pass" : "fail",
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
        structure.state === "confirmed" ? "pass" : structure.state === "invalidated" ? "invalidated" : "waiting",
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
      state: emaReclaim.passed ? "pass" : "fail",
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
      required: true,
      category: "secondary",
      state: activeGap ? "pass" : "waiting",
      detail: activeGap
        ? `Gap $${activeGap.lower.toFixed(2)}–$${activeGap.upper.toFixed(2)}, ${activeGap.status}`
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
      state: dailySma.passed ? "pass" : "waiting",
      detail:
        dailySma.smaValue !== null
          ? `Price $${currentPrice.toFixed(2)} vs daily SMA $${dailySma.smaValue.toFixed(2)} (${(
              (dailySma.distancePct ?? 0) * 100
            ).toFixed(1)}%)`
          : "Not enough daily candles for SMA",
    },
  ];

  if (strat) {
    conditions.push({
      id: "strat_confirmation",
      label: "Strat candle-type confirmation",
      required: false,
      category: "supporting",
      state: strat.passed ? "pass" : "waiting",
      detail: strat.pattern ? strat.pattern : "No qualifying Strat pattern",
    });
  }

  if (vwap) {
    conditions.push({
      id: "vwap_reclaim",
      label: "VWAP reclaim",
      required: false,
      category: "secondary",
      state: vwap.passed ? "pass" : "waiting",
      detail:
        vwap.vwapValue !== null && vwap.price !== null
          ? `Price $${vwap.price.toFixed(2)} vs VWAP $${vwap.vwapValue.toFixed(2)} (${(
              (vwap.distancePct ?? 0) * 100
            ).toFixed(1)}%)`
          : "Not enough candles for VWAP",
    });
  }

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
    hasGap: !!activeGap,
    emaValue: emaReclaim.emaValue,
    status,
  });

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
export function computeWeightedScore(conditions: SetupCondition[]): { score: number; maxScore: number } {
  const weightOf = (c: SetupCondition): number => CATEGORY_WEIGHT[c.category ?? "supporting"];
  const rawScore = conditions
    .filter((c) => c.state === "pass")
    .reduce((sum, c) => sum + weightOf(c), 0);
  const rawMaxScore = conditions.reduce((sum, c) => sum + weightOf(c), 0);
  const score = rawMaxScore === 0 ? 0 : (rawScore / rawMaxScore) * 10;
  return { score, maxScore: 10 };
}

/**
 * WATCH / DEVELOPING / CONFIRMED - extracted as its own exported function
 * for the same reason as computeWeightedScore: direct, deterministic
 * testing without needing to reverse-engineer a candle fixture that
 * happens to produce a particular required-conditions ratio.
 */
export function determineConvictionLevel(
  status: SetupStatus,
  requiredPassed: number,
  requiredTotal: number
): ConvictionLevel {
  if (status === "green") return "confirmed";
  const requiredRatio = requiredTotal === 0 ? 0 : requiredPassed / requiredTotal;
  if (requiredRatio >= 0.5 || requiredPassed >= 2) return "developing";
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
  hasGap: boolean;
  emaValue: number | null;
  status: SetupStatus;
}): string | null {
  const { structureTriggerLevel, sessionLow, hasGap, emaValue, status } = params;

  if (status === "red") return null;

  if (status === "green") {
    if (hasGap) return "Would weaken on a close back below the fair value gap's lower boundary.";
    if (emaValue !== null) return `Would weaken on a close back below the 9 EMA ($${emaValue.toFixed(2)}).`;
    return `Would weaken on a close back below the recovered session low ($${sessionLow.toFixed(2)}).`;
  }

  if (structureTriggerLevel !== null) {
    return `Currently needs a close above $${structureTriggerLevel.toFixed(2)} to progress - failing to hold recent higher lows would weaken it instead.`;
  }

  return `Currently needs to hold above the session low ($${sessionLow.toFixed(2)}) to stay valid.`;
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
    maxScore: 0,
    conditions: [],
    lastUpdated: now,
    latestCandleTime: null,
    convictionLevel: "watch",
    entryStatus: "wait_for_pullback",
    invalidationNote: null,
  };
}
