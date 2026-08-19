import { describe, expect, it } from "vitest";
import {
  DEFAULT_ATTENTION_AXIS_CONFIG,
  normalizeAttentionAxis,
  type AttentionAxisResult,
  type IdiosyncrasyAxisResult,
  type ParticipationAxisResult,
} from "@/lib/attention/attentionAxes";
import {
  ATTENTION_SCORE_CALIBRATION_GUARDS,
  scoreAttention,
} from "@/lib/attention/attentionScore";
import {
  calibrationSetForScore,
  createPendingFeedAwareThresholdStore,
} from "@/lib/replay/feedAwareAttentionThresholds";

const calibrationStore = createPendingFeedAwareThresholdStore(3);

const evidence = (name: string, z: number, baselineTransform: "linear" | "log1p") => ({
  name, rawValue: z, baselineMedian: 0, baselineMad: 1, pPresent: null,
  surpriseBits: null, signalKind: "median_mad_z" as const,
  baselineMode: "continuous" as const, baselineState: "ok", baselineTransform, z,
});

function participation(z: number): ParticipationAxisResult {
  const curve = DEFAULT_ATTENTION_AXIS_CONFIG.participationDense;
  return {
    axis: "participation", status: "ok", value: z, normalizationInput: z, normalizationInputKind: "z",
    z50: curve.z50, k: curve.k, normalized: normalizeAttentionAxis(z, curve),
    baselineMode: "dense", components: [evidence("volume", z, "log1p")], unavailableReason: null, firstObservedActivity: false,
    requiresDisplacementConfluence: false, currentVolume: 1_000, currentDollarVolume: 100_000,
  };
}

function displacement(z: number): AttentionAxisResult {
  const curve = DEFAULT_ATTENTION_AXIS_CONFIG.displacement;
  return {
    axis: "displacement", status: "ok", value: z, normalizationInput: z, normalizationInputKind: "z",
    z50: curve.z50, k: curve.k, normalized: normalizeAttentionAxis(z, curve),
    baselineMode: "continuous", components: [evidence("range_atr", z, "log1p")], unavailableReason: null,
  };
}

function idiosyncrasy(z: number): IdiosyncrasyAxisResult {
  const curve = DEFAULT_ATTENTION_AXIS_CONFIG.idiosyncrasy;
  return {
    axis: "idiosyncrasy", status: "ok", value: z, normalizationInput: z, normalizationInputKind: "z",
    z50: curve.z50, k: curve.k, normalized: normalizeAttentionAxis(z, curve),
    baselineMode: "continuous", components: [evidence("stock_vs_benchmark", z, "linear")], unavailableReason: null, stockReturn: 0.01,
    benchmarkReturn: 0, sectorReturn: 0, stockVsBenchmark: 0.01, sectorVsBenchmark: 0,
    classification: "stock_specific",
  };
}

function score(feedMode: "sip" | "iex_partial", p: number, d: number, i: number) {
  return scoreAttention({
    feedMode,
    subWindow: "regular",
    participation: participation(p),
    displacement: displacement(d),
    idiosyncrasy: idiosyncrasy(i),
    calibrationSet: calibrationSetForScore(calibrationStore, "regular", feedMode),
  });
}

describe("A2 feed-aware Attention Score", () => {
  it("pins §11.1 scenario 20 to the stated provisional z50=2.0, k=1.2 curve", () => {
    const result = score("sip", 3, 2.5, 0.2);
    expect(calibrationStore.sets.sip.regular.normalization.participationDense).toEqual({ z50: 2, k: 1.2 });
    expect(calibrationStore.sets.sip.regular.normalization.displacement).toEqual({ z50: 2, k: 1.2 });
    expect(Number(result.attention?.toFixed(4))).toBe(61.8662);
    expect(result.explanation.coreAxes).toEqual(["participation", "displacement"]);
    expect(result.explanation.modifier).toBeCloseTo(1.01);
    expect(result.explanation.maxModifier).toBe(1.15);
    expect(result.explanation.modifierScale).toBeCloseTo(1.01 / 1.15);
  });

  it("keeps an unremarkable symbol below both deadStockCeiling and the provisional WATCHING floor", () => {
    for (const feedMode of ["sip", "iex_partial"] as const) {
      const result = score(feedMode, 0, 0, 0);
      expect(result.attention).toBeLessThan(ATTENTION_SCORE_CALIBRATION_GUARDS.deadStockCeiling);
      expect(result.explanation.core).toBeLessThan(ATTENTION_SCORE_CALIBRATION_GUARDS.provisionalWatchingCoreFloor);
    }
  });

  it("is bounded without clipping; Path A approaches 100 and Path B reserves the modifier headroom", () => {
    const pathA = score("sip", 6, 6, 6);
    const pathB = score("iex_partial", 6, 6, 6);
    expect(pathA.attention).toBeGreaterThanOrEqual(99);
    expect(pathA.attention).toBeLessThan(100);
    expect(pathB.attention).toBeCloseTo(86.2467, 4);
    expect(pathB.attention).toBeLessThan(100);
  });

  it("scores identical axis observations differently and consistently across feed modes", () => {
    const pathA = score("sip", 3, 2.5, 0.2);
    const pathB = score("iex_partial", 3, 2.5, 0.2);
    expect(pathA.attention).not.toBeCloseTo(pathB.attention!);
    expect(pathA).toMatchObject({ participationScoringWeight: 1, participationDisplayOnly: false, volumeAccelerationEnabled: true });
    expect(pathB).toMatchObject({ participationScoringWeight: 0, participationDisplayOnly: true, volumeAccelerationEnabled: false });
    expect(pathB.explanation).toMatchObject({ coreAxes: ["displacement", "idiosyncrasy"], modifier: 1, modifierKind: "none_idiosyncrasy_in_core" });
  });

  it("does not let one huge axis overcome a weak core partner", () => {
    expect(score("sip", 10, -10, 3).attention).toBeLessThan(12);
    expect(score("iex_partial", 10, 10, -10).attention).toBeLessThan(11);
  });

  it("makes idiosyncrasy an asymmetric 0 to 26.09 percent discount after rescaling", () => {
    const maximum = score("sip", 2, 2, 100).explanation;
    const minimum = score("sip", 2, 2, -100).explanation;
    expect(maximum.modifierScale).toBe(1);
    expect(minimum.modifierScale).toBeCloseTo(0.85 / 1.15);
    const alternative = scoreAttention({
      feedMode: "sip", subWindow: "regular", participation: participation(2),
      displacement: displacement(2), idiosyncrasy: idiosyncrasy(-100),
      calibrationSet: calibrationSetForScore(calibrationStore, "regular", "sip"),
      config: { idiosyncrasyInfluence: 0.075 },
    });
    expect(alternative.explanation.modifierScale).toBeCloseTo(0.925 / 1.075);
  });

  it("does not let idiosyncrasy rescue absent participation or displacement", () => {
    expect(score("sip", -20, -20, 20).attention).toBeLessThanOrEqual(1.15);
  });

  it("is non-decreasing in every axis under both paths", () => {
    for (const feedMode of ["sip", "iex_partial"] as const) {
      const base = score(feedMode, 0, 0, 0).attention!;
      expect(score(feedMode, 1, 0, 0).attention).toBeGreaterThanOrEqual(base);
      expect(score(feedMode, 0, 1, 0).attention).toBeGreaterThanOrEqual(base);
      expect(score(feedMode, 0, 0, 1).attention).toBeGreaterThanOrEqual(base);
    }
  });

  it("marks every A2 result and its normalization calibration provisional", () => {
    expect(score("sip", 1, 1, 1)).toMatchObject({
      thresholdCalibrationStatus: "pending_calibration",
      normalizationCalibrationStatus: "pending_calibration",
      normalizationVersion: 1,
      provisional: true,
      conclusionsAllowed: false,
    });
  });

  it("fails loudly when an axis curve differs from the exact feed/window calibration", () => {
    expect(() => scoreAttention({
      feedMode: "sip",
      subWindow: "regular",
      participation: { ...participation(1), z50: 1 },
      displacement: displacement(1),
      idiosyncrasy: idiosyncrasy(1),
      calibrationSet: calibrationSetForScore(calibrationStore, "regular", "sip"),
    })).toThrow(/does not match calibration/);
  });

  it("fails loudly when a stale normalized value is paired with the right curve metadata", () => {
    expect(() => scoreAttention({
      feedMode: "sip",
      subWindow: "regular",
      participation: { ...participation(1), normalized: 0.99 },
      displacement: displacement(1),
      idiosyncrasy: idiosyncrasy(1),
      calibrationSet: calibrationSetForScore(calibrationStore, "regular", "sip"),
    })).toThrow(/normalized value does not match/);
  });

  it("rejects a score whose axis cannot explain itself", () => {
    expect(() => scoreAttention({
      feedMode: "sip", subWindow: "regular",
      participation: { ...participation(1), components: [] },
      displacement: displacement(1), idiosyncrasy: idiosyncrasy(1),
      calibrationSet: calibrationSetForScore(calibrationStore, "regular", "sip"),
    })).toThrow(/component-level explainability/);
  });
});
