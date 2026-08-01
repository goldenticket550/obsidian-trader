import type { Candle } from "@/types/candle";
import { median, type TimeOfDayBar } from "@/lib/market-data/historicalBaseline";
import { trueRange } from "./atr";

/**
 * Expansion Monitor Phase 1, section 3 — dollar-volume pace and
 * acceleration.
 *
 * Share volume is kept exactly as it is; this is additive context. Dollar
 * volume is the more comparable quantity across a watchlist, because
 * 100,000 shares means something very different at $8 than at $850.
 *
 * Nothing here claims institutional buying or selling. Participation is
 * described as accelerating, stable or contracting — an observation about
 * dollar flow, never an inference about who is behind it.
 */

/** `typicalPrice × volume` for a single bar. */
export function barDollarVolume(candle: Candle): number {
  const typicalPrice = (candle.high + candle.low + candle.close) / 3;
  return typicalPrice * candle.volume;
}

export interface DollarVolumeConfig {
  /** Evaluation-bar dollar volume must reach this multiple of the baseline median. */
  minimumDollarVolumeShockMultiple: number;
  minimumDollarVolumeBaselineSessions: number;
  dollarVolumeBaselineLookbackSessions: number;
  /** True range must reach this multiple of the time-of-day baseline median. */
  minimumTrueRangeShockMultiple: number;
  /** Close must sit within this fraction of the candle's extreme. */
  closeNearExtremeFraction: number;
  /** Acceleration bands — operational defaults, not validated thresholds. */
  acceleratingAtOrAbove: number;
  contractingBelow: number;
  /**
   * How far the close must have moved across the comparison window, as a
   * percentage of the earlier close, to count as a DIRECTION rather than
   * noise. Centralized here because the alternative — comparing two floats
   * for inequality — turns a one-cent rounding artifact into "price is
   * progressing", which then selects a directional interpretation.
   */
  priceProgressionTolerancePercent: number;
  /**
   * Dollar-volume shock multiple at or above which participation counts as
   * high even when the three-bar acceleration ratio is merely stable.
   */
  highParticipationShockMultiple: number;
}

export const defaultDollarVolumeConfig: DollarVolumeConfig = {
  minimumDollarVolumeShockMultiple: 2.0,
  minimumDollarVolumeBaselineSessions: 10,
  dollarVolumeBaselineLookbackSessions: 20,
  minimumTrueRangeShockMultiple: 1.5,
  closeNearExtremeFraction: 0.2,
  acceleratingAtOrAbove: 1.25,
  contractingBelow: 0.8,
  priceProgressionTolerancePercent: 0.02,
  highParticipationShockMultiple: 2,
};

// ---------------------------------------------------------------------------
// Time-of-day shocks
// ---------------------------------------------------------------------------

export interface ShockResult {
  status: "available" | "insufficient_data";
  passed: boolean;
  value: number | null;
  baselineMedian: number | null;
  multiple: number | null;
  baselineSampleSize: number;
}

function insufficientShock(value: number | null, sampleSize: number): ShockResult {
  return {
    status: "insufficient_data",
    // Never a pass and never a fail — an unmeasurable shock is neither.
    passed: false,
    value,
    baselineMedian: null,
    multiple: null,
    baselineSampleSize: sampleSize,
  };
}

/**
 * Dollar-volume shock: this bar's dollar volume against the median of
 * MATCHING TIME-OF-DAY bars from eligible prior sessions.
 *
 * Matching the minute-of-day matters more here than anywhere else in the
 * feature: premarket dollar volume at 9:29 routinely dwarfs 4:15 on the
 * same day, so comparing a bar against an all-morning average would flag
 * every late-premarket bar as a shock and miss every early one.
 */
export function measureDollarVolumeShock(
  evaluationBar: Candle | null,
  baseline: TimeOfDayBar[],
  config: DollarVolumeConfig
): ShockResult {
  if (!evaluationBar) return insufficientShock(null, baseline.length);

  const value = barDollarVolume(evaluationBar);
  const usable = baseline.slice(-config.dollarVolumeBaselineLookbackSessions);

  if (usable.length < config.minimumDollarVolumeBaselineSessions) {
    return insufficientShock(value, usable.length);
  }

  const baselineMedian = median(usable.map((b) => barDollarVolume(b.bar)));
  if (baselineMedian === null || baselineMedian <= 0) {
    return insufficientShock(value, usable.length);
  }

  const multiple = value / baselineMedian;
  return {
    status: "available",
    passed: multiple >= config.minimumDollarVolumeShockMultiple,
    value,
    baselineMedian,
    multiple,
    baselineSampleSize: usable.length,
  };
}

/**
 * True-range expansion against the same time-of-day baseline, reusing the
 * existing `trueRange` helper rather than redefining it — so a gap from
 * the previous close counts here exactly as it does for ATR.
 */
export function measureTrueRangeShock(
  evaluationBar: Candle | null,
  previousBar: Candle | null,
  baseline: TimeOfDayBar[],
  config: DollarVolumeConfig
): ShockResult {
  if (!evaluationBar) return insufficientShock(null, baseline.length);

  const value = trueRange(evaluationBar, previousBar?.close ?? null);
  const usable = baseline.slice(-config.dollarVolumeBaselineLookbackSessions);

  if (usable.length < config.minimumDollarVolumeBaselineSessions) {
    return insufficientShock(value, usable.length);
  }

  const baselineMedian = median(
    usable.map((b) => trueRange(b.bar, b.previousBar?.close ?? null))
  );
  if (baselineMedian === null || baselineMedian <= 0) {
    return insufficientShock(value, usable.length);
  }

  const multiple = value / baselineMedian;
  return {
    status: "available",
    passed: multiple >= config.minimumTrueRangeShockMultiple,
    value,
    baselineMedian,
    multiple,
    baselineSampleSize: usable.length,
  };
}

// ---------------------------------------------------------------------------
// Close near the candle's extreme
// ---------------------------------------------------------------------------

export interface CloseLocationResult {
  /** 0 = closed on the low, 1 = closed on the high. Null for a zero-range bar. */
  closeLocation: number | null;
  nearExtreme: boolean;
}

/**
 * Where in its own range the bar closed. A bullish acceleration bar is
 * expected to close near its high; the bearish mirror closes near its
 * low. A zero-range bar has no defined location — null, not 0 or 0.5.
 */
export function measureCloseLocation(
  candle: Candle | null,
  direction: "bullish" | "bearish",
  config: DollarVolumeConfig
): CloseLocationResult {
  if (!candle || !(candle.high > candle.low)) {
    return { closeLocation: null, nearExtreme: false };
  }

  const closeLocation = (candle.close - candle.low) / (candle.high - candle.low);
  const nearExtreme =
    direction === "bullish"
      ? closeLocation >= 1 - config.closeNearExtremeFraction
      : closeLocation <= config.closeNearExtremeFraction;

  return { closeLocation, nearExtreme };
}

// ---------------------------------------------------------------------------
// Dollar-volume context
// ---------------------------------------------------------------------------

export type ParticipationState =
  | "accelerating"
  | "stable"
  | "contracting"
  | "unavailable";

/**
 * Which way price moved across the same window the participation ratio is
 * measured over.
 *
 * Three states, not a boolean: "did not progress upward" and "moved down"
 * are different facts, and collapsing them is what made an accelerating
 * DOWNWARD move read as absorption. `flat` means the move was inside the
 * configured tolerance — genuinely no direction, not a small one.
 */
export type PriceProgression = "up" | "flat" | "down" | "unavailable";

/**
 * Classifies the move between two closes, treating anything inside
 * `priceProgressionTolerancePercent` of the earlier close as no direction
 * at all.
 */
export function classifyPriceProgression(
  earlierClose: number,
  laterClose: number,
  config: DollarVolumeConfig
): PriceProgression {
  if (!Number.isFinite(earlierClose) || !Number.isFinite(laterClose)) return "unavailable";

  const tolerance = Math.abs(earlierClose) * (config.priceProgressionTolerancePercent / 100);
  const delta = laterClose - earlierClose;
  if (Math.abs(delta) <= tolerance) return "flat";
  return delta > 0 ? "up" : "down";
}

export interface DollarVolumeContext {
  currentBarDollarVolume: number | null;
  currentBarRelativeDollarVolume: number | null;
  cumulativeDollarVolume: number | null;
  cumulativeRelativeDollarVolume: number | null;
  recentThreeBarDollarVolume: number | null;
  previousThreeBarDollarVolume: number | null;
  accelerationRatio: number | null;
  priceProgression: PriceProgression;
  status: "available" | "insufficient_data";
  participation: ParticipationState;
  /** Combined price+participation reading. Never an inference about who is trading. */
  interpretation: string | null;
}

const UNAVAILABLE_CONTEXT: DollarVolumeContext = {
  currentBarDollarVolume: null,
  currentBarRelativeDollarVolume: null,
  cumulativeDollarVolume: null,
  cumulativeRelativeDollarVolume: null,
  recentThreeBarDollarVolume: null,
  previousThreeBarDollarVolume: null,
  accelerationRatio: null,
  priceProgression: "unavailable",
  status: "insufficient_data",
  participation: "unavailable",
  interpretation: null,
};

/**
 * Builds the dollar-volume context for a symbol.
 *
 * The acceleration ratio compares two NON-OVERLAPPING three-bar windows —
 * the most recent three against the three immediately before them. An
 * overlapping comparison would share bars between numerator and
 * denominator and dampen every real change toward 1.0, which is precisely
 * the signal the ratio exists to surface.
 */
export function buildDollarVolumeContext(
  sessionCandles: Candle[],
  timeOfDayBaseline: TimeOfDayBar[],
  cumulativeBaselineMedian: number | null,
  config: DollarVolumeConfig
): DollarVolumeContext {
  if (sessionCandles.length === 0) return UNAVAILABLE_CONTEXT;

  const ordered = [...sessionCandles].sort((a, b) => a.time - b.time);
  const currentBar = ordered[ordered.length - 1];
  const currentBarDollarVolume = barDollarVolume(currentBar);
  const cumulativeDollarVolume = ordered.reduce((sum, c) => sum + barDollarVolume(c), 0);

  const shock = measureDollarVolumeShock(currentBar, timeOfDayBaseline, config);

  const cumulativeRelativeDollarVolume =
    cumulativeBaselineMedian !== null && cumulativeBaselineMedian > 0
      ? cumulativeDollarVolume / cumulativeBaselineMedian
      : null;

  // Six bars are required, not five: two non-overlapping windows of three.
  const hasWindows = ordered.length >= 6;
  const recentThreeBarDollarVolume = hasWindows
    ? ordered.slice(-3).reduce((sum, c) => sum + barDollarVolume(c), 0)
    : null;
  const previousThreeBarDollarVolume = hasWindows
    ? ordered.slice(-6, -3).reduce((sum, c) => sum + barDollarVolume(c), 0)
    : null;

  const accelerationRatio =
    previousThreeBarDollarVolume !== null &&
    previousThreeBarDollarVolume > 0 &&
    recentThreeBarDollarVolume !== null
      ? recentThreeBarDollarVolume / previousThreeBarDollarVolume
      : null;

  // Progression compares the same two windows, so price and participation
  // are read over the identical span.
  const priceProgression: PriceProgression = hasWindows
    ? classifyPriceProgression(
        ordered[ordered.length - 4].close,
        ordered[ordered.length - 1].close,
        config
      )
    : "unavailable";

  const participation: ParticipationState =
    accelerationRatio === null
      ? "unavailable"
      : accelerationRatio >= config.acceleratingAtOrAbove
      ? "accelerating"
      : accelerationRatio < config.contractingBelow
      ? "contracting"
      : "stable";

  return {
    currentBarDollarVolume,
    currentBarRelativeDollarVolume: shock.multiple,
    cumulativeDollarVolume,
    cumulativeRelativeDollarVolume,
    recentThreeBarDollarVolume,
    previousThreeBarDollarVolume,
    accelerationRatio,
    priceProgression,
    status: accelerationRatio === null ? "insufficient_data" : "available",
    participation,
    interpretation: interpret(priceProgression, participation, shock, config),
  };
}

/**
 * Reads price and participation together.
 *
 * Every branch below is reachable, and each is dispatched on the measured
 * PROGRESSION rather than on "not up". The absorption case is reserved for
 * a genuinely flat window and is stated as a possibility with direction
 * explicitly NOT inferred — high participation with no price progress is
 * ambiguous, and naming a side would be inventing information the bars do
 * not contain.
 *
 * Deliberately absent: any claim of reversal pressure. That would require
 * knowing which way the active expansion is running, which this function
 * is not given — it sees one window of closes, not a setup direction.
 */
function interpret(
  progression: PriceProgression,
  participation: ParticipationState,
  shock: ShockResult,
  config: DollarVolumeConfig
): string | null {
  if (participation === "unavailable" || progression === "unavailable") return null;

  if (progression === "up") {
    if (participation === "accelerating") return "Expansion strengthening upward";
    if (participation === "contracting") {
      return "Upward expansion continuing, participation weakening";
    }
    return "Upward expansion continuing";
  }

  if (progression === "down") {
    if (participation === "accelerating") return "Expansion strengthening downward";
    if (participation === "contracting") {
      return "Downward expansion continuing, participation weakening";
    }
    return "Downward expansion continuing";
  }

  // Flat: high participation with nowhere to go is the absorption case.
  const highParticipation =
    participation === "accelerating" ||
    (shock.multiple !== null && shock.multiple >= config.highParticipationShockMultiple);

  return highParticipation ? "Possible absorption; direction not inferred" : "Participation stable";
}

export const PARTICIPATION_LABELS: Record<ParticipationState, string> = {
  accelerating: "Participation accelerating",
  stable: "Participation stable",
  contracting: "Participation contracting",
  unavailable: "Participation unavailable",
};
