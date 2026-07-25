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
 * Weight tier, directly reflecting the spec's "not all signals are equal"
 * principle: structural evidence (a confirmed structure shift) should
 * count for more than a supporting confirmation (volume), which should
 * count for more than background context. Used to compute a weighted
 * score instead of one flat point per condition.
 */
export type ConditionCategory = "core" | "secondary" | "supporting" | "informational";

export const CATEGORY_WEIGHT: Record<ConditionCategory, number> = {
  core: 3,
  secondary: 2,
  supporting: 1,
  informational: 0.5,
};

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
  /** Weight tier used for the weighted score — defaults to "supporting" if omitted. */
  category?: ConditionCategory;
}

/**
 * A coarser, staged read of where the setup stands — think "how loudly
 * should this be talking to me right now" rather than a single score.
 * WATCH: a few early signs, not yet meaningful. DEVELOPING: real
 * confluence building, most required conditions passing. CONFIRMED: all
 * required conditions pass (matches "green" status). This never means
 * "buy" — it's a volume knob on attention, not a trade signal.
 */
export type ConvictionLevel = "watch" | "developing" | "confirmed";

/**
 * Distinguishes "this setup is real" from "this setup is still a good
 * place to get involved" — a technically valid setup can still be a bad
 * place to enter if price has already run too far. Computed from price's
 * distance from EMA/VWAP relative to recent volatility (ATR), never from
 * a prediction of what happens next.
 *
 * `insufficient_data` (Codex review fix): used specifically when there
 * isn't enough candle history to calculate the EMA/ATR needed to judge
 * extension at all — returning `actionable_now` in that case would be
 * unsafe and misleading, since it looks identical to "we checked and
 * it's fine" when the truth is "we couldn't check." This status is never
 * trading advice — it's a statement about data availability, same as
 * every other status here.
 */
export type EntryStatus =
  | "actionable_now"
  | "wait_for_pullback"
  | "extended_do_not_chase"
  | "invalidated"
  | "insufficient_data";

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
  /** Optional so existing object literals across the codebase don't all need updating. Always populated by scoreSetup(). */
  convictionLevel?: ConvictionLevel;
  entryStatus?: EntryStatus;
  /**
   * A short, deterministic description of what would invalidate this
   * setup at its current stage — e.g. "losing the recovered session low"
   * — computed from already-known structural levels, never a prediction.
   */
  invalidationNote?: string | null;
}
