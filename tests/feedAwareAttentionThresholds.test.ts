import { describe, expect, it } from "vitest";
import { ATTENTION_SUB_WINDOWS } from "@/lib/replay/attentionThresholds";
import {
  applyPopulationCalibration,
  assertFeedAwareAttentionThresholdStore,
  createPendingFeedAwareThresholdStore,
  invalidateCalibrationForNormalizationChange,
  invalidateThresholdsForFeedModeChange,
  markCalibrationUnavailableByConstruction,
  thresholdSetForScore,
} from "@/lib/replay/feedAwareAttentionThresholds";

const calibratedValues = {
  watchingEnterCore: 0.25,
  watchingExitCore: 0.20,
  emergingEnterCore: 0.50,
  emergingExitCore: 0.40,
  inPlayEnterCore: 0.70,
  inPlayExitCore: 0.60,
  newInPlayVelocityPerMinute: 2,
  enterPersistenceMinutes: 2,
  exitPersistenceMinutes: 2,
};

describe("A2 feed-aware threshold isolation", () => {
  it("records population calibration without claiming label-based validation", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    const next = applyPopulationCalibration(store, {
      feedMode: "sip", subWindow: "regular", normalizationVersion: 2,
      normalization: store.sets.sip.regular.normalization, thresholdVersion: 2,
      values: calibratedValues, corpusHash: "a".repeat(64),
    });
    expect(next.sets.sip.regular).toMatchObject({
      calibrationStatus: "calibrated", calibrationBasis: "population", groundTruthValidated: false,
    });
    expect(next.sets.sip.regular.calibrationId).toContain("population-aaaaaaaaaaaa");
  });
  it("creates twelve distinct pending feed-mode x sub-window sets", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    assertFeedAwareAttentionThresholdStore(store);
    const sets = [...Object.values(store.sets.sip), ...Object.values(store.sets.iex_partial)];
    expect(sets).toHaveLength(12);
    expect(new Set(sets.map((set) => set.calibrationId))).toHaveLength(12);
    expect(sets.every((set) => set.calibrationStatus === "pending_calibration")).toBe(true);
    expect(sets.every((set) => set.measurementVersion === 1)).toBe(true);
    expect(sets.every((set) => set.measurementTransforms.participationDense === "log1p" && set.measurementTransforms.displacementRange === "log1p")).toBe(true);
  });

  it("cannot resolve a SIP threshold set for an IEX-partial score", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    store.sets.sip.regular = { ...store.sets.sip.regular, calibrationStatus: "calibrated", values: calibratedValues };
    expect(thresholdSetForScore(store, "regular", "sip").feedMode).toBe("sip");
    expect(() => thresholdSetForScore(store, "regular", "iex_partial")).toThrow(/pending calibration/);
  });

  it("distinguishes terminal partial-feed unavailability from pending calibration", () => {
    const store = markCalibrationUnavailableByConstruction(createPendingFeedAwareThresholdStore(3), {
      feedMode: "iex_partial", subWindow: "premarket_core", reason: "insufficient_reference",
    });
    expect(store.sets.iex_partial.premarket_core).toMatchObject({
      calibrationStatus: "unavailable_by_construction", unavailableReason: "insufficient_reference",
    });
    expect(() => thresholdSetForScore(store, "premarket_core", "iex_partial")).toThrow(/unavailable by construction.*insufficient_reference/);
  });

  it("fails a structurally substituted Path A set instead of falling back", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    store.sets.iex_partial.regular = { ...store.sets.sip.regular, calibrationStatus: "calibrated", values: calibratedValues };
    expect(() => thresholdSetForScore(store, "regular", "iex_partial")).toThrow(/Missing dedicated threshold set|feed mismatch/);
  });

  it("invalidates and reports all affected target-feed sets on a feed change", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    for (const window of ATTENTION_SUB_WINDOWS) {
      store.sets.iex_partial[window] = { ...store.sets.iex_partial[window], calibrationStatus: "calibrated", values: calibratedValues };
    }
    const result = invalidateThresholdsForFeedModeChange(store, "sip", "iex_partial", 123);
    expect(result.report).toMatchObject({ from: "sip", to: "iex_partial", reason: "feed_mode_changed" });
    expect(result.report.invalidatedCalibrationIds).toHaveLength(6);
    expect(Object.values(result.store.sets.iex_partial).every((set) => set.calibrationStatus === "pending_calibration")).toBe(true);
    expect(result.store.feedModeInvalidations).toEqual([result.report]);
  });

  it("invalidates thresholds and reports a curve change for only the affected set", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    store.sets.sip.regular = { ...store.sets.sip.regular, calibrationStatus: "calibrated", values: calibratedValues };
    const oldOtherId = store.sets.sip.premarket_core.calibrationId;
    const result = invalidateCalibrationForNormalizationChange(store, {
      feedMode: "sip",
      subWindow: "regular",
      normalizationVersion: 2,
      normalization: {
        ...store.sets.sip.regular.normalization,
        displacement: { z50: 2.1, k: 1.2 },
      },
      at: 456,
    });
    expect(result.report).toMatchObject({
      feedMode: "sip",
      subWindow: "regular",
      oldNormalizationVersion: 1,
      newNormalizationVersion: 2,
      reason: "normalization_curve_changed",
    });
    expect(result.store.sets.sip.regular.calibrationStatus).toBe("pending_calibration");
    expect(Object.values(result.store.sets.sip.regular.values).every((value) => value === null)).toBe(true);
    expect(result.store.sets.sip.premarket_core.calibrationId).toBe(oldOtherId);
    expect(result.store.normalizationInvalidations).toEqual([result.report]);
  });
});
