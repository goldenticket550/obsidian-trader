// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AttentionScoreBreakdown } from "@/components/dashboard/AttentionScoreBreakdown";
import { DEFAULT_ATTENTION_AXIS_CONFIG, normalizeAttentionAxis, type AttentionAxisResult, type IdiosyncrasyAxisResult, type ParticipationAxisResult } from "@/lib/attention/attentionAxes";
import { scoreAttention } from "@/lib/attention/attentionScore";
import { calibrationSetForScore, createPendingFeedAwareThresholdStore, markCalibrationUnavailableByConstruction } from "@/lib/replay/feedAwareAttentionThresholds";

afterEach(() => cleanup());

const evidence = { name: "evidence", rawValue: 2, baselineMedian: 0, baselineMad: 1, pPresent: null, surpriseBits: null, signalKind: "median_mad_z" as const, baselineMode: "continuous" as const, baselineState: "ok", baselineTransform: "linear" as const, z: 2 };
const curve = DEFAULT_ATTENTION_AXIS_CONFIG.displacement;
const p: ParticipationAxisResult = { axis: "participation", status: "ok", value: 2, normalizationInput: 2, normalizationInputKind: "z", z50: curve.z50, k: curve.k, normalized: normalizeAttentionAxis(2, curve), baselineMode: "dense", components: [{ ...evidence, baselineTransform: "log1p" }], unavailableReason: null, firstObservedActivity: false, requiresDisplacementConfluence: false, currentVolume: 1234, currentDollarVolume: 123400 };
const d: AttentionAxisResult = { axis: "displacement", status: "ok", value: 2, normalizationInput: 2, normalizationInputKind: "z", z50: curve.z50, k: curve.k, normalized: normalizeAttentionAxis(2, curve), baselineMode: "continuous", components: [evidence], unavailableReason: null };
const i: IdiosyncrasyAxisResult = { ...d, axis: "idiosyncrasy", components: [evidence], stockReturn: 0.02, benchmarkReturn: 0, sectorReturn: 0.01, stockVsBenchmark: 0.02, sectorVsBenchmark: 0.01, classification: "stock_specific" };
const calibrationStore = createPendingFeedAwareThresholdStore(3);

describe("A2 score explanation UI", () => {
  it("labels every Path B volume figure IEX PARTIAL and marks conclusions refused", () => {
    render(<AttentionScoreBreakdown result={scoreAttention({ feedMode: "iex_partial", subWindow: "regular", participation: p, displacement: d, idiosyncrasy: i, calibrationSet: calibrationSetForScore(calibrationStore, "regular", "iex_partial") })} />);
    expect(screen.getAllByText("IEX PARTIAL")).toHaveLength(2);
    expect(screen.getByText(/conclusions refused/)).toBeTruthy();
    expect(screen.getByText(/curve v1/)).toBeTruthy();
  });

  it("shows unavailable on partial feed and emits no score for a structurally unavailable window", () => {
    const unavailable = markCalibrationUnavailableByConstruction(calibrationStore, {
      feedMode: "iex_partial", subWindow: "premarket_core", reason: "insufficient_reference",
    });
    const result = scoreAttention({
      feedMode: "iex_partial", subWindow: "premarket_core", participation: p, displacement: d, idiosyncrasy: i,
      calibrationSet: calibrationSetForScore(unavailable, "premarket_core", "iex_partial"),
    });
    render(<AttentionScoreBreakdown result={result} />);
    expect(result).toMatchObject({ status: "unavailable", unavailableReason: "insufficient_reference", attention: null });
    expect(screen.getByText("unavailable on partial feed")).toBeTruthy();
  });
});
