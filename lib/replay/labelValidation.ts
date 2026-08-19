import type { GroundTruthLabel, LabelSource, SessionLabels } from "./types";

export interface LabelValidationResult {
  status: "passed" | "failed" | "not_applicable_quiet";
  rejectionRate: number | null;
  warnings: string[];
}

export function validateReplayLabels(labels: SessionLabels): LabelValidationResult {
  const warnings: string[] = [];
  const stats = labels.reviewStats;
  const adjudicated = labels.labels.filter((label) => label.source === "trader_adjudicated");
  const rejectionRate = stats.autoCandidates === 0 ? null : stats.rejected / stats.autoCandidates;

  if (labels.quietSession === true && labels.reviewCompleted) {
    return { status: "not_applicable_quiet", rejectionRate, warnings };
  }
  if (labels.quietSession === null) warnings.push("Quiet-session status was not explicitly adjudicated; unlabelled is not empty.");
  if (!labels.reviewCompleted) warnings.push("Trader review is incomplete.");
  if (stats.pending > 0) warnings.push(`${stats.pending} movement-selected candidate(s) remain pending.`);
  if (adjudicated.length === 0) warnings.push("No trader_adjudicated labels exist; executed trades alone cannot validate discovery.");
  if (rejectionRate === 0) warnings.push("Trader rejection rate is 0%; movement-selected labels are circular without genuine rejections.");
  if (rejectionRate === null) warnings.push("No auto-candidates were adjudicated, so a rejection rate cannot be established.");
  return { status: warnings.length === 0 ? "passed" : "failed", rejectionRate, warnings };
}

export interface SourceHitRate {
  source: LabelSource;
  labels: number;
  surfaced: number;
  hitRate: number | null;
}

export function hitRatesByLabelSource(
  labels: GroundTruthLabel[],
  surfaced: (label: GroundTruthLabel) => boolean
): SourceHitRate[] {
  return (["executed_trade", "trader_adjudicated"] as const).map((source) => {
    const sourceLabels = labels.filter((label) => label.source === source);
    const hits = sourceLabels.filter(surfaced).length;
    return { source, labels: sourceLabels.length, surfaced: hits, hitRate: sourceLabels.length === 0 ? null : hits / sourceLabels.length };
  });
}
