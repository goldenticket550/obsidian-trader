import { exchangeCalendarDay, tradingSessionsSince, type ExchangeSessionPhase } from "./exchangeCalendar";

export const DEFAULT_MIN_HISTORY_SESSIONS = 120;

export type AttentionDataQualityState =
  | "warming_up"
  | "ok"
  | "limited_history"
  | "insufficient_baseline"
  | "stale"
  | "halted"
  | "resumed"
  | "suspect"
  | "market_closed"
  | "not_applicable";

export interface DataQualityEvaluationInput {
  tradingDate: string;
  sessionPhase: ExchangeSessionPhase;
  listedSince?: string;
  minHistorySessions?: number;
  baselineSampleSize: number;
  minBaselineSessions: number;
  availableBars: number;
  minimumBars: number;
  stale?: boolean;
  halted?: boolean;
  resumed?: boolean;
  suspect?: boolean;
  applicable?: boolean;
}

export interface AttentionDataQuality {
  state: AttentionDataQualityState;
  reason: string;
  sessionsSinceListing: number | null;
  minHistorySessions: number;
  rankEligible: boolean;
  thresholdCalibrationEligible: boolean;
}

export function evaluateAttentionDataQuality(input: DataQualityEvaluationInput): AttentionDataQuality {
  const minHistorySessions = input.minHistorySessions ?? DEFAULT_MIN_HISTORY_SESSIONS;
  if (!Number.isInteger(minHistorySessions) || minHistorySessions < 1) throw new Error("minHistorySessions must be a positive integer.");
  const sessionsSinceListing = input.listedSince ? tradingSessionsSince(input.listedSince, input.tradingDate) : null;
  let state: AttentionDataQualityState;
  let reason: string;
  if (input.applicable === false) { state = "not_applicable"; reason = "metric does not apply"; }
  else if (!exchangeCalendarDay(input.tradingDate).isTradingDay || input.sessionPhase === "closed") { state = "market_closed"; reason = "exchange calendar is closed"; }
  else if (input.halted) { state = "halted"; reason = "trading halt active"; }
  else if (input.resumed) { state = "resumed"; reason = "post-halt resumption guard active"; }
  else if (input.suspect) { state = "suspect"; reason = "provider or ingestion integrity is suspect"; }
  else if (input.stale) { state = "stale"; reason = "latest completed bar is stale"; }
  else if (input.baselineSampleSize < input.minBaselineSessions) { state = "insufficient_baseline"; reason = `${input.baselineSampleSize}/${input.minBaselineSessions} baseline sessions`; }
  else if (sessionsSinceListing !== null && sessionsSinceListing < minHistorySessions) { state = "limited_history"; reason = `${sessionsSinceListing}/${minHistorySessions} sessions since listing`; }
  else if (input.availableBars < input.minimumBars) { state = "warming_up"; reason = `${input.availableBars}/${input.minimumBars} required bars`; }
  else { state = "ok"; reason = "all required inputs available"; }
  return {
    state,
    reason,
    sessionsSinceListing,
    minHistorySessions,
    rankEligible: state === "ok" || state === "limited_history" || state === "resumed",
    thresholdCalibrationEligible: state === "ok",
  };
}

export interface CohortRow { symbol: string; dataQualityState: AttentionDataQualityState; }

export function splitEstablishedAndLimitedHistory<T extends CohortRow>(rows: readonly T[]): { established: T[]; limitedHistory: T[] } {
  return {
    established: rows.filter((row) => row.dataQualityState !== "limited_history"),
    limitedHistory: rows.filter((row) => row.dataQualityState === "limited_history"),
  };
}
