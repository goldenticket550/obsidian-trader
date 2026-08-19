import { describe, expect, it } from "vitest";
import { hitRatesByLabelSource, validateReplayLabels } from "@/lib/replay/labelValidation";
import type { GroundTruthLabel, SessionLabels } from "@/lib/replay/types";

const label = (source: GroundTruthLabel["source"], symbol: string, missedByCandidateGenerator = false): GroundTruthLabel => ({
  symbol, time_it_became_interesting: "10:00:00", time_i_actually_noticed: null,
  actual_notice_confidence: "unknown", direction: "bullish", reason_tags: [], note: "",
  source, selectionBiased: source === "executed_trade", missedByCandidateGenerator, editedFields: [],
});

const session = (overrides: Partial<SessionLabels> = {}): SessionLabels => ({
  tradingDate: "2025-08-15", quietSession: false, reviewCompleted: true,
  reviewStats: { autoCandidates: 2, accepted: 1, rejected: 1, pending: 0, manualAdds: 0 },
  labels: [label("trader_adjudicated", "NVDA")], ...overrides,
});

describe("§2.3b replay circularity guard", () => {
  it("fails executed-only label sets even when trades are high confidence", () => {
    const result = validateReplayLabels(session({ labels: [label("executed_trade", "NVDA")] }));
    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toMatch(/cannot validate discovery/);
  });

  it("fails a zero-percent trader rejection rate", () => {
    const result = validateReplayLabels(session({ reviewStats: { autoCandidates: 2, accepted: 2, rejected: 0, pending: 0, manualAdds: 0 } }));
    expect(result.status).toBe("failed");
    expect(result.rejectionRate).toBe(0);
  });

  it("passes completed, non-quiet review with trader labels and real rejection", () => {
    expect(validateReplayLabels(session())).toEqual({ status: "passed", rejectionRate: 0.5, warnings: [] });
  });

  it("keeps hit rates separated by source and flags manual discoveries independently", () => {
    const labels = [label("executed_trade", "NVDA"), label("trader_adjudicated", "AMD"), label("trader_adjudicated", "TSLA", true)];
    expect(hitRatesByLabelSource(labels, (item) => item.symbol !== "AMD")).toEqual([
      { source: "executed_trade", labels: 1, surfaced: 1, hitRate: 1 },
      { source: "trader_adjudicated", labels: 2, surfaced: 1, hitRate: 0.5 },
    ]);
    expect(labels.filter((item) => item.missedByCandidateGenerator).map((item) => item.symbol)).toEqual(["TSLA"]);
  });

  it("does not reinterpret an unreviewed session as quiet", () => {
    const result = validateReplayLabels(session({ quietSession: null, reviewCompleted: false }));
    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toMatch(/unlabelled is not empty/);
  });
});
