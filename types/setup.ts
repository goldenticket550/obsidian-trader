import type { Timeframe, DataQuality } from "./candle";

export type SetupStatus = "red" | "yellow" | "green";

export type SetupStage =
  | "none"
  | "intraday_decline"
  | "recovery_from_low"
  | "consecutive_bullish"
  | "liquidity_sweep"
  | "structure_shift"
  | "ema_reclaim"
  | "fair_value_gap"
  | "gap_proximity"
  | "confirmed";

export type ConditionState = "pass" | "fail" | "waiting" | "invalidated";

/**
 * One row in the setup checklist. Every condition must be traceable to a
 * concrete calculated value — no free-floating AI confidence scores.
 */
export interface SetupCondition {
  id: string;
  label: string;
  state: ConditionState;
  /** Human-readable calculated value, e.g. "$2.34 recovered from low" */
  detail?: string;
  required: boolean;
}

export interface SetupResult {
  symbol: string;
  timeframe: Timeframe;
  quality: DataQuality;
  stage: SetupStage;
  status: SetupStatus;
  score: number;
  maxScore: number;
  conditions: SetupCondition[];
  /** When this scan actually ran (wall-clock time), not when the underlying market data occurred. */
  lastUpdated: string; // ISO timestamp
  /**
   * When the most recent candle actually used in this calculation
   * occurred, in market time — distinct from `lastUpdated`. When markets
   * are closed, a scan can run "now" while the underlying data is from
   * the last regular session; without this field, alerts and the UI had
   * no way to distinguish "just calculated" from "based on Friday's
   * close," which caused real confusion once background scanning made
   * scan time and market time routinely diverge. Null only when there
   * were no candles to calculate from at all.
   */
  latestCandleTime?: string | null;
}
