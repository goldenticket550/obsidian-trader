import { ATTENTION_FEED_MODES, type AttentionFeedMode } from "@/lib/attention/attentionScore";
import {
  ATTENTION_MEASUREMENT_TRANSFORMS,
  PROVISIONAL_ATTENTION_NORMALIZATION_CURVES,
  type AttentionMeasurementTransforms,
  type AttentionNormalizationCurves,
  type AxisNormalizationConfig,
} from "@/lib/attention/attentionAxes";
import {
  ATTENTION_SUB_WINDOWS,
  type AttentionSubWindow,
  type AttentionThresholdValues,
  type ResolvedAttentionThresholdValues,
  type ThresholdCalibrationStatus,
} from "./attentionThresholdTypes";

export interface FeedAwareAttentionThresholdSet {
  subWindow: AttentionSubWindow;
  feedMode: AttentionFeedMode;
  calibrationId: string;
  calibrationStatus: ThresholdCalibrationStatus;
  measurementVersion: number;
  measurementTransforms: AttentionMeasurementTransforms;
  normalizationVersion: number;
  normalization: AttentionNormalizationCurves;
  thresholdVersion: number;
  provisionalValues: ResolvedAttentionThresholdValues;
  values: AttentionThresholdValues;
  /** Population calibration makes state populations usable; it is not label-based validation. */
  calibrationBasis?: "population";
  groundTruthValidated?: false;
  unavailableReason?: "insufficient_reference";
}

export interface FeedModeCalibrationInvalidation {
  at: number;
  from: AttentionFeedMode;
  to: AttentionFeedMode;
  invalidatedCalibrationIds: string[];
  reason: "feed_mode_changed";
}

export interface NormalizationCalibrationInvalidation {
  at: number;
  feedMode: AttentionFeedMode;
  subWindow: AttentionSubWindow;
  oldCalibrationId: string;
  newCalibrationId: string;
  oldNormalizationVersion: number;
  newNormalizationVersion: number;
  oldNormalization: AttentionNormalizationCurves;
  newNormalization: AttentionNormalizationCurves;
  reason: "normalization_curve_changed";
}

export interface FeedAwareAttentionThresholdStore {
  schemaVersion: 5;
  modeMapVersion: number;
  sets: Record<AttentionFeedMode, Record<AttentionSubWindow, FeedAwareAttentionThresholdSet>>;
  feedModeInvalidations: FeedModeCalibrationInvalidation[];
  normalizationInvalidations: NormalizationCalibrationInvalidation[];
}

const pendingValues = (): AttentionThresholdValues => ({
  watchingEnterCore: null,
  watchingExitCore: null,
  emergingEnterCore: null,
  emergingExitCore: null,
  inPlayEnterCore: null,
  inPlayExitCore: null,
  newInPlayVelocityPerMinute: null,
  enterPersistenceMinutes: null,
  exitPersistenceMinutes: null,
});

export const PROVISIONAL_A3_THRESHOLD_VALUES: ResolvedAttentionThresholdValues = {
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

function pendingSet(
  modeMapVersion: number,
  feedMode: AttentionFeedMode,
  subWindow: AttentionSubWindow,
  suffix = "",
  normalizationVersion = 1,
  normalization: AttentionNormalizationCurves = PROVISIONAL_ATTENTION_NORMALIZATION_CURVES,
  thresholdVersion = 1,
  provisionalValues: ResolvedAttentionThresholdValues = PROVISIONAL_A3_THRESHOLD_VALUES
): FeedAwareAttentionThresholdSet {
  return {
    subWindow,
    feedMode,
    calibrationId: `mode-map-v${modeMapVersion}:measure-v1:curve-v${normalizationVersion}:state-v${thresholdVersion}:${feedMode}:${subWindow}${suffix}`,
    measurementVersion: 1,
    measurementTransforms: structuredClone(ATTENTION_MEASUREMENT_TRANSFORMS),
    calibrationStatus: "pending_calibration",
    normalizationVersion,
    normalization: structuredClone(normalization),
    thresholdVersion,
    provisionalValues: structuredClone(provisionalValues),
    values: pendingValues(),
  };
}

export function createPendingFeedAwareThresholdStore(modeMapVersion: number): FeedAwareAttentionThresholdStore {
  if (!Number.isInteger(modeMapVersion) || modeMapVersion < 1) throw new Error("modeMapVersion must be a positive integer.");
  const sets = Object.fromEntries(ATTENTION_FEED_MODES.map((feedMode) => [
    feedMode,
    Object.fromEntries(ATTENTION_SUB_WINDOWS.map((subWindow) => [subWindow, pendingSet(modeMapVersion, feedMode, subWindow)])),
  ])) as FeedAwareAttentionThresholdStore["sets"];
  return { schemaVersion: 5, modeMapVersion, sets, feedModeInvalidations: [], normalizationInvalidations: [] };
}

export function assertFeedAwareAttentionThresholdStore(store: FeedAwareAttentionThresholdStore): void {
  if (store.schemaVersion !== 5) throw new Error("Feed-aware attention calibration requires schemaVersion 5.");
  const ids = new Set<string>();
  for (const feedMode of ATTENTION_FEED_MODES) {
    for (const subWindow of ATTENTION_SUB_WINDOWS) {
      const set = store.sets[feedMode]?.[subWindow];
      if (!set || set.subWindow !== subWindow || set.feedMode !== feedMode) {
        throw new Error(`Missing dedicated threshold set for ${feedMode} x ${subWindow}.`);
      }
      if (ids.has(set.calibrationId)) throw new Error("Every feed-mode/sub-window set requires a distinct calibration identity.");
      ids.add(set.calibrationId);
      if (!Number.isInteger(set.measurementVersion) || set.measurementVersion < 1 || JSON.stringify(set.measurementTransforms) !== JSON.stringify(ATTENTION_MEASUREMENT_TRANSFORMS)) {
        throw new Error(`Measurement transform contract for ${feedMode} x ${subWindow} is invalid.`);
      }
      if (!Number.isInteger(set.normalizationVersion) || set.normalizationVersion < 1) {
        throw new Error(`Normalization version for ${feedMode} x ${subWindow} must be a positive integer.`);
      }
      if (!Number.isInteger(set.thresholdVersion) || set.thresholdVersion < 1) {
        throw new Error(`Threshold version for ${feedMode} x ${subWindow} must be a positive integer.`);
      }
      const curveEntries: Array<[keyof AttentionNormalizationCurves, AxisNormalizationConfig | undefined]> = [
        ["participationDense", set.normalization?.participationDense],
        ["participationPresence", set.normalization?.participationPresence],
        ["displacement", set.normalization?.displacement],
        ["idiosyncrasy", set.normalization?.idiosyncrasy],
      ];
      for (const [axis, curve] of curveEntries) {
        if (!curve) throw new Error(`Missing ${axis} normalization curve for ${feedMode} x ${subWindow}.`);
        if (!Number.isFinite(curve.z50) || !Number.isFinite(curve.k) || curve.k <= 0) {
          throw new Error(`Invalid ${axis} normalization curve for ${feedMode} x ${subWindow}.`);
        }
      }
      const values = Object.values(set.values);
      const provisionalValues = Object.values(set.provisionalValues);
      if (!Number.isInteger(set.provisionalValues.enterPersistenceMinutes) || set.provisionalValues.enterPersistenceMinutes < 2 || !Number.isInteger(set.provisionalValues.exitPersistenceMinutes) || set.provisionalValues.exitPersistenceMinutes < 2) {
        throw new Error(`Persistence configuration for ${feedMode} x ${subWindow} must use integer minutes >= 2.`);
      }
      if (provisionalValues.some((value) => !Number.isFinite(value))) {
        throw new Error(`Provisional threshold set ${feedMode} x ${subWindow} contains invalid values.`);
      }
      const p = set.provisionalValues;
      if (!(p.watchingExitCore < p.watchingEnterCore
        && p.emergingExitCore < p.emergingEnterCore
        && p.inPlayExitCore < p.inPlayEnterCore
        && p.watchingEnterCore < p.emergingEnterCore
        && p.emergingEnterCore < p.inPlayEnterCore
        && p.watchingExitCore <= p.emergingExitCore
        && p.emergingExitCore <= p.inPlayExitCore)) {
        throw new Error(`Threshold hysteresis/order is invalid for ${feedMode} x ${subWindow}.`);
      }
      if (set.calibrationStatus === "calibrated" && values.some((value) => value === null || !Number.isFinite(value))) {
        throw new Error(`Calibrated threshold set ${feedMode} x ${subWindow} contains unavailable values.`);
      }
      if (set.calibrationStatus === "pending_calibration" && values.some((value) => value !== null)) {
        throw new Error(`Pending threshold set ${feedMode} x ${subWindow} cannot publish decision values.`);
      }
      if (set.calibrationStatus === "unavailable_by_construction") {
        if (values.some((value) => value !== null)) {
          throw new Error(`Unavailable threshold set ${feedMode} x ${subWindow} cannot publish decision values.`);
        }
        if (feedMode !== "iex_partial" || set.unavailableReason !== "insufficient_reference") {
          throw new Error(`Unavailable threshold set ${feedMode} x ${subWindow} requires an IEX insufficient-reference reason.`);
        }
      }
    }
  }
}

export function thresholdValuesForReplay(set: FeedAwareAttentionThresholdSet): {
  values: ResolvedAttentionThresholdValues;
  provisional: boolean;
  conclusionsAllowed: boolean;
} {
  if (set.calibrationStatus === "unavailable_by_construction") {
    throw new Error(`Attention scoring is unavailable for ${set.feedMode} x ${set.subWindow}: insufficient_reference.`);
  }
  if (set.calibrationStatus === "calibrated") {
    const values = set.values as ResolvedAttentionThresholdValues;
    return { values, provisional: false, conclusionsAllowed: true };
  }
  return { values: set.provisionalValues, provisional: true, conclusionsAllowed: false };
}

/** Exact calibration lookup for scoring. Pending sets are allowed in A2 but remain provisional. */
export function calibrationSetForScore(
  store: FeedAwareAttentionThresholdStore,
  subWindow: AttentionSubWindow,
  feedMode: AttentionFeedMode
): FeedAwareAttentionThresholdSet {
  assertFeedAwareAttentionThresholdStore(store);
  const set = store.sets[feedMode]?.[subWindow];
  if (!set) throw new Error(`Missing exact calibration set for ${feedMode} x ${subWindow}; fallback is forbidden.`);
  if (set.feedMode !== feedMode || set.subWindow !== subWindow) {
    throw new Error(`Calibration identity mismatch for ${feedMode} x ${subWindow}.`);
  }
  return set;
}

export function thresholdSetForScore(
  store: FeedAwareAttentionThresholdStore,
  subWindow: AttentionSubWindow,
  feedMode: AttentionFeedMode
): FeedAwareAttentionThresholdSet & { calibrationStatus: "calibrated" } {
  assertFeedAwareAttentionThresholdStore(store);
  const set = store.sets[feedMode]?.[subWindow];
  if (!set) throw new Error(`Missing exact threshold set for ${feedMode} x ${subWindow}; fallback is forbidden.`);
  if (set.feedMode !== feedMode) throw new Error(`Threshold feed mismatch: ${set.feedMode} cannot score ${feedMode}.`);
  if (set.calibrationStatus !== "calibrated") {
    const state = set.calibrationStatus === "unavailable_by_construction"
      ? "unavailable by construction: insufficient_reference"
      : "pending calibration";
    throw new Error(`Attention thresholds for ${feedMode} x ${subWindow} are ${state}; feed/window fallback is forbidden.`);
  }
  return set as FeedAwareAttentionThresholdSet & { calibrationStatus: "calibrated" };
}

export function markCalibrationUnavailableByConstruction(
  store: FeedAwareAttentionThresholdStore,
  input: { feedMode: AttentionFeedMode; subWindow: AttentionSubWindow; reason: "insufficient_reference" },
): FeedAwareAttentionThresholdStore {
  assertFeedAwareAttentionThresholdStore(store);
  const current = store.sets[input.feedMode]?.[input.subWindow];
  if (!current) throw new Error(`Missing calibration set for ${input.feedMode} x ${input.subWindow}.`);
  if (input.feedMode !== "iex_partial") throw new Error("Only IEX-partial sets can be unavailable from insufficient references.");
  const nextSet: FeedAwareAttentionThresholdSet = {
    ...current,
    calibrationId: `${current.calibrationId}:unavailable-insufficient-reference`,
    calibrationStatus: "unavailable_by_construction",
    values: pendingValues(),
    unavailableReason: input.reason,
  };
  const next: FeedAwareAttentionThresholdStore = {
    ...store,
    sets: {
      ...store.sets,
      [input.feedMode]: { ...store.sets[input.feedMode], [input.subWindow]: nextSet },
    },
  };
  assertFeedAwareAttentionThresholdStore(next);
  return next;
}

export function invalidateThresholdsForFeedModeChange(
  store: FeedAwareAttentionThresholdStore,
  from: AttentionFeedMode,
  to: AttentionFeedMode,
  at: number
): { store: FeedAwareAttentionThresholdStore; report: FeedModeCalibrationInvalidation } {
  assertFeedAwareAttentionThresholdStore(store);
  if (from === to) throw new Error("Feed-mode invalidation requires an actual feed-mode change.");
  if (!Number.isFinite(at)) throw new Error("Feed-mode invalidation requires a finite timestamp.");
  const oldTargetSets = ATTENTION_SUB_WINDOWS.map((subWindow) => store.sets[to][subWindow]);
  const report: FeedModeCalibrationInvalidation = {
    at,
    from,
    to,
    invalidatedCalibrationIds: oldTargetSets.map((set) => set.calibrationId),
    reason: "feed_mode_changed",
  };
  const targetSets = Object.fromEntries(ATTENTION_SUB_WINDOWS.map((subWindow) => [
    subWindow,
    pendingSet(
      store.modeMapVersion,
      to,
      subWindow,
      `:feed-change-${from}-at-${at}`,
      store.sets[to][subWindow].normalizationVersion,
      store.sets[to][subWindow].normalization,
      store.sets[to][subWindow].thresholdVersion,
      store.sets[to][subWindow].provisionalValues
    ),
  ])) as Record<AttentionSubWindow, FeedAwareAttentionThresholdSet>;
  const next: FeedAwareAttentionThresholdStore = {
    ...store,
    sets: { ...store.sets, [to]: targetSets },
    feedModeInvalidations: [...store.feedModeInvalidations, report],
  };
  assertFeedAwareAttentionThresholdStore(next);
  return { store: next, report };
}

export function invalidateCalibrationForNormalizationChange(
  store: FeedAwareAttentionThresholdStore,
  input: {
    feedMode: AttentionFeedMode;
    subWindow: AttentionSubWindow;
    normalizationVersion: number;
    normalization: AttentionNormalizationCurves;
    at: number;
  }
): { store: FeedAwareAttentionThresholdStore; report: NormalizationCalibrationInvalidation } {
  assertFeedAwareAttentionThresholdStore(store);
  if (!Number.isFinite(input.at)) throw new Error("Normalization invalidation requires a finite timestamp.");
  const oldSet = store.sets[input.feedMode]?.[input.subWindow];
  if (!oldSet) throw new Error(`Missing calibration set for ${input.feedMode} x ${input.subWindow}.`);
  if (!Number.isInteger(input.normalizationVersion) || input.normalizationVersion <= oldSet.normalizationVersion) {
    throw new Error("A normalization change requires a strictly newer positive normalizationVersion.");
  }
  const unchanged = JSON.stringify(oldSet.normalization) === JSON.stringify(input.normalization);
  if (unchanged) throw new Error("Normalization invalidation requires an actual curve change.");
  const newSet = pendingSet(
    store.modeMapVersion,
    input.feedMode,
    input.subWindow,
    `:curve-change-at-${input.at}`,
    input.normalizationVersion,
    input.normalization,
    oldSet.thresholdVersion,
    oldSet.provisionalValues
  );
  const report: NormalizationCalibrationInvalidation = {
    at: input.at,
    feedMode: input.feedMode,
    subWindow: input.subWindow,
    oldCalibrationId: oldSet.calibrationId,
    newCalibrationId: newSet.calibrationId,
    oldNormalizationVersion: oldSet.normalizationVersion,
    newNormalizationVersion: newSet.normalizationVersion,
    oldNormalization: structuredClone(oldSet.normalization),
    newNormalization: structuredClone(newSet.normalization),
    reason: "normalization_curve_changed",
  };
  const next: FeedAwareAttentionThresholdStore = {
    ...store,
    sets: {
      ...store.sets,
      [input.feedMode]: { ...store.sets[input.feedMode], [input.subWindow]: newSet },
    },
    normalizationInvalidations: [...store.normalizationInvalidations, report],
  };
  assertFeedAwareAttentionThresholdStore(next);
  return { store: next, report };
}

export function applyPopulationCalibration(
  store: FeedAwareAttentionThresholdStore,
  input: {
    feedMode: AttentionFeedMode;
    subWindow: AttentionSubWindow;
    normalizationVersion: number;
    normalization: AttentionNormalizationCurves;
    thresholdVersion: number;
    values: ResolvedAttentionThresholdValues;
    corpusHash: string;
  }
): FeedAwareAttentionThresholdStore {
  assertFeedAwareAttentionThresholdStore(store);
  const current = store.sets[input.feedMode]?.[input.subWindow];
  if (!current) throw new Error(`Missing calibration set for ${input.feedMode} x ${input.subWindow}.`);
  if (!Number.isInteger(input.normalizationVersion) || input.normalizationVersion <= current.normalizationVersion
    || !Number.isInteger(input.thresholdVersion) || input.thresholdVersion <= current.thresholdVersion) {
    throw new Error("Population calibration requires strictly newer curve and threshold versions.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.corpusHash)) throw new Error("Population calibration requires a SHA-256 corpus identity.");
  const nextSet: FeedAwareAttentionThresholdSet = {
    ...current,
    calibrationId: `mode-map-v${store.modeMapVersion}:measure-v${current.measurementVersion}:curve-v${input.normalizationVersion}:state-v${input.thresholdVersion}:${input.feedMode}:${input.subWindow}:population-${input.corpusHash.slice(0, 12)}`,
    calibrationStatus: "calibrated",
    normalizationVersion: input.normalizationVersion,
    normalization: structuredClone(input.normalization),
    thresholdVersion: input.thresholdVersion,
    values: structuredClone(input.values),
    calibrationBasis: "population",
    groundTruthValidated: false,
  };
  const next: FeedAwareAttentionThresholdStore = {
    ...store,
    sets: {
      ...store.sets,
      [input.feedMode]: { ...store.sets[input.feedMode], [input.subWindow]: nextSet },
    },
  };
  assertFeedAwareAttentionThresholdStore(next);
  return next;
}
