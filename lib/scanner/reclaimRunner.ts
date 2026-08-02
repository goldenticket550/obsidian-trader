import type { Candle } from "@/types/candle";
import type { FreshnessStatus } from "@/lib/indicators/premarketExpansion";
import type { ReclaimContinuationConfig } from "@/lib/strategies/reclaimContinuationConfig";
import {
  runReclaimMachine,
  selectMachineCandidate,
  isActiveStage,
  RECLAIM_STAGE_ORDER,
  type ReclaimDirection,
  type ReclaimMachineResult,
  type ReclaimStage,
  type ReclaimSweepEvidence,
} from "./reclaimContinuation";

/**
 * Reclaim & Continuation — the two-timeframe runner.
 *
 * The five-minute machine is the SYSTEM OF RECORD. It alone may reach the
 * actionable stages and the Review Now tier. The one-minute machine is a
 * SCOUT: it runs the identical state machine to surface a candidate
 * earlier, and is capped at Monitor no matter what it shows. That cap is
 * the entire reason the two timeframes are separated — it keeps
 * one-minute noise out of actionable calls.
 *
 * The runner adds no market calculation of its own. It composes two
 * detector runs, states how they relate, and derives a tier from rules.
 *
 * NO CROSS-SCAN OBJECT STATE. The detector re-derives a setup by replaying
 * from the reset extreme forward, so every scan re-runs it against the
 * full completed series and the same identity re-derives deterministically.
 * A partially-advanced setup is never carried between scans and resumed
 * mid-series. Continuity is keyed off `setupKey`, which is already stable
 * (symbol:sessionDate:direction:anchorTime:extremeTime).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReclaimAlertTier = "none" | "early" | "monitor" | "review_now";

export const RECLAIM_TIER_ORDER: Record<ReclaimAlertTier, number> = {
  none: 0,
  early: 1,
  monitor: 2,
  review_now: 3,
};

export type ReclaimAlignment = "aligned" | "one_minute_leading" | "conflicting" | "unavailable";

/** Display text for the alignment states that need one. */
export const MIXED_TIMEFRAMES_LABEL = "Mixed timeframes";

/**
 * One tracked level, in both directions.
 *
 * `high` is what the BULLISH machine treats as resistance ahead of price;
 * `low` is what the BEARISH machine treats as support below it. Either
 * side may be null when only one is known — null is unavailable, never
 * zero and never the other side substituted in.
 */
export interface DirectionalLevel {
  high: number | null;
  low: number | null;
}

/** Per-timeframe series plus the index metadata that series needs. */
export interface ReclaimTimeframeSeries {
  candles: readonly Candle[];
  regularSessionStartIndex: number | null;
  premarketAvailableFromIndex: number | null;
  openingRangeAvailableFromIndex: number | null;
}

export interface ReclaimRunnerInput {
  symbol: string;
  sessionDate: string;
  /** The authoritative series. */
  fiveMinute: ReclaimTimeframeSeries;
  /**
   * The early-warning series. Null when one-minute history is unavailable
   * for this symbol — the five-minute machine still runs, and the runner
   * never fetches anything itself.
   */
  oneMinute: ReclaimTimeframeSeries | null;
  /**
   * ATR in dollars from completed FIVE-minute candles. Both machines
   * measure against it, so "0.35 ATR" is the same dollar amount on each.
   */
  atr: number;

  /**
   * Tracked levels, supplied as a HIGH/LOW pair per source.
   *
   * A single price cannot serve both machines: bullish tracks resistance
   * above price and bearish tracks support below it. Passing one number to
   * both would hand the bearish machine a resistance level relabelled as
   * support — the same price with the wrong meaning.
   */
  priorDayLevel: DirectionalLevel | null;
  premarketLevel: DirectionalLevel | null;
  openingRangeLevel: DirectionalLevel | null;
  structureLevel: DirectionalLevel | null;
  /**
   * Already self-directional: the detector checks
   * `sweep.direction === machine direction`, so this needs no per-machine
   * selection and is passed through unchanged.
   */
  sweepEvidence: ReclaimSweepEvidence | null;
  freshness: FreshnessStatus | null;
  volumePace: number | null;
  benchmarkRelativeMove: number | null;

  /**
   * setupKeys seen on the previous scan, supplied by the caller's
   * persistence layer. Used only to report whether this is a newly
   * established setup; it never changes a calculation.
   */
  previousSetupKeys?: readonly string[];
}

export interface ReclaimSymbolResult {
  symbol: string;
  sessionDate: string;
  /** Headline: the five-minute read. */
  fiveMinute: ReclaimMachineResult | null;
  /** The one-minute read, for display and alignment only. */
  oneMinute: ReclaimMachineResult | null;
  /** An invalidated setup, kept as history rather than presented as active. */
  historical: ReclaimMachineResult | null;

  stage: ReclaimStage;
  direction: ReclaimDirection | null;
  oneMinuteStage: ReclaimStage;
  alignment: ReclaimAlignment;
  /** Set only when alignment is conflicting. */
  alignmentLabel: string | null;

  /** Rules-derived tier, already capped by timeframe and alignment. */
  alertTier: ReclaimAlertTier;
  /** The tier the five-minute machine alone justifies. */
  fiveMinuteTier: ReclaimAlertTier;
  /** The tier the one-minute machine justifies, before capping. */
  oneMinuteUncappedTier: ReclaimAlertTier;
  /** True when the one-minute read was held back from Review Now. */
  cappedByTimeframe: boolean;
  /** True when a conflicting alignment blocked Review Now. */
  reviewBlockedByAlignment: boolean;

  setupKey: string | null;
  isNewSetup: boolean;
  ambiguous: boolean;
  ambiguousReason: string | null;
}

// ---------------------------------------------------------------------------
// Tier rules
// ---------------------------------------------------------------------------

/**
 * The tier a stage justifies ON ITS OWN TIMEFRAME.
 *
 * Actionable stages — reclaim confirmed, level_test, acceptance,
 * continuation — are Review Now only from the five-minute machine. The
 * one-minute machine may reach the same stages internally, and they are
 * real, but they are reported as Monitor.
 */
export function tierForStage(
  result: ReclaimMachineResult | null,
  timeframe: "five_minute" | "one_minute"
): ReclaimAlertTier {
  if (result === null || !isActiveStage(result.stage)) return "none";

  const actionable =
    result.stage === "level_test" ||
    result.stage === "acceptance" ||
    result.stage === "continuation" ||
    (result.stage === "reclaim" && result.reclaimStatus === "confirmed");

  if (timeframe === "one_minute") {
    // Capped: a one-minute-only read never reaches Review Now.
    return actionable ? "monitor" : result.stage === "reset" ? "early" : "monitor";
  }

  if (actionable) {
    // Reclaim CONFIRMED is a Monitor transition; the Review Now tier
    // begins at level_test.
    return result.stage === "reclaim" ? "monitor" : "review_now";
  }
  if (result.stage === "exhaustion" || result.stage === "reclaim") return "monitor";
  return "early";
}

function higherTier(a: ReclaimAlertTier, b: ReclaimAlertTier): ReclaimAlertTier {
  return RECLAIM_TIER_ORDER[a] >= RECLAIM_TIER_ORDER[b] ? a : b;
}

function capTier(tier: ReclaimAlertTier, ceiling: ReclaimAlertTier): ReclaimAlertTier {
  return RECLAIM_TIER_ORDER[tier] > RECLAIM_TIER_ORDER[ceiling] ? ceiling : tier;
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

/**
 * How the two machines relate. A factual state, never a score.
 *
 * SPEC GAP, flagged deliberately: the four states have no term for "same
 * direction, but the FIVE-minute machine is more than one stage ahead of
 * the one-minute one". That is not a contradiction — the authoritative
 * read is simply further along than the scout — so it is reported as
 * `aligned` rather than invented into a fifth state or mislabelled
 * `conflicting`. Only the one-minute machine LEADING gets its own state,
 * because that is the case the tier cap exists to police.
 */
export function computeAlignment(
  fiveMinute: ReclaimMachineResult | null,
  oneMinute: ReclaimMachineResult | null
): ReclaimAlignment {
  if (fiveMinute === null || oneMinute === null) return "unavailable";
  if (fiveMinute.stage === "unavailable" || oneMinute.stage === "unavailable") {
    return "unavailable";
  }

  if (fiveMinute.direction !== oneMinute.direction) return "conflicting";

  // The one-minute machine claiming a live setup while the authoritative
  // machine has already invalidated is a contradiction, not a lead.
  if (!isActiveStage(fiveMinute.stage) && isActiveStage(oneMinute.stage)) return "conflicting";

  const difference = RECLAIM_STAGE_ORDER[oneMinute.stage] - RECLAIM_STAGE_ORDER[fiveMinute.stage];
  if (difference > 1) return "one_minute_leading";
  return "aligned";
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/**
 * Picks the side of a tracked level this machine actually trades against:
 * the high for bullish, the low for bearish.
 *
 * The detector still takes ONE directional price per level — it is this
 * selection, not the detector, that decides which one is correct.
 */
export function levelForDirection(
  level: DirectionalLevel | null,
  direction: ReclaimDirection
): number | null {
  if (level === null) return null;
  return direction === "bullish" ? level.high : level.low;
}

function machineInputFor(
  input: ReclaimRunnerInput,
  series: ReclaimTimeframeSeries,
  timeframe: "five_minute" | "one_minute",
  direction: ReclaimDirection
) {
  return {
    symbol: input.symbol,
    sessionDate: input.sessionDate,
    direction,
    timeframe,
    candles: series.candles,
    // BOTH machines measure against the five-minute ATR.
    atr: input.atr,
    priorDayLevel: levelForDirection(input.priorDayLevel, direction),
    premarketLevel: levelForDirection(input.premarketLevel, direction),
    premarketAvailableFromIndex: series.premarketAvailableFromIndex,
    openingRangeLevel: levelForDirection(input.openingRangeLevel, direction),
    openingRangeAvailableFromIndex: series.openingRangeAvailableFromIndex,
    regularSessionStartIndex: series.regularSessionStartIndex,
    structureLevel: levelForDirection(input.structureLevel, direction),
    sweepEvidence: input.sweepEvidence,
    freshness: input.freshness,
    volumePace: input.volumePace,
    benchmarkRelativeMove: input.benchmarkRelativeMove,
  };
}

/**
 * Runs both machines for one symbol and combines them.
 *
 * Each machine is run in BOTH directions and resolved to a single active
 * candidate per timeframe before the two timeframes are compared — one
 * active candidate per symbol per machine, then combined.
 */
export function runReclaimForSymbol(
  input: ReclaimRunnerInput,
  config: ReclaimContinuationConfig
): ReclaimSymbolResult {
  const fiveSelection = selectMachineCandidate(
    runReclaimMachine(machineInputFor(input, input.fiveMinute, "five_minute", "bullish"), config),
    runReclaimMachine(machineInputFor(input, input.fiveMinute, "five_minute", "bearish"), config)
  );

  const oneSelection =
    input.oneMinute === null
      ? null
      : selectMachineCandidate(
          runReclaimMachine(
            machineInputFor(input, input.oneMinute, "one_minute", "bullish"),
            config
          ),
          runReclaimMachine(
            machineInputFor(input, input.oneMinute, "one_minute", "bearish"),
            config
          )
        );

  const fiveMinute = fiveSelection.winner;
  const oneMinute = oneSelection?.winner ?? null;

  const alignment = computeAlignment(fiveMinute, oneMinute);
  const fiveMinuteTier = tierForStage(fiveMinute, "five_minute");
  const oneMinuteUncappedTier = tierForStage(oneMinute, "five_minute");
  const oneMinuteCapped = capTier(tierForStage(oneMinute, "one_minute"), "monitor");

  let alertTier = higherTier(fiveMinuteTier, oneMinuteCapped);

  // A conflicting read blocks Review Now outright: the two timeframes
  // disagree, and the honest presentation is "Mixed timeframes".
  const reviewBlockedByAlignment = alignment === "conflicting" && alertTier === "review_now";
  if (alignment === "conflicting") alertTier = capTier(alertTier, "monitor");

  const setupKey = fiveMinute?.setupKey ?? null;

  return {
    symbol: input.symbol,
    sessionDate: input.sessionDate,
    fiveMinute,
    oneMinute,
    historical: fiveSelection.historical,

    // The headline stage is always the five-minute machine's.
    stage: fiveMinute?.stage ?? "unavailable",
    direction: fiveMinute?.direction ?? null,
    oneMinuteStage: oneMinute?.stage ?? "unavailable",
    alignment,
    alignmentLabel: alignment === "conflicting" ? MIXED_TIMEFRAMES_LABEL : null,

    alertTier,
    fiveMinuteTier,
    oneMinuteUncappedTier,
    cappedByTimeframe:
      RECLAIM_TIER_ORDER[oneMinuteUncappedTier] > RECLAIM_TIER_ORDER[oneMinuteCapped],
    reviewBlockedByAlignment,

    setupKey,
    isNewSetup: setupKey !== null && !(input.previousSetupKeys ?? []).includes(setupKey),
    ambiguous: fiveSelection.ambiguous,
    ambiguousReason: fiveSelection.reason,
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const ALIGNMENT_ORDER: Record<ReclaimAlignment, number> = {
  aligned: 0,
  one_minute_leading: 1,
  conflicting: 2,
  unavailable: 3,
};

/** Nulls always sort after real values, never as zero. */
function compareNullableDescending(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function compareNullableAscending(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * Lexicographic ordering — no composite score anywhere.
 *
 * Stage first (five-minute authoritative), then alignment, then recency,
 * then participation, then room to run, then the ticker as a final
 * deterministic tie-break so two runs over the same inputs always produce
 * the same order.
 */
export function compareReclaimCandidates(
  a: ReclaimSymbolResult,
  b: ReclaimSymbolResult
): number {
  const byStage = RECLAIM_STAGE_ORDER[b.stage] - RECLAIM_STAGE_ORDER[a.stage];
  if (byStage !== 0) return byStage;

  // Reclaim confirmed outranks reclaim forming at the same stage.
  const rank = { none: 0, forming: 1, confirmed: 2 } as const;
  const aStatus = a.fiveMinute ? rank[a.fiveMinute.reclaimStatus] : -1;
  const bStatus = b.fiveMinute ? rank[b.fiveMinute.reclaimStatus] : -1;
  if (aStatus !== bStatus) return bStatus - aStatus;

  const byAlignment = ALIGNMENT_ORDER[a.alignment] - ALIGNMENT_ORDER[b.alignment];
  if (byAlignment !== 0) return byAlignment;

  const byRecency = compareNullableDescending(
    a.fiveMinute?.stageChangedAt ?? null,
    b.fiveMinute?.stageChangedAt ?? null
  );
  if (byRecency !== 0) return byRecency;

  const byVolume = compareNullableDescending(
    a.fiveMinute?.volumePace ?? null,
    b.fiveMinute?.volumePace ?? null
  );
  if (byVolume !== 0) return byVolume;

  // For level-test candidates, the shorter valid distance to confirmation.
  if (a.stage === "level_test" && b.stage === "level_test") {
    const byDistance = compareNullableAscending(
      a.fiveMinute?.distanceToNextLevelAtr ?? null,
      b.fiveMinute?.distanceToNextLevelAtr ?? null
    );
    if (byDistance !== 0) return byDistance;
  }

  return a.symbol.localeCompare(b.symbol);
}

/** Sorts without mutating the caller's array. Displayed rank is position only. */
export function rankReclaimCandidates(
  candidates: readonly ReclaimSymbolResult[]
): ReclaimSymbolResult[] {
  return [...candidates].sort(compareReclaimCandidates);
}
