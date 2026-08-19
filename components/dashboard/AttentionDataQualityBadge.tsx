import type { AttentionDataQualityState } from "@/lib/attention/dataQuality";

const LABELS: Record<AttentionDataQualityState, string> = {
  warming_up: "Warming up",
  ok: "Data ready",
  limited_history: "Limited history",
  insufficient_baseline: "Insufficient baseline",
  stale: "Stale",
  halted: "Halted",
  resumed: "Resumed",
  suspect: "Data suspect",
  market_closed: "Market closed",
  not_applicable: "Not applicable",
};

export function AttentionDataQualityBadge({ state, reason }: { state: AttentionDataQualityState; reason?: string }) {
  return <span data-attention-quality={state} title={reason}>{LABELS[state]}</span>;
}
