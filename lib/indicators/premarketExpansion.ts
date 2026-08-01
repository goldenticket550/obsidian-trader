import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";
import { findPreviousDailyCandle } from "@/lib/market-data/sessionFilter";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import { median, type SessionWindowAggregate } from "@/lib/market-data/historicalBaseline";
import { calculateVwap } from "./vwap";
import { findPivots } from "./pivots";

/**
 * Premarket Expansion Candidate.
 *
 * This is a SETUP TYPE, not another line on the reversal checklist. The
 * existing scorer detects a decline-then-reclaim; this detects a symbol
 * already expanding in premarket, which that checklist structurally
 * cannot recognize. It is evaluated independently, so a symbol can
 * qualify here, there, both, or neither. It does not alter the existing
 * setup score.
 *
 * NO EXPANSION RANK IN THIS RELEASE. The approved spec removes Expansion
 * Rank, rankScore, rank components and ranking bands outright, and
 * forbids substituting another numerical score. Evidence is presented as
 * per-group states and a passing count — "4 of 6 evidence groups
 * passing" — never blended into one hidden number. Cross-symbol expansion
 * ranking is out of scope.
 *
 * Two disciplines run through every rule below:
 *
 * 1. `insufficientData` is never a fail. Every sub-rule distinguishes
 *    "measured, and it did not pass" from "could not be measured,"
 *    exactly as consecutiveBullish/liquiditySweep already do. A missing
 *    benchmark is not bearish evidence.
 *
 * 2. Nothing here predicts. The context label is a factual classification
 *    of what has already been measured, never a likelihood or forecast.
 *
 * `direction` mirrors every rule exactly: lower range zone, lower-highs
 * structure, a surrendered prior-day level, underperformance.
 */
export type ExpansionDirection = "bullish" | "bearish";

/** Measured and passed, measured and didn't, or unmeasurable. */
export type EvidenceState = "pass" | "wait" | "unavailable";

/**
 * Float comparisons against price levels are tolerance-aware throughout —
 * never `===`. A level derived from a max() of bar highs and a close that
 * touched it can differ in the last bit, and an exact comparison would
 * report "not broken" for a level price has demonstrably reached.
 */
const PRICE_EPSILON = 1e-9;

function gt(a: number, b: number): boolean {
  return a - b > PRICE_EPSILON;
}
function lt(a: number, b: number): boolean {
  return b - a > PRICE_EPSILON;
}

// ---------------------------------------------------------------------------
// Reference range vs. session range
// ---------------------------------------------------------------------------

export interface PremarketRanges {
  /**
   * Established by completed premarket bars BEFORE the evaluation bar.
   * Used for breakout/breakdown detection, raw range position, active
   * level selection and confirmation messaging.
   *
   * Excluding the evaluation candle is the whole point: if the bar being
   * evaluated contributed its own high to the level it is being measured
   * against, price could never read above 100% of the range and a genuine
   * breakout would be arithmetically invisible.
   */
  referenceHigh: number | null;
  referenceLow: number | null;
  /**
   * ALL completed premarket bars through the evaluation bar. Used for the
   * displayed premarket high/low and range, and for the historical
   * range-multiple comparison. Never labelled as the reference range.
   */
  sessionHigh: number | null;
  sessionLow: number | null;
  /** The bar being evaluated — the latest completed premarket bar. */
  evaluationBar: Candle | null;
  insufficientData: boolean;
}

/**
 * Splits completed premarket bars into the reference range (before the
 * evaluation bar) and the complete elapsed session range (through it).
 *
 * A reference range needs at least `minReferenceBars` preceding completed
 * bars and a non-zero width; one bar or a flat range is insufficient data,
 * not a range of zero.
 */
export function computePremarketRanges(
  completedPremarketBars: Candle[],
  minReferenceBars: number
): PremarketRanges {
  if (completedPremarketBars.length === 0) {
    return {
      referenceHigh: null,
      referenceLow: null,
      sessionHigh: null,
      sessionLow: null,
      evaluationBar: null,
      insufficientData: true,
    };
  }

  const evaluationBar = completedPremarketBars[completedPremarketBars.length - 1];
  const preceding = completedPremarketBars.slice(0, -1);

  const sessionHigh = Math.max(...completedPremarketBars.map((c) => c.high));
  const sessionLow = Math.min(...completedPremarketBars.map((c) => c.low));

  if (preceding.length < minReferenceBars) {
    return {
      referenceHigh: null,
      referenceLow: null,
      sessionHigh,
      sessionLow,
      evaluationBar,
      insufficientData: true,
    };
  }

  const referenceHigh = Math.max(...preceding.map((c) => c.high));
  const referenceLow = Math.min(...preceding.map((c) => c.low));

  return {
    referenceHigh,
    referenceLow,
    sessionHigh,
    sessionLow,
    evaluationBar,
    // A zero-width reference range makes position undefined, not 0% or 100%.
    insufficientData: !gt(referenceHigh, referenceLow),
  };
}

// ---------------------------------------------------------------------------
// Move from prior close
// ---------------------------------------------------------------------------

export interface MoveFromPriorCloseResult {
  insufficientData: boolean;
  /** Close of the latest eligible COMPLETED premarket bar. */
  currentPrice: number | null;
  priorClose: number | null;
  dollarMove: number | null;
  percentMove: number | null;
}

/**
 * `dollarMove = currentPrice − priorRegularSessionClose`.
 *
 * The prior close is located by DATE via findPreviousDailyCandle, never
 * positionally — alpacaProvider does not session-filter the 1d series, so
 * during market hours the last element is today's still-forming bar.
 * Explicitly forbidden inputs, each of which produces a plausible-looking
 * wrong number: yesterday's extended-hours close, today's premarket open,
 * a quote from a mismatched timestamp, an unfinished bar.
 */
export function measureMoveFromPriorClose(
  latestCompletedPremarketBar: Candle | null,
  dailyCandles: Candle[],
  todayTradingDate: string
): MoveFromPriorCloseResult {
  const prior = findPreviousDailyCandle(dailyCandles, todayTradingDate);

  if (!latestCompletedPremarketBar || !prior) {
    return {
      insufficientData: true,
      currentPrice: latestCompletedPremarketBar?.close ?? null,
      priorClose: prior?.close ?? null,
      dollarMove: null,
      percentMove: null,
    };
  }

  const currentPrice = latestCompletedPremarketBar.close;
  const priorClose = prior.close;
  const dollarMove = currentPrice - priorClose;

  return {
    insufficientData: false,
    currentPrice,
    priorClose,
    dollarMove,
    percentMove: priorClose > 0 ? (dollarMove / priorClose) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// Historical-baseline comparisons
// ---------------------------------------------------------------------------

/** Why a baseline comparison could not be produced. Surfaced verbatim to the UI. */
export type BaselineUnavailableReason =
  | "no_current_window"
  | "insufficient_elapsed_time"
  | "insufficient_sessions"
  | "baseline_too_small";

export const BASELINE_REASON_TEXT: Record<BaselineUnavailableReason, string> = {
  no_current_window: "No completed comparison window yet",
  insufficient_elapsed_time: "Waiting for 15 minutes of premarket data",
  insufficient_sessions: "Insufficient comparison sessions",
  baseline_too_small: "Baseline volume too small",
};

export interface BaselineComparisonResult {
  state: EvidenceState;
  insufficientData: boolean;
  reason: BaselineUnavailableReason | null;
  /** Today's measured value over the elapsed window. */
  sessionValue: number | null;
  /** Median of the identical elapsed window across eligible prior sessions. */
  referenceValue: number | null;
  multiple: number | null;
  baselineSampleSize: number;
}

function unavailableComparison(
  reason: BaselineUnavailableReason,
  sessionValue: number | null,
  baselineSampleSize: number
): BaselineComparisonResult {
  return {
    state: "unavailable",
    insufficientData: true,
    reason,
    sessionValue,
    referenceValue: null,
    multiple: null,
    baselineSampleSize,
  };
}

/**
 * Premarket volume pace — `currentElapsedVolume / median(baselineVolumes)`,
 * both measured from 4:00 AM ET through the same completed bar.
 *
 * Four gates gate it, and a failure of any one returns a specific reason
 * rather than a number. Insufficient data is never converted to zero, 1×,
 * a pass, or a fail.
 */
export function measureVolumePace(
  todaySession: SessionWindowAggregate | null,
  baseline: SessionWindowAggregate[],
  elapsedPremarketMinutes: number | null,
  config: StrategyConfig["premarketExpansion"],
  minPace: number = config.volumePaceMinMultiple
): BaselineComparisonResult {
  const sampleSize = baseline.length;

  if (!todaySession) return unavailableComparison("no_current_window", null, sampleSize);

  if (
    elapsedPremarketMinutes === null ||
    elapsedPremarketMinutes < config.minimumElapsedPremarketMinutes
  ) {
    return unavailableComparison("insufficient_elapsed_time", todaySession.volume, sampleSize);
  }

  if (sampleSize < config.minBaselineSessions) {
    return unavailableComparison("insufficient_sessions", todaySession.volume, sampleSize);
  }

  const referenceValue = median(baseline.map((s) => s.volume));
  if (referenceValue === null || referenceValue < config.minimumBaselineMedianVolume) {
    return unavailableComparison("baseline_too_small", todaySession.volume, sampleSize);
  }

  const multiple = todaySession.volume / referenceValue;
  return {
    state: multiple >= minPace ? "pass" : "wait",
    insufficientData: false,
    reason: null,
    sessionValue: todaySession.volume,
    referenceValue,
    multiple,
    baselineSampleSize: sampleSize,
  };
}

/**
 * Range expansion — the displayed SESSION range (all completed bars
 * through the evaluation bar) against the median of the identical elapsed
 * window across prior sessions. Both sides come from the same
 * `aggregateThroughCutoff` window, so the interval is identical by
 * construction rather than by convention.
 */
export function measureRangeExpansion(
  todaySession: SessionWindowAggregate | null,
  baseline: SessionWindowAggregate[],
  config: StrategyConfig["premarketExpansion"],
  minMultiple: number = config.rangeExpansionMinMultiple
): BaselineComparisonResult {
  const sampleSize = baseline.length;

  if (!todaySession) return unavailableComparison("no_current_window", null, sampleSize);
  if (sampleSize < config.minBaselineSessions) {
    return unavailableComparison("insufficient_sessions", todaySession.range, sampleSize);
  }

  const referenceValue = median(baseline.map((s) => s.range));
  if (referenceValue === null || referenceValue <= 0) {
    return unavailableComparison("baseline_too_small", todaySession.range, sampleSize);
  }

  const multiple = todaySession.range / referenceValue;
  return {
    state: multiple >= minMultiple ? "pass" : "wait",
    insufficientData: false,
    reason: null,
    sessionValue: todaySession.range,
    referenceValue,
    multiple,
    baselineSampleSize: sampleSize,
  };
}

// ---------------------------------------------------------------------------
// Position within the premarket REFERENCE range
// ---------------------------------------------------------------------------

export type RangeZone = "upper" | "middle" | "lower";
export type RangeBreakState = "inside" | "above_reference" | "below_reference";

export interface RangePositionResult {
  state: EvidenceState;
  insufficientData: boolean;
  /**
   * Unclamped, measured against the REFERENCE range. 91% is inside the
   * upper portion; 108% is 8% of the reference range above its high; −6%
   * is 6% below its low. Preserved so a genuine breakout is visible.
   */
  rawPositionPercent: number | null;
  /** Clamped to 0-100 for progress-bar rendering ONLY. */
  displayPositionPercent: number | null;
  zone: RangeZone | null;
  /** Reported separately so clamping never conceals an out-of-range value. */
  breakState: RangeBreakState;
  referenceHigh: number | null;
  referenceLow: number | null;
}

/**
 * `(currentPrice − referenceLow) / (referenceHigh − referenceLow) × 100`.
 *
 * Being in the favorable zone is evidence TOWARD a directional read; on
 * its own it can never qualify a candidate. The corroborating-group
 * clause is what enforces that, and this is one of the three "price
 * location" facts that clause exists to keep from ganging up.
 */
export function measureRangePosition(
  currentPrice: number | null,
  ranges: PremarketRanges,
  direction: ExpansionDirection,
  config: StrategyConfig["premarketExpansion"]
): RangePositionResult {
  const unavailable: RangePositionResult = {
    state: "unavailable",
    insufficientData: true,
    rawPositionPercent: null,
    displayPositionPercent: null,
    zone: null,
    breakState: "inside",
    referenceHigh: ranges.referenceHigh,
    referenceLow: ranges.referenceLow,
  };

  if (
    currentPrice === null ||
    ranges.insufficientData ||
    ranges.referenceHigh === null ||
    ranges.referenceLow === null
  ) {
    return unavailable;
  }

  const { referenceHigh, referenceLow } = ranges;
  const span = referenceHigh - referenceLow;
  if (!gt(span, 0)) return unavailable;

  const rawPositionPercent = ((currentPrice - referenceLow) / span) * 100;
  const displayPositionPercent = Math.min(100, Math.max(0, rawPositionPercent));

  const breakState: RangeBreakState = gt(currentPrice, referenceHigh)
    ? "above_reference"
    : lt(currentPrice, referenceLow)
    ? "below_reference"
    : "inside";

  const zone: RangeZone =
    displayPositionPercent >= config.rangeZoneUpperPct
      ? "upper"
      : displayPositionPercent >= config.rangeZoneLowerPct
      ? "middle"
      : "lower";

  const favorable = direction === "bullish" ? zone === "upper" : zone === "lower";

  return {
    state: favorable ? "pass" : "wait",
    insufficientData: false,
    rawPositionPercent,
    displayPositionPercent,
    zone,
    breakState,
    referenceHigh,
    referenceLow,
  };
}

// ---------------------------------------------------------------------------
// Relative performance vs. benchmark
// ---------------------------------------------------------------------------

export type RelativeLabel =
  | "Outperforming"
  | "Underperforming"
  | "Approximately aligned"
  | "Unavailable";

export interface RelativeStrengthResult {
  state: EvidenceState;
  insufficientData: boolean;
  benchmarkSymbol: string;
  symbolPercentMove: number | null;
  benchmarkPercentMove: number | null;
  relativePct: number | null;
  label: RelativeLabel;
  timestampMismatch: boolean;
}

/**
 * `relativePct = symbolPctFromPriorClose − benchmarkPctFromPriorClose`.
 *
 * Both sides must come from bars with IDENTICAL completed timestamps.
 * Comparing a 9:24 symbol bar against a 9:10 benchmark bar attributes
 * fourteen minutes of market drift to the stock, which is the entire
 * quantity being measured.
 *
 * Sparse IEX premarket data makes exact alignment genuinely common to
 * miss. That is accepted deliberately: nearest-neighbour matching is NOT
 * introduced silently, so an unaligned pair returns unavailable — and
 * unavailable is never counted as bearish evidence.
 */
export function measureRelativeStrength(
  benchmarkSymbol: string,
  symbolMove: MoveFromPriorCloseResult,
  benchmarkMove: MoveFromPriorCloseResult,
  symbolBarTime: number | null,
  benchmarkBarTime: number | null,
  direction: ExpansionDirection,
  config: StrategyConfig["premarketExpansion"]
): RelativeStrengthResult {
  const timestampMismatch =
    symbolBarTime !== null && benchmarkBarTime !== null && symbolBarTime !== benchmarkBarTime;

  const unavailable: RelativeStrengthResult = {
    state: "unavailable",
    insufficientData: true,
    benchmarkSymbol,
    symbolPercentMove: symbolMove.percentMove,
    benchmarkPercentMove: benchmarkMove.percentMove,
    relativePct: null,
    label: "Unavailable",
    timestampMismatch,
  };

  if (timestampMismatch) return unavailable;
  if (symbolBarTime === null || benchmarkBarTime === null) return unavailable;
  if (symbolMove.percentMove === null || benchmarkMove.percentMove === null) return unavailable;

  const relativePct = symbolMove.percentMove - benchmarkMove.percentMove;

  const label: RelativeLabel =
    Math.abs(relativePct) <= config.alignedTolerancePct
      ? "Approximately aligned"
      : relativePct > 0
      ? "Outperforming"
      : "Underperforming";

  const favorable =
    direction === "bullish" ? label === "Outperforming" : label === "Underperforming";

  return {
    state: favorable ? "pass" : "wait",
    insufficientData: false,
    benchmarkSymbol,
    symbolPercentMove: symbolMove.percentMove,
    benchmarkPercentMove: benchmarkMove.percentMove,
    relativePct,
    label,
    timestampMismatch: false,
  };
}

// ---------------------------------------------------------------------------
// Prior-day level interaction
// ---------------------------------------------------------------------------

/**
 * A break and an ACCEPTED break are deliberately different states, as are
 * a break and a break that has since been rejected.
 */
export type LevelInteraction =
  | "not_near"
  | "approaching"
  | "testing"
  | "broken"
  | "accepted"
  | "rejected"
  | "unavailable";

export interface PriorLevelProximityResult {
  insufficientData: boolean;
  /** Prior day's high for a bullish read, prior day's low for a bearish one. */
  level: number | null;
  /**
   * ALWAYS `currentPrice − level`, in both directions. Positive means
   * price is above the level and negative means below, regardless of
   * which direction is being evaluated — a single unambiguous convention,
   * so a consumer never has to know the direction to read the sign.
   */
  signedDistance: number | null;
  absoluteDistance: number | null;
  percentDistance: number | null;
  /** The tolerance actually used — the LARGER of the percent and ATR forms. */
  toleranceDollars: number | null;
  interaction: LevelInteraction;
}

/**
 * Distance to the prior day's high (bullish) or low (bearish).
 *
 * "Approaching" is the LARGER of a percentage tolerance and a fraction of
 * daily ATR, so the classification stays meaningful across both a $20
 * stock and an $850 one. The real distance is always reported alongside
 * the state — an unexplained "Approaching" with no number behind it is
 * exactly the kind of label this codebase refuses to render.
 *
 * `accepted` and `rejected` need history the caller supplies: whether
 * premarket ever traded beyond the level, and whether acceptance has been
 * confirmed on the 5m series.
 */
export function measurePriorLevelProximity(
  currentPrice: number | null,
  dailyCandles: Candle[],
  todayTradingDate: string,
  dailyAtr: number | null,
  direction: ExpansionDirection,
  config: StrategyConfig["premarketExpansion"],
  history: { everTradedBeyond: boolean; accepted: boolean } = {
    everTradedBeyond: false,
    accepted: false,
  }
): PriorLevelProximityResult {
  const prior = findPreviousDailyCandle(dailyCandles, todayTradingDate);

  const unavailable: PriorLevelProximityResult = {
    insufficientData: true,
    level: null,
    signedDistance: null,
    absoluteDistance: null,
    percentDistance: null,
    toleranceDollars: null,
    interaction: "unavailable",
  };

  if (currentPrice === null || !prior) return unavailable;

  const level = direction === "bullish" ? prior.high : prior.low;
  if (level <= 0) return unavailable;

  const signedDistance = currentPrice - level;
  const absoluteDistance = Math.abs(signedDistance);
  const percentDistance = (absoluteDistance / level) * 100;

  const percentTolerance = (config.priorLevelApproachPercent / 100) * level;
  const atrTolerance = dailyAtr !== null ? dailyAtr * config.priorLevelApproachAtrFraction : 0;
  const toleranceDollars = Math.max(percentTolerance, atrTolerance);
  const testingTolerance = (config.priorLevelTestingPercent / 100) * level;

  // Beyond the level in the direction of travel.
  const beyond = direction === "bullish" ? gt(signedDistance, 0) : lt(signedDistance, 0);

  let interaction: LevelInteraction;
  if (beyond && absoluteDistance > testingTolerance) {
    interaction = history.accepted ? "accepted" : "broken";
  } else if (absoluteDistance <= testingTolerance) {
    interaction = "testing";
  } else if (history.everTradedBeyond) {
    // Traded through it earlier and has since come back — a rejection,
    // which is genuinely different from never having reached it.
    interaction = "rejected";
  } else if (absoluteDistance <= toleranceDollars) {
    interaction = "approaching";
  } else {
    interaction = "not_near";
  }

  return {
    insufficientData: false,
    level,
    signedDistance,
    absoluteDistance,
    percentDistance,
    toleranceDollars,
    interaction,
  };
}

// ---------------------------------------------------------------------------
// The six evidence groups
// ---------------------------------------------------------------------------

export type EvidenceGroupName =
  | "participation"
  | "rangeExpansion"
  | "rangeLocation"
  | "structure"
  | "priorDayInteraction"
  | "benchmarkRelativeMove";

/**
 * The three groups carrying genuinely independent information about
 * whether something is actually happening — real participation, real
 * range expansion, or a real interaction with a prior-day level.
 *
 * At least one must pass. Without this clause, `rangeLocation` +
 * `structure` + a prior-day-high approach could each "pass" while all
 * three restate the single fact that price is near its high, qualifying a
 * candidate on zero volume and zero range evidence.
 */
export const CORROBORATING_GROUPS: readonly EvidenceGroupName[] = [
  "participation",
  "rangeExpansion",
  "priorDayInteraction",
] as const;

export const ALL_EVIDENCE_GROUPS: readonly EvidenceGroupName[] = [
  "participation",
  "rangeExpansion",
  "rangeLocation",
  "structure",
  "priorDayInteraction",
  "benchmarkRelativeMove",
] as const;

export interface EvidenceGroup {
  name: EvidenceGroupName;
  state: EvidenceState;
  /** Factual description of what was measured, never a claim about what follows. */
  detail: string;
}

export interface StructureResult {
  state: EvidenceState;
  insufficientData: boolean;
  pivotCount: number;
  latestPivotPrice: number | null;
  previousPivotPrice: number | null;
}

/**
 * Higher lows (bullish) or lower highs (bearish), reusing the existing
 * fractal pivot detector rather than inventing a second definition of a
 * swing point. Fewer than two confirmed pivots is unevaluatable, not a
 * failure — early in premarket there simply has not been enough price
 * action to form them.
 */
export function measureStructure(
  premarketCandles: Candle[],
  direction: ExpansionDirection,
  pivotLength: number
): StructureResult {
  const wanted = direction === "bullish" ? "low" : "high";
  const pivots = findPivots(premarketCandles, pivotLength).filter((p) => p.type === wanted);

  if (pivots.length < 2) {
    return {
      state: "unavailable",
      insufficientData: true,
      pivotCount: pivots.length,
      latestPivotPrice: pivots.length > 0 ? pivots[pivots.length - 1].price : null,
      previousPivotPrice: null,
    };
  }

  const latest = pivots[pivots.length - 1];
  const previous = pivots[pivots.length - 2];
  const holding =
    direction === "bullish" ? gt(latest.price, previous.price) : lt(latest.price, previous.price);

  return {
    state: holding ? "pass" : "wait",
    insufficientData: false,
    pivotCount: pivots.length,
    latestPivotPrice: latest.price,
    previousPivotPrice: previous.price,
  };
}

export interface PriorDayInteractionResult {
  state: EvidenceState;
  insufficientData: boolean;
  proximity: PriorLevelProximityResult;
}

/**
 * Has price actually DONE something against yesterday's level, as opposed
 * to merely sitting somewhere? `accepted`, `broken` and `testing` all
 * describe a real interaction; `approaching` is proximity without one, so
 * it counts as evidence but `not_near` does not.
 */
export function measurePriorDayInteraction(
  proximity: PriorLevelProximityResult
): PriorDayInteractionResult {
  if (proximity.insufficientData) {
    return { state: "unavailable", insufficientData: true, proximity };
  }

  const engaged =
    proximity.interaction === "accepted" ||
    proximity.interaction === "broken" ||
    proximity.interaction === "testing" ||
    proximity.interaction === "approaching";

  return { state: engaged ? "pass" : "wait", insufficientData: false, proximity };
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

export type FreshnessStatus = "real_time" | "delayed" | "stale" | "partial" | "unavailable";

/**
 * What the PROVIDER says about its own feed. Delay is a property of the
 * feed configuration, never something inferred from how old a bar looks —
 * an old bar on a real-time feed is stale data, not a delayed feed, and
 * conflating the two would let genuine staleness masquerade as normal.
 */
export interface FeedDelayInfo {
  delayed: boolean;
  /** Null means the delay is not bounded/known, which cannot clear the alert gate. */
  knownDelayMinutes: number | null;
}

export interface ExpansionFreshness {
  scannedAt: string;
  /** When the latest COMPLETED bar closed. Never the same field as scannedAt. */
  latestCompletedBarAt: string | null;
  ageSeconds: number | null;
  status: FreshnessStatus;
  /** Explanatory text only — never a separate state. */
  severelyStale: boolean;
}

/**
 * How usable is the market data behind this evaluation?
 *
 * The two timestamps stay separate all the way to the UI. Collapsing scan
 * time into market-data time is the confusion behind the Action Queue
 * timestamp defect: a scan running right now off a forty-minute-old bar
 * is not live, however current the scan itself is.
 *
 * `partial` deliberately does NOT mean "a candle is currently forming" —
 * one always is during market hours, and treating that as partial would
 * block every live alert. It means the dataset the calculation needs is
 * incomplete: missing bars inside a confirmation sequence, a
 * partially-returned historical session, an incomplete elapsed comparison
 * window. The ordinarily-forming current candle is ignored and the latest
 * COMPLETED candle is evaluated.
 */
export function assessFreshness(
  scannedAt: Date,
  latestCompletedBar: Candle | null,
  candleIntervalMinutes: number,
  feed: FeedDelayInfo,
  datasetIncomplete: boolean,
  config: StrategyConfig["premarketExpansion"]
): ExpansionFreshness {
  const scannedAtIso = scannedAt.toISOString();

  if (!latestCompletedBar) {
    return {
      scannedAt: scannedAtIso,
      latestCompletedBarAt: null,
      ageSeconds: null,
      status: "unavailable",
      severelyStale: false,
    };
  }

  // Aged from the bar's CLOSE, not its open — a 5m bar stamped 9:20 did
  // not finish informing us until 9:25.
  const barCloseMs = (latestCompletedBar.time + candleIntervalMinutes * 60) * 1000;
  const ageSeconds = Math.max(0, Math.round((scannedAt.getTime() - barCloseMs) / 1000));
  const intervalSeconds = candleIntervalMinutes * 60;

  const allowanceSeconds = config.freshnessIntervalAllowance * intervalSeconds;
  const severelyStale = ageSeconds > 3 * intervalSeconds;

  let status: FreshnessStatus;
  if (feed.delayed) {
    // A delayed feed is "delayed" while its age stays inside the KNOWN
    // delay plus the normal allowance; an unknown/unbounded delay, or one
    // exceeded, is stale rather than quietly acceptable.
    const bound =
      feed.knownDelayMinutes !== null ? feed.knownDelayMinutes * 60 + allowanceSeconds : -1;
    status = bound >= 0 && ageSeconds <= bound ? "delayed" : "stale";
  } else {
    status = ageSeconds <= allowanceSeconds ? "real_time" : "stale";
  }

  // Incomplete required data outranks a healthy age: the numbers would be
  // computed from a window that is not actually there.
  if (status !== "stale" && datasetIncomplete) status = "partial";

  return {
    scannedAt: scannedAtIso,
    latestCompletedBarAt: new Date(barCloseMs).toISOString(),
    ageSeconds,
    status,
    severelyStale,
  };
}

/**
 * The alert gate: a NEW candidate alert may be produced only on
 * `real_time`, or on `delayed` with a known bounded delay. Blocked on
 * `stale`, `partial` and `unavailable`. Existing candidates may remain
 * visible in a non-actionable state with the warning attached.
 */
export function freshnessAllowsNewCandidate(
  status: FreshnessStatus,
  feed: FeedDelayInfo
): boolean {
  if (status === "real_time") return true;
  if (status === "delayed") return feed.knownDelayMinutes !== null;
  return false;
}

// ---------------------------------------------------------------------------
// Active levels, confirmation and invalidation
// ---------------------------------------------------------------------------

export type LevelName = "premarket_reference" | "prior_day";

export interface ActiveLevel {
  name: LevelName;
  price: number;
}

export type ConfirmationState =
  /** An unbroken reference remains ahead: "Break and hold above/below [level]". */
  | "awaiting_break"
  /** The final reference has been broken but acceptance is not confirmed. */
  | "awaiting_acceptance"
  /** Acceptance passed. */
  | "accepted"
  | "unavailable";

/**
 * Which of the two legitimate routes produced acceptance. Kept distinct
 * because they describe genuinely different price behaviour: a clean hold
 * above the level, versus a hold that first traded back to it and
 * survived. Null whenever acceptance has not been reached.
 */
export type AcceptanceMethod = "consecutive_closes" | "retest_hold";

export interface ConfirmationResult {
  state: ConfirmationState;
  /** The nearest unbroken level ahead, or null once every level is broken. */
  activeLevel: ActiveLevel | null;
  /** Every level considered, so messaging can say "both premarket and prior-day highs". */
  allLevels: ActiveLevel[];
  brokenLevels: ActiveLevel[];
  /**
   * The single level acceptance is judged against, FROZEN for the whole
   * assessment. Reported so a consumer can see that a rolling high did not
   * quietly move the bar a second close had to clear.
   */
  acceptanceLevel: number | null;
  /** Total completed closes beyond the level, across every attempt. */
  closesBeyond: number;
  /**
   * The longest UNBROKEN run of completed closes beyond the level. This,
   * not `closesBeyond`, is what the consecutive-closes route tests: a
   * break, a failed close back through, and a second break is two closes
   * beyond and two separate attempts, not an accepted breakout.
   */
  consecutiveClosesBeyond: number;
  retestHeld: boolean;
  acceptanceMethod: AcceptanceMethod | null;
}

/**
 * Selects the nearest unbroken level in the direction of travel.
 *
 * Deterministic by construction: filter to levels still ahead of the
 * latest completed close, sort by distance, take the first. No tie-break
 * heuristics and no hidden preference between the two level types.
 */
export function selectActiveLevel(
  levels: ActiveLevel[],
  latestCompletedClose: number,
  direction: ExpansionDirection
): ActiveLevel | null {
  const unbroken =
    direction === "bullish"
      ? levels.filter((l) => gt(l.price, latestCompletedClose)).sort((a, b) => a.price - b.price)
      : levels.filter((l) => lt(l.price, latestCompletedClose)).sort((a, b) => b.price - a.price);

  return unbroken[0] ?? null;
}

/** Consecutive completed closes beyond the level that acceptance requires. */
export const DEFAULT_REQUIRED_CONSECUTIVE_CLOSES = 2;

/**
 * Acceptance: `requiredConsecutiveCloses` CONSECUTIVE completed 5-minute
 * closes beyond the level, OR a break, a controlled retest, and a
 * completed close back in the breakout direction.
 *
 * A first close beyond the final reference is explicitly NOT acceptance
 * merely because no unbroken level remains — one bar through a level is
 * the most common shape of a failed break, so that case reports
 * `awaiting_acceptance` and the UI says "Hold above both…".
 *
 * Both routes are evaluated per ATTEMPT rather than over the whole
 * series. A completed close back through the level ends the attempt: the
 * closes on either side of it are two separate tries at the level, and
 * merely counting them would report break → fail → break as an accepted
 * breakout. A reclaim after a failed close starts a fresh attempt that
 * has to earn acceptance on its own.
 *
 * `acceptanceLevel` is computed once, from the levels supplied, and every
 * candle is judged against that frozen price — a rolling session high can
 * never raise the bar a later close has to clear.
 */
export function assessConfirmation(
  confirmationCandles: Candle[],
  levels: ActiveLevel[],
  latestCompletedClose: number | null,
  direction: ExpansionDirection,
  requiredConsecutiveCloses: number = DEFAULT_REQUIRED_CONSECUTIVE_CLOSES
): ConfirmationResult {
  const empty: ConfirmationResult = {
    state: "unavailable",
    activeLevel: null,
    allLevels: levels,
    brokenLevels: [],
    acceptanceLevel: null,
    closesBeyond: 0,
    consecutiveClosesBeyond: 0,
    retestHeld: false,
    acceptanceMethod: null,
  };

  if (levels.length === 0 || latestCompletedClose === null) return empty;

  const activeLevel = selectActiveLevel(levels, latestCompletedClose, direction);
  const brokenLevels = levels.filter((l) =>
    direction === "bullish" ? !gt(l.price, latestCompletedClose) : !lt(l.price, latestCompletedClose)
  );

  if (activeLevel !== null) {
    return { ...empty, state: "awaiting_break", activeLevel, brokenLevels };
  }

  // Every level is behind price: judge acceptance against the furthest
  // one, which is the level price actually had to clear last.
  const acceptanceLevel =
    direction === "bullish"
      ? Math.max(...levels.map((l) => l.price))
      : Math.min(...levels.map((l) => l.price));

  const pending: ConfirmationResult = {
    ...empty,
    state: "awaiting_acceptance",
    brokenLevels,
    acceptanceLevel,
  };

  if (confirmationCandles.length === 0) return pending;

  const beyond = (c: Candle) =>
    direction === "bullish" ? gt(c.close, acceptanceLevel) : lt(c.close, acceptanceLevel);
  const retested = (c: Candle) =>
    direction === "bullish" ? !gt(c.low, acceptanceLevel) : !lt(c.high, acceptanceLevel);

  let closesBeyond = 0;
  let consecutive = 0;
  let longestConsecutive = 0;
  /** True once this attempt has a completed break to retest back into. */
  let attemptOpen = false;
  let retestHeld = false;
  let retestHeldThisAttempt = false;
  let acceptanceMethod: AcceptanceMethod | null = null;

  for (const candle of confirmationCandles) {
    if (!beyond(candle)) {
      // A completed close back through the level ends the attempt. Anything
      // after it is a new try, not a continuation of this one.
      consecutive = 0;
      attemptOpen = false;
      retestHeldThisAttempt = false;
      continue;
    }

    closesBeyond += 1;
    consecutive += 1;
    if (consecutive > longestConsecutive) longestConsecutive = consecutive;

    // A controlled retest: a candle AFTER the break traded back to the
    // level and still closed in the breakout direction.
    if (attemptOpen && retested(candle)) {
      retestHeld = true;
      retestHeldThisAttempt = true;
    }
    attemptOpen = true;

    if (acceptanceMethod === null) {
      // Retest-and-hold is reported in preference to a plain run of closes:
      // when both describe the same sequence, the retest is the more
      // specific fact about what price actually did.
      if (retestHeldThisAttempt) acceptanceMethod = "retest_hold";
      else if (consecutive >= requiredConsecutiveCloses) acceptanceMethod = "consecutive_closes";
    }
  }

  return {
    state: acceptanceMethod !== null ? "accepted" : "awaiting_acceptance",
    activeLevel: null,
    allLevels: levels,
    brokenLevels,
    acceptanceLevel,
    closesBeyond,
    consecutiveClosesBeyond: longestConsecutive,
    retestHeld,
    acceptanceMethod,
  };
}

export type InvalidationSource =
  | "premarket_vwap"
  | "structure_pivot"
  | "premarket_extreme"
  | "accepted_breakout_level";

export interface InvalidationResult {
  /** Null means "Not established" — never an invented price. */
  price: number | null;
  source: InvalidationSource | null;
}

/**
 * Chosen from real structure only: premarket VWAP, the latest confirmed
 * higher-low / lower-high, the premarket extreme, and the breakout level
 * once accepted. The nearest one on the protective side of price wins.
 *
 * When no candidate sits on the protective side, this returns null and
 * the UI renders "Invalidation: Not established". Inventing a round
 * number here would present a fabricated risk level as a measured one.
 */
export function chooseInvalidation(
  currentPrice: number | null,
  premarketCandles: Candle[],
  structure: StructureResult,
  ranges: PremarketRanges,
  confirmation: ConfirmationResult,
  direction: ExpansionDirection
): InvalidationResult {
  if (currentPrice === null) return { price: null, source: null };

  const candidates: { price: number; source: InvalidationSource }[] = [];

  const vwapSeries = calculateVwap(premarketCandles);
  const vwap = vwapSeries.length > 0 ? vwapSeries[vwapSeries.length - 1] : undefined;
  if (vwap !== undefined && Number.isFinite(vwap)) {
    candidates.push({ price: vwap, source: "premarket_vwap" });
  }

  if (structure.latestPivotPrice !== null && !structure.insufficientData) {
    candidates.push({ price: structure.latestPivotPrice, source: "structure_pivot" });
  }

  const extreme = direction === "bullish" ? ranges.sessionLow : ranges.sessionHigh;
  if (extreme !== null) candidates.push({ price: extreme, source: "premarket_extreme" });

  if (confirmation.state === "accepted" && confirmation.brokenLevels.length > 0) {
    const accepted =
      direction === "bullish"
        ? Math.max(...confirmation.brokenLevels.map((l) => l.price))
        : Math.min(...confirmation.brokenLevels.map((l) => l.price));
    candidates.push({ price: accepted, source: "accepted_breakout_level" });
  }

  const protective = candidates.filter((c) =>
    direction === "bullish" ? lt(c.price, currentPrice) : gt(c.price, currentPrice)
  );
  if (protective.length === 0) return { price: null, source: null };

  const nearest = protective.reduce((best, c) =>
    Math.abs(currentPrice - c.price) < Math.abs(currentPrice - best.price) ? c : best
  );

  return { price: nearest.price, source: nearest.source };
}

// ---------------------------------------------------------------------------
// Expansion stage
// ---------------------------------------------------------------------------

/**
 * Observable state, used by Part 2's prioritization. Deliberately a
 * state, not a score — the stage is something the data either shows or
 * does not.
 */
export type ExpansionStage =
  | "inactive"
  | "context_developing"
  | "premarket_candidate"
  | "opening_drive"
  | "level_break"
  | "breakout_accepted"
  | "expansion_active"
  | "stalled"
  | "invalidated";

// ---------------------------------------------------------------------------
// The combined candidate
// ---------------------------------------------------------------------------

export interface PremarketExpansionInput {
  symbol: string;
  direction: ExpansionDirection;
  /** Today's COMPLETED premarket bars, ascending. A forming bar must not be included. */
  premarketCandles: Candle[];
  /** Completed 5m bars used for the acceptance test. */
  confirmationCandles: Candle[];
  dailyCandles: Candle[];
  todayTradingDate: string;
  todaySession: SessionWindowAggregate | null;
  baseline: SessionWindowAggregate[];
  /** Minutes of premarket elapsed through the evaluation bar. */
  elapsedPremarketMinutes: number | null;
  dailyAtr: number | null;
  benchmarkSymbol: string;
  benchmarkPremarketCandles: Candle[];
  benchmarkDailyCandles: Candle[];
  feed: FeedDelayInfo;
  /** True when a required dataset/window is incomplete — drives `partial`. */
  datasetIncomplete: boolean;
  candleIntervalMinutes: number;
  scannedAt: Date;
}

export interface PremarketExpansionResult {
  symbol: string;
  direction: ExpansionDirection;
  /** True only when the evidence gate passes AND freshness permits a new alert. */
  qualified: boolean;
  /** Factual classification — never a prediction. */
  contextLabel: string;
  stage: ExpansionStage;

  move: MoveFromPriorCloseResult;
  ranges: PremarketRanges;
  volumePace: BaselineComparisonResult;
  rangeExpansion: BaselineComparisonResult;
  rangePosition: RangePositionResult;
  relativeStrength: RelativeStrengthResult;
  priorLevel: PriorLevelProximityResult;
  structure: StructureResult;
  priorDayInteraction: PriorDayInteractionResult;

  groups: EvidenceGroup[];
  passingGroups: number;
  totalGroups: number;
  evaluableGroups: number;
  corroboratingGroupPassed: boolean;

  confirmation: ConfirmationResult;
  invalidation: InvalidationResult;
  freshness: ExpansionFreshness;
}

function latestBar(candles: Candle[]): Candle | null {
  return candles.length > 0 ? candles[candles.length - 1] : null;
}

/**
 * Thresholds that used to be inlined as bare `1.5`s inside the detectors.
 * They live in `StrategyConfig` now, which means a caller can supply
 * nonsense — a NaN from a bad parse, a negative multiple, a zero
 * consecutive-close requirement that would accept every first break. Each
 * of those fails silently and plausibly, so they are checked rather than
 * trusted.
 *
 * Returns a list of human-readable problems; empty means valid.
 */
export function validatePremarketExpansionConfig(
  config: StrategyConfig["premarketExpansion"]
): string[] {
  const problems: string[] = [];

  const positiveMultiple = (name: string, value: number) => {
    if (!Number.isFinite(value)) problems.push(`${name} must be a finite number`);
    else if (value <= 0) problems.push(`${name} must be greater than 0`);
    // A 100x baseline multiple is not a tuning choice, it is a unit error.
    else if (value > 100) problems.push(`${name} must be at most 100`);
  };

  positiveMultiple("volumePaceMinMultiple", config.volumePaceMinMultiple);
  positiveMultiple("rangeExpansionMinMultiple", config.rangeExpansionMinMultiple);

  const { requiredConsecutiveCloses } = config;
  if (!Number.isInteger(requiredConsecutiveCloses) || requiredConsecutiveCloses < 1) {
    problems.push("requiredConsecutiveCloses must be an integer of at least 1");
  } else if (requiredConsecutiveCloses > 10) {
    problems.push("requiredConsecutiveCloses must be at most 10");
  }

  if (config.minGroupsToQualify < 1 || config.minGroupsToQualify > ALL_EVIDENCE_GROUPS.length) {
    problems.push(`minGroupsToQualify must be between 1 and ${ALL_EVIDENCE_GROUPS.length}`);
  }

  return problems;
}

/** Fails loudly at the entry point rather than quietly producing a plausible wrong answer. */
export function assertValidPremarketExpansionConfig(
  config: StrategyConfig["premarketExpansion"]
): void {
  const problems = validatePremarketExpansionConfig(config);
  if (problems.length > 0) {
    throw new Error(`Invalid premarketExpansion config: ${problems.join("; ")}`);
  }
}

/**
 * Evaluates the whole candidate for one symbol in one direction.
 *
 * The bearish path is not a separate code path — every rule takes
 * `direction` and mirrors internally, so there is one implementation to
 * keep correct rather than two that can drift.
 */
export function detectPremarketExpansion(
  input: PremarketExpansionInput,
  config: StrategyConfig["premarketExpansion"]
): PremarketExpansionResult {
  const {
    symbol,
    direction,
    premarketCandles,
    confirmationCandles,
    dailyCandles,
    todayTradingDate,
    todaySession,
    baseline,
    elapsedPremarketMinutes,
    dailyAtr,
    benchmarkSymbol,
    benchmarkPremarketCandles,
    benchmarkDailyCandles,
    feed,
    datasetIncomplete,
    candleIntervalMinutes,
    scannedAt,
  } = input;

  assertValidPremarketExpansionConfig(config);

  const ranges = computePremarketRanges(premarketCandles, config.minReferenceBars);
  const latest = ranges.evaluationBar;
  const latestBenchmark = latestBar(benchmarkPremarketCandles);

  const move = measureMoveFromPriorClose(latest, dailyCandles, todayTradingDate);
  const currentPrice = move.currentPrice;

  const volumePace = measureVolumePace(todaySession, baseline, elapsedPremarketMinutes, config);
  const rangeExpansion = measureRangeExpansion(todaySession, baseline, config);
  const rangePosition = measureRangePosition(currentPrice, ranges, direction, config);

  const benchmarkMove = measureMoveFromPriorClose(
    latestBenchmark,
    benchmarkDailyCandles,
    todayTradingDate
  );
  const relativeStrength = measureRelativeStrength(
    benchmarkSymbol,
    move,
    benchmarkMove,
    latest?.time ?? null,
    latestBenchmark?.time ?? null,
    direction,
    config
  );

  // Levels first: acceptance feeds back into the prior-day interaction
  // state, since a broken level and an ACCEPTED broken level differ.
  const prior = findPreviousDailyCandle(dailyCandles, todayTradingDate);
  const levels: ActiveLevel[] = [];
  const referenceLevel = direction === "bullish" ? ranges.referenceHigh : ranges.referenceLow;
  if (referenceLevel !== null) levels.push({ name: "premarket_reference", price: referenceLevel });
  if (prior) levels.push({ name: "prior_day", price: direction === "bullish" ? prior.high : prior.low });

  const confirmation = assessConfirmation(
    confirmationCandles,
    levels,
    currentPrice,
    direction,
    config.requiredConsecutiveCloses
  );

  const priorDayLevel = prior ? (direction === "bullish" ? prior.high : prior.low) : null;
  const everTradedBeyond =
    priorDayLevel !== null &&
    premarketCandles.some((c) =>
      direction === "bullish" ? gt(c.high, priorDayLevel) : lt(c.low, priorDayLevel)
    );
  const priorLevelAccepted =
    confirmation.state === "accepted" &&
    confirmation.brokenLevels.some((l) => l.name === "prior_day");

  const priorLevel = measurePriorLevelProximity(
    currentPrice,
    dailyCandles,
    todayTradingDate,
    dailyAtr,
    direction,
    config,
    { everTradedBeyond, accepted: priorLevelAccepted }
  );

  const structure = measureStructure(premarketCandles, direction, config.structurePivotLength);
  const priorDayInteraction = measurePriorDayInteraction(priorLevel);

  const groups = buildGroups(
    { volumePace, rangeExpansion, rangePosition, structure, priorDayInteraction, relativeStrength },
    direction
  );

  const passing = groups.filter((g) => g.state === "pass");
  const evaluableGroups = groups.filter((g) => g.state !== "unavailable").length;
  const corroboratingGroupPassed = passing.some((g) => CORROBORATING_GROUPS.includes(g.name));

  const invalidation = chooseInvalidation(
    currentPrice,
    premarketCandles,
    structure,
    ranges,
    confirmation,
    direction
  );

  const freshness = assessFreshness(
    scannedAt,
    latest,
    candleIntervalMinutes,
    feed,
    datasetIncomplete,
    config
  );

  const gatePassed = passing.length >= config.minGroupsToQualify && corroboratingGroupPassed;
  const qualified = gatePassed && freshnessAllowsNewCandidate(freshness.status, feed);

  return {
    symbol,
    direction,
    qualified,
    contextLabel: buildContextLabel(direction, gatePassed),
    stage: deriveStage(gatePassed, confirmation, priorLevel),
    move,
    ranges,
    volumePace,
    rangeExpansion,
    rangePosition,
    relativeStrength,
    priorLevel,
    structure,
    priorDayInteraction,
    groups,
    passingGroups: passing.length,
    totalGroups: groups.length,
    evaluableGroups,
    corroboratingGroupPassed,
    confirmation,
    invalidation,
    freshness,
  };
}

/** Observable stage, derived only from states the data actually shows. */
function deriveStage(
  gatePassed: boolean,
  confirmation: ConfirmationResult,
  priorLevel: PriorLevelProximityResult
): ExpansionStage {
  if (confirmation.state === "accepted") return "breakout_accepted";
  if (priorLevel.interaction === "rejected") return "invalidated";
  if (confirmation.state === "awaiting_acceptance") return "level_break";
  if (gatePassed) return "premarket_candidate";
  if (priorLevel.interaction === "approaching" || priorLevel.interaction === "testing") {
    return "context_developing";
  }
  return "inactive";
}

function buildGroups(
  results: {
    volumePace: BaselineComparisonResult;
    rangeExpansion: BaselineComparisonResult;
    rangePosition: RangePositionResult;
    structure: StructureResult;
    priorDayInteraction: PriorDayInteractionResult;
    relativeStrength: RelativeStrengthResult;
  },
  direction: ExpansionDirection
): EvidenceGroup[] {
  const {
    volumePace,
    rangeExpansion,
    rangePosition,
    structure,
    priorDayInteraction,
    relativeStrength,
  } = results;

  return [
    {
      name: "participation",
      state: volumePace.state,
      detail:
        volumePace.multiple !== null
          ? `${volumePace.multiple.toFixed(1)}× median volume, ${volumePace.baselineSampleSize} eligible sessions`
          : BASELINE_REASON_TEXT[volumePace.reason ?? "no_current_window"],
    },
    {
      name: "rangeExpansion",
      state: rangeExpansion.state,
      detail:
        rangeExpansion.multiple !== null
          ? `${rangeExpansion.multiple.toFixed(1)}× median range, ${rangeExpansion.baselineSampleSize} eligible sessions`
          : BASELINE_REASON_TEXT[rangeExpansion.reason ?? "no_current_window"],
    },
    {
      name: "rangeLocation",
      state: rangePosition.state,
      detail:
        rangePosition.rawPositionPercent !== null
          ? `${rangePosition.rawPositionPercent.toFixed(0)}% of premarket reference range`
          : "Premarket reference range not established",
    },
    {
      name: "structure",
      state: structure.state,
      detail: structure.insufficientData
        ? `Not enough confirmed pivots yet (${structure.pivotCount})`
        : direction === "bullish"
        ? `Latest pivot low $${structure.latestPivotPrice!.toFixed(2)} vs prior $${structure.previousPivotPrice!.toFixed(2)}`
        : `Latest pivot high $${structure.latestPivotPrice!.toFixed(2)} vs prior $${structure.previousPivotPrice!.toFixed(2)}`,
    },
    {
      name: "priorDayInteraction",
      state: priorDayInteraction.state,
      detail: describeInteraction(priorDayInteraction.proximity, direction),
    },
    {
      name: "benchmarkRelativeMove",
      state: relativeStrength.state,
      detail:
        relativeStrength.relativePct !== null
          ? `${relativeStrength.label} ${relativeStrength.benchmarkSymbol} by ${formatSignedPct(relativeStrength.relativePct)}`
          : relativeStrength.timestampMismatch
          ? `${relativeStrength.benchmarkSymbol} bar timestamp does not match — not comparable`
          : `${relativeStrength.benchmarkSymbol} data unavailable`,
    },
  ];
}

export function describeInteraction(
  proximity: PriorLevelProximityResult,
  direction: ExpansionDirection
): string {
  const levelWord = direction === "bullish" ? "Prior-day high" : "Prior-day low";
  if (proximity.insufficientData || proximity.absoluteDistance === null) {
    return `${levelWord}: Unavailable`;
  }

  const magnitude = `$${proximity.absoluteDistance.toFixed(2)} (${proximity.percentDistance!.toFixed(2)}%)`;
  // The direction word follows the SIGN, not the evaluated direction —
  // one unambiguous convention, so "above" always means above.
  const sideWord = proximity.signedDistance! >= 0 ? "above" : "below";

  switch (proximity.interaction) {
    case "testing":
      return `${levelWord}: Testing level`;
    case "broken":
      return `${levelWord}: Broken, ${magnitude} ${sideWord}`;
    case "accepted":
      return `${levelWord}: Accepted, ${magnitude} ${sideWord}`;
    case "rejected":
      return `${levelWord}: Rejected, back ${magnitude} ${sideWord}`;
    case "approaching":
      return `${levelWord}: ${magnitude} away (Approaching)`;
    default:
      return `${levelWord}: ${magnitude} away`;
  }
}

/** Never "Bias", never "pressure building", never a likelihood. */
function buildContextLabel(direction: ExpansionDirection, gatePassed: boolean): string {
  const word = direction === "bullish" ? "Bullish" : "Bearish";
  return gatePassed ? `${word} context developing` : `${word} context not established`;
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
}

/** Eastern clock label for a bar, e.g. "9:24 AM ET". Used by both display formats. */
export function formatBarClock(timeSeconds: number): string {
  const { minutesSinceMidnight } = getEasternTimeParts(new Date(timeSeconds * 1000));
  const hour24 = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix} ET`;
}
