import type { Candle } from "@/types/candle";

export const DEFAULT_LISTING_GAP_DAYS = 45;
export const DEFAULT_LISTING_DATE_TOLERANCE_DAYS = 5;
export const DEFAULT_WHEN_ISSUED_PROBE_SESSIONS = 10;
export const DEFAULT_WHEN_ISSUED_VOLUME_RATIO = 0.20;
export const DEFAULT_WHEN_ISSUED_COMPARISON_SESSIONS = 30;
const DAY_MS = 86_400_000;

export type ListingResolutionRule = "gap_rule" | "when_issued" | "authored_override" | "first_bar";

export interface ListingDateDerivationOptions {
  listingGapDays?: number;
  listingDateToleranceDays?: number;
  whenIssuedProbeSessions?: number;
  whenIssuedVolumeRatio?: number;
  whenIssuedComparisonSessions?: number;
}

export interface WhenIssuedEvidence {
  possibleWhenIssued: boolean;
  probeSessions: number;
  comparisonSessions: number;
  probeMedianVolume: number | null;
  comparisonMedianVolume: number | null;
  observedVolumeRatio: number | null;
  thresholdVolumeRatio: number;
  excludedLeadingSessions: number;
}

export interface ListingDateResolution {
  symbol: string;
  authoredListedSince: string | null;
  derivedCandidateDate: string;
  effectiveListedSince: string;
  firstAvailableDate: string;
  previousBarDate: string | null;
  largestGapDays: number | null;
  derivation: "first_bar" | "largest_gap";
  resolutionRule: ListingResolutionRule;
  listingGapDays: number;
  listingDateToleranceDays: number;
  authoredDifferenceDays: number | null;
  whenIssued: WhenIssuedEvidence;
  barsInspected: number;
}

export class PossibleWhenIssuedError extends Error {
  readonly code = "possible_when_issued";
  constructor(readonly symbol: string, readonly candidateDate: string, readonly evidence: WhenIssuedEvidence) {
    super(`possible_when_issued for ${symbol} at ${candidateDate}; human adjudication is required.`);
    this.name = "PossibleWhenIssuedError";
  }
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function dateFromBar(bar: Pick<Candle, "time">): string {
  if (!Number.isFinite(bar.time)) throw new Error("Daily listing history contains an invalid timestamp.");
  return new Date(bar.time * 1000).toISOString().slice(0, 10);
}

function calendarDaysBetween(left: string, right: string): number {
  return Math.abs(Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / DAY_MS;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function volumeEvidence(
  leading: readonly Pick<Candle, "volume">[],
  comparison: readonly Pick<Candle, "volume">[],
  probeSessions: number,
  comparisonSessions: number,
  thresholdVolumeRatio: number,
  excludedLeadingSessions: number
): WhenIssuedEvidence {
  if (leading.length < probeSessions || comparison.length < comparisonSessions) {
    return { possibleWhenIssued: false, probeSessions, comparisonSessions, probeMedianVolume: null, comparisonMedianVolume: null, observedVolumeRatio: null, thresholdVolumeRatio, excludedLeadingSessions };
  }
  const probeMedianVolume = median(leading.slice(0, probeSessions).map((bar) => bar.volume));
  const comparisonMedianVolume = median(comparison.slice(0, comparisonSessions).map((bar) => bar.volume));
  const observedVolumeRatio = probeMedianVolume !== null && comparisonMedianVolume !== null && comparisonMedianVolume > 0
    ? probeMedianVolume / comparisonMedianVolume
    : null;
  return {
    possibleWhenIssued: observedVolumeRatio !== null && observedVolumeRatio < thresholdVolumeRatio,
    probeSessions,
    comparisonSessions,
    probeMedianVolume,
    comparisonMedianVolume,
    observedVolumeRatio,
    thresholdVolumeRatio,
    excludedLeadingSessions,
  };
}

export function deriveEffectiveListingDate(
  symbol: string,
  dailyBars: readonly Pick<Candle, "time" | "volume">[],
  authoredListedSince?: string,
  options: ListingDateDerivationOptions = {}
): ListingDateResolution {
  const listingGapDays = options.listingGapDays ?? DEFAULT_LISTING_GAP_DAYS;
  const listingDateToleranceDays = options.listingDateToleranceDays ?? DEFAULT_LISTING_DATE_TOLERANCE_DAYS;
  const whenIssuedProbeSessions = options.whenIssuedProbeSessions ?? DEFAULT_WHEN_ISSUED_PROBE_SESSIONS;
  const whenIssuedVolumeRatio = options.whenIssuedVolumeRatio ?? DEFAULT_WHEN_ISSUED_VOLUME_RATIO;
  const whenIssuedComparisonSessions = options.whenIssuedComparisonSessions ?? DEFAULT_WHEN_ISSUED_COMPARISON_SESSIONS;
  if (!Number.isFinite(listingGapDays) || listingGapDays <= 0) throw new Error("listingGapDays must be positive.");
  if (!Number.isFinite(listingDateToleranceDays) || listingDateToleranceDays < 0) throw new Error("listingDateToleranceDays must be non-negative.");
  if (!Number.isInteger(whenIssuedProbeSessions) || whenIssuedProbeSessions < 1) throw new Error("whenIssuedProbeSessions must be a positive integer.");
  if (!(whenIssuedVolumeRatio > 0 && whenIssuedVolumeRatio < 1)) throw new Error("whenIssuedVolumeRatio must be in (0, 1).");
  if (!Number.isInteger(whenIssuedComparisonSessions) || whenIssuedComparisonSessions < 1) throw new Error("whenIssuedComparisonSessions must be a positive integer.");
  if (authoredListedSince) assertIsoDate(authoredListedSince, `authored listedSince for ${symbol}`);
  if (dailyBars.length === 0) throw new Error(`Cannot derive listedSince for ${symbol}: full daily history is empty.`);

  const byDate = new Map<string, Pick<Candle, "time" | "volume">>();
  for (const bar of dailyBars) {
    if (!Number.isFinite(bar.volume) || bar.volume < 0) throw new Error(`Daily listing history contains invalid volume for ${symbol}.`);
    byDate.set(dateFromBar(bar), bar);
  }
  const bars = [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, bar]) => ({ date, ...bar }));
  let candidateIndex = 0;
  let previousBarDate: string | null = null;
  let largestGapDays: number | null = null;
  for (let index = 1; index < bars.length; index += 1) {
    const gapDays = calendarDaysBetween(bars[index - 1].date, bars[index].date);
    if (gapDays > listingGapDays && (largestGapDays === null || gapDays > largestGapDays)) {
      largestGapDays = gapDays;
      previousBarDate = bars[index - 1].date;
      candidateIndex = index;
    }
  }

  const derivedCandidateDate = bars[candidateIndex].date;
  const gapTriggered = largestGapDays !== null;
  const defaultEvidence = gapTriggered
    ? volumeEvidence([], [], whenIssuedProbeSessions, whenIssuedComparisonSessions, whenIssuedVolumeRatio, 0)
    : volumeEvidence(
      bars.slice(candidateIndex, candidateIndex + whenIssuedProbeSessions),
      bars.slice(candidateIndex + whenIssuedProbeSessions, candidateIndex + whenIssuedProbeSessions + whenIssuedComparisonSessions),
      whenIssuedProbeSessions,
      whenIssuedComparisonSessions,
      whenIssuedVolumeRatio,
      0
    );

  let effectiveListedSince = derivedCandidateDate;
  let resolutionRule: ListingResolutionRule = gapTriggered ? "gap_rule" : "first_bar";
  let whenIssued = defaultEvidence;
  const authoredIndex = authoredListedSince ? bars.findIndex((bar) => bar.date >= authoredListedSince) : -1;
  if (!gapTriggered && authoredListedSince && authoredListedSince > derivedCandidateDate && authoredIndex > candidateIndex) {
    const leadingCount = authoredIndex - candidateIndex;
    const authoredEvidence = volumeEvidence(
      bars.slice(candidateIndex, authoredIndex),
      bars.slice(authoredIndex, authoredIndex + whenIssuedComparisonSessions),
      leadingCount,
      whenIssuedComparisonSessions,
      whenIssuedVolumeRatio,
      leadingCount
    );
    if (authoredEvidence.possibleWhenIssued) {
      effectiveListedSince = authoredListedSince;
      resolutionRule = "authored_override";
      whenIssued = authoredEvidence;
    }
  }

  if (!gapTriggered && defaultEvidence.possibleWhenIssued && resolutionRule === "first_bar") {
    throw new PossibleWhenIssuedError(symbol, derivedCandidateDate, defaultEvidence);
  }

  const authoredDifferenceDays = authoredListedSince
    ? calendarDaysBetween(authoredListedSince, derivedCandidateDate)
    : null;
  if (authoredDifferenceDays !== null && authoredDifferenceDays > listingDateToleranceDays && resolutionRule !== "authored_override") {
    throw new Error(
      `Listing-date disagreement for ${symbol}: authored=${authoredListedSince}, derived=${derivedCandidateDate}, ` +
      `difference=${authoredDifferenceDays} days exceeds tolerance=${listingDateToleranceDays}.`
    );
  }

  return {
    symbol,
    authoredListedSince: authoredListedSince ?? null,
    derivedCandidateDate,
    effectiveListedSince,
    firstAvailableDate: bars[0].date,
    previousBarDate,
    largestGapDays,
    derivation: gapTriggered ? "largest_gap" : "first_bar",
    resolutionRule,
    listingGapDays,
    listingDateToleranceDays,
    authoredDifferenceDays,
    whenIssued,
    barsInspected: bars.length,
  };
}
