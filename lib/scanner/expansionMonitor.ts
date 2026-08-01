import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import { REGULAR_START_MINUTES } from "@/lib/market-data/session";
import {
  detectEarlyAcceleration,
  eligibleSignificantLevels,
  defaultLevelProximityConfig,
  type EarlyAccelerationResult,
  type LevelProximityConfig,
  type SignificantLevel,
} from "@/lib/indicators/earlyAcceleration";
import {
  buildDollarVolumeContext,
  defaultDollarVolumeConfig,
  type DollarVolumeConfig,
  type DollarVolumeContext,
} from "@/lib/indicators/dollarVolume";
import { detectMomentumLadder, type MomentumLadderResult } from "@/lib/indicators/momentumLadder";
import type { TimeOfDayBar } from "@/lib/market-data/historicalBaseline";
import type {
  ExpansionDirection,
  ExpansionStage,
  FeedDelayInfo,
  FreshnessStatus,
  PremarketExpansionResult,
} from "@/lib/indicators/premarketExpansion";
import { EXPANSION_STAGE_PRIORITY } from "./expansionPriority";

/**
 * Expansion Monitor — the one-minute layer.
 *
 * The five-minute detector answers "is this symbol set up?"; this answers
 * "is it moving right now?". They are deliberately separate timeframes:
 * every break / acceptance / structure / invalidation decision stays on
 * completed 5m bars, while the 1m series drives only the early heads-up
 * and the two stages that require live impulse.
 *
 * This module is an AGGREGATOR. It computes no new market measurement of
 * its own beyond the opening range — it composes the existing detectors
 * and resolves one derived stage from their outputs. It is deliberately
 * outside `scorer.ts`: the expansion monitor is a separate setup type and
 * must never reach the reversal checklist.
 */

// ---------------------------------------------------------------------------
// Stage resolution
// ---------------------------------------------------------------------------

/**
 * The observable facts the two additional stages are derived from.
 * Everything here is something the data directly shows — no forecast, no
 * blended score.
 */
export interface ExpansionStageSignals {
  /** A qualifying early-acceleration alert fired on the latest completed 1m bar. */
  earlyAccelerationFired: boolean;
  /** The 5m series has ACCEPTED a break (not merely broken one). */
  breakoutAccepted: boolean;
  /** The latest completed 1m bar is still showing expansion. */
  ongoingExpansion: boolean;
}

/**
 * Resolves the final stage from the 5m base stage plus the 1m signals.
 *
 * Two stages exist that the 5m detector structurally cannot reach, because
 * both require live one-minute impulse:
 *
 *   opening_drive     a qualifying early acceleration toward the active
 *                     level, BEFORE acceptance. The distinguishing fact is
 *                     "price is driving at the level" as opposed to
 *                     "price is sitting near it".
 *
 *   expansion_active  an accepted breakout that is STILL expanding — the
 *                     latest completed 1m bar is itself a dollar-volume
 *                     shock and a true-range expansion. Acceptance alone
 *                     is a completed event; this is a continuing one.
 *
 * The resolution is a maximum over the existing priority table rather than
 * an if-else chain, which keeps it total and order-independent: a stage is
 * only ever upgraded to something the table already ranks higher. That
 * matters for `level_break` (5), which outranks `opening_drive` (4) — a
 * symbol that has already broken its level is further along than one
 * merely driving at it, so an early-acceleration signal must not demote it.
 *
 * `invalidated` is handled first and never upgraded: the structure that
 * defined the setup is already gone, and a fresh impulse against a dead
 * level is not a resumption of it.
 *
 * Tunable through the thresholds the signals are derived from
 * (`DollarVolumeConfig`'s shock multiples and the level-proximity
 * tolerances), not through magic numbers here.
 */
export function resolveExpansionStage(
  baseStage: ExpansionStage,
  signals: ExpansionStageSignals
): ExpansionStage {
  if (baseStage === "invalidated") return "invalidated";

  const candidates: ExpansionStage[] = [baseStage];

  if (signals.earlyAccelerationFired && !signals.breakoutAccepted) {
    candidates.push("opening_drive");
  }
  if (signals.breakoutAccepted && signals.ongoingExpansion) {
    candidates.push("expansion_active");
  }

  return candidates.reduce((best, stage) =>
    EXPANSION_STAGE_PRIORITY[stage] > EXPANSION_STAGE_PRIORITY[best] ? stage : best
  );
}

/**
 * Is the latest completed 1-minute bar still expanding?
 *
 * Both shocks are required, matching the conjunction the early-acceleration
 * test already uses: dollar volume alone can spike on a single print, and
 * range alone can widen on a thin one. An unmeasurable shock is not an
 * ongoing expansion — `insufficient_data` reports `passed: false`, so a
 * missing baseline can never promote a symbol to `expansion_active`.
 */
export function isOngoingExpansion(early: EarlyAccelerationResult): boolean {
  return early.checks.dollarVolumeShock.passed && early.checks.trueRangeShock.passed;
}

// ---------------------------------------------------------------------------
// Opening range
// ---------------------------------------------------------------------------

export interface OpeningRange {
  high: number;
  low: number;
  barCount: number;
}

/**
 * The regular session's opening range, from completed 1-minute bars in
 * `[9:30, 9:30 + openingRangeMinutes)`.
 *
 * Returns null before the open, or when no bar has completed inside the
 * window — never a zero-width range, which would read as a real level that
 * price is permanently "at".
 */
export function computeOpeningRange(
  completedOneMinuteBars: Candle[],
  openingRangeMinutes: number
): OpeningRange | null {
  const end = REGULAR_START_MINUTES + openingRangeMinutes;
  let high = -Infinity;
  let low = Infinity;
  let barCount = 0;

  for (const candle of completedOneMinuteBars) {
    const minutes = getEasternTimeParts(new Date(candle.time * 1000)).minutesSinceMidnight;
    if (minutes < REGULAR_START_MINUTES || minutes >= end) continue;
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
    barCount += 1;
  }

  if (barCount === 0) return null;
  return { high, low, barCount };
}

// ---------------------------------------------------------------------------
// The per-symbol monitor result
// ---------------------------------------------------------------------------

/** What is known about the one-minute dataset behind this evaluation. */
export interface OneMinuteDataStatus {
  /** Eastern minute-of-day of the bar everything here was measured on. */
  evaluationMinuteOfDay: number | null;
  evaluationBarTime: number | null;
  completedBarCount: number;
  /** Matching time-of-day bars found across prior sessions. */
  baselineSampleSize: number;
  freshness: FreshnessStatus;
  freshnessPermitsAlerting: boolean;
  /**
   * True when the 1m history could not be trusted — a truncated fetch, a
   * missing session, or no completed bar yet. Never inferred from an
   * absence of signal.
   */
  insufficientData: boolean;
  reason: string | null;
}

/** The directional half of the monitor. */
export interface DirectionalExpansionMonitor {
  direction: ExpansionDirection;
  /** Stage from the 5m detector alone, kept visible for transparency. */
  baseStage: ExpansionStage;
  /** Stage after the 1m signals are applied. */
  stage: ExpansionStage;
  earlyAcceleration: EarlyAccelerationResult;
  significantLevels: SignificantLevel[];
  signals: ExpansionStageSignals;
}

export interface SymbolExpansionMonitor {
  symbol: string;
  /** Direction-agnostic: one series, one reading. */
  dollarVolume: DollarVolumeContext;
  momentumLadder: MomentumLadderResult;
  openingRange: OpeningRange | null;
  oneMinute: OneMinuteDataStatus;
  bullish: DirectionalExpansionMonitor;
  bearish: DirectionalExpansionMonitor;
}

export interface ExpansionMonitorInput {
  symbol: string;
  /** Today's COMPLETED 1-minute bars, ascending. */
  completedOneMinuteBars: Candle[];
  /** Matching time-of-day bars from prior eligible sessions. */
  timeOfDayBaseline: TimeOfDayBar[];
  /** Median cumulative dollar volume across prior sessions, or null. */
  cumulativeBaselineMedian: number | null;
  /** Today's REGULAR-session candles, for the momentum ladder's anchor. */
  regularSessionCandles: Candle[];
  /** The 5m expansion results this monitor layers on top of. */
  bullishExpansion: PremarketExpansionResult;
  bearishExpansion: PremarketExpansionResult;
  dailyAtr: number | null;
  feed: FeedDelayInfo;
  /** Freshness of the 1-MINUTE series specifically, not the 5m one. */
  freshness: FreshnessStatus;
  freshnessPermitsAlerting: boolean;
  oneMinuteInsufficientData: boolean;
  oneMinuteReason: string | null;
}

/**
 * Composes the one-minute layer for a symbol, in both directions.
 *
 * Both directions share every fetch, so the second is pure CPU over data
 * already in memory — and evaluating only one would make the monitor
 * silently directional.
 */
export function evaluateExpansionMonitor(
  input: ExpansionMonitorInput,
  config: StrategyConfig,
  dollarVolumeConfig: DollarVolumeConfig = defaultDollarVolumeConfig,
  levelConfig: LevelProximityConfig = defaultLevelProximityConfig
): SymbolExpansionMonitor {
  const {
    symbol,
    completedOneMinuteBars,
    timeOfDayBaseline,
    cumulativeBaselineMedian,
    regularSessionCandles,
    bullishExpansion,
    bearishExpansion,
    dailyAtr,
    freshness,
    freshnessPermitsAlerting,
  } = input;

  const evaluationBar =
    completedOneMinuteBars.length > 0
      ? completedOneMinuteBars[completedOneMinuteBars.length - 1]
      : null;
  const evaluationMinuteOfDay =
    evaluationBar === null
      ? null
      : getEasternTimeParts(new Date(evaluationBar.time * 1000)).minutesSinceMidnight;

  const openingRange = computeOpeningRange(
    completedOneMinuteBars,
    config.premarketExpansion.openingRangeMinutes
  );

  const dollarVolume = buildDollarVolumeContext(
    completedOneMinuteBars,
    timeOfDayBaseline,
    cumulativeBaselineMedian,
    dollarVolumeConfig
  );

  const momentumLadder = detectMomentumLadder(regularSessionCandles, config.momentumLadder);

  const forDirection = (
    direction: ExpansionDirection,
    expansion: PremarketExpansionResult
  ): DirectionalExpansionMonitor => {
    const bullish = direction === "bullish";

    const significantLevels =
      evaluationMinuteOfDay === null
        ? []
        : eligibleSignificantLevels(evaluationMinuteOfDay, direction, {
            premarketReference: bullish
              ? expansion.ranges.referenceHigh
              : expansion.ranges.referenceLow,
            // After 9:30 the premarket extreme is frozen by definition —
            // the premarket session is over and cannot extend.
            frozenPremarketExtreme: bullish
              ? expansion.ranges.sessionHigh
              : expansion.ranges.sessionLow,
            priorDay: expansion.priorLevel.level,
            openingRange: openingRange === null ? null : bullish ? openingRange.high : openingRange.low,
            // The level the 5m series is currently waiting to break.
            pendingBreakout: expansion.confirmation.activeLevel?.price ?? null,
          });

    const earlyAcceleration = detectEarlyAcceleration(
      {
        symbol,
        direction,
        completedOneMinuteBars,
        timeOfDayBaseline,
        significantLevels,
        dailyAtr,
        freshness,
        freshnessPermitsAlerting,
      },
      dollarVolumeConfig,
      levelConfig
    );

    const signals: ExpansionStageSignals = {
      earlyAccelerationFired: earlyAcceleration.fired,
      breakoutAccepted: expansion.confirmation.state === "accepted",
      ongoingExpansion: isOngoingExpansion(earlyAcceleration),
    };

    return {
      direction,
      baseStage: expansion.stage,
      stage: resolveExpansionStage(expansion.stage, signals),
      earlyAcceleration,
      significantLevels,
      signals,
    };
  };

  return {
    symbol,
    dollarVolume,
    momentumLadder,
    openingRange,
    oneMinute: {
      evaluationMinuteOfDay,
      evaluationBarTime: evaluationBar?.time ?? null,
      completedBarCount: completedOneMinuteBars.length,
      baselineSampleSize: timeOfDayBaseline.length,
      freshness,
      freshnessPermitsAlerting,
      insufficientData: input.oneMinuteInsufficientData,
      reason: input.oneMinuteReason,
    },
    bullish: forDirection("bullish", bullishExpansion),
    bearish: forDirection("bearish", bearishExpansion),
  };
}
