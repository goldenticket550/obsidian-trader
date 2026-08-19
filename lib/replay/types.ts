import type { Candle, Timeframe } from "@/types/candle";
import type { BarAdjustment } from "@/lib/market-data/types";

export interface RecordedSession {
  schemaVersion: 1;
  tradingDate: string;
  feed: "sip";
  adjustment: BarAdjustment;
  source: "historical_pull";
  recordedAt: string;
  bars: Record<string, Partial<Record<Timeframe, Candle[]>>>;
}

export const REASON_TAGS = [
  "volume_wakeup", "range_expansion", "HOD_retest", "LOD_retest", "PMH_reclaim",
  "PML_reclaim", "PDH_break", "PDL_break", "VWAP_reclaim", "VWAP_loss",
  "intraday_reversal", "continuation", "sector_momentum", "relative_strength",
  "relative_weakness", "opening_range", "unknown",
] as const;

export type ReasonTag = (typeof REASON_TAGS)[number];
export type LabelSource = "executed_trade" | "trader_adjudicated";
export type LabelCandidateDecision = "pending" | "accepted" | "rejected";
export type EditableLabelField =
  | "time_it_became_interesting"
  | "time_i_actually_noticed"
  | "direction"
  | "reason_tags";

export interface GroundTruthLabel {
  id?: string;
  symbol: string;
  time_it_became_interesting: string | null;
  time_i_actually_noticed: string | null;
  actual_notice_confidence: "high" | "low" | "unknown";
  direction: "bullish" | "bearish" | "mixed";
  reason_tags: ReasonTag[];
  note: string;
  source: LabelSource;
  selectionBiased: boolean;
  missedByCandidateGenerator: boolean;
  editedFields: EditableLabelField[];
}

export interface LabelReviewStats {
  autoCandidates: number;
  accepted: number;
  rejected: number;
  pending: number;
  manualAdds: number;
}

export interface SessionLabels {
  tradingDate: string;
  /** Null means the trader has not adjudicated whether the session was quiet. */
  quietSession: boolean | null;
  reviewCompleted: boolean;
  reviewStats: LabelReviewStats;
  labels: GroundTruthLabel[];
}
