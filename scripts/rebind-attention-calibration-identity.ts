import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { assertFeedAwareAttentionThresholdStore, type FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import { sha256, stableJson } from "../lib/replay/archive";

interface Manifest { splitHash: string; universeHash: string }

const thresholdsPath = resolve("data/replay/reports/attention-thresholds.json");
const manifest = JSON.parse(readFileSync(resolve("data/replay/calibration/session-manifest.json"), "utf8")) as Manifest;
const store = JSON.parse(readFileSync(thresholdsPath, "utf8")) as FeedAwareAttentionThresholdStore;
const expectedUniverseHash = sha256(stableJson(ATTENTION_UNIVERSE));
if (manifest.universeHash !== expectedUniverseHash) throw new Error("Calibration manifest universe identity does not match the runtime universe.");
const beforeParameters = stableJson(Object.fromEntries(Object.entries(store.sets).map(([feed, windows]) => [
  feed,
  Object.fromEntries(Object.entries(windows).map(([window, set]) => [window, {
    measurementVersion: set.measurementVersion,
    measurementTransforms: set.measurementTransforms,
    normalizationVersion: set.normalizationVersion,
    normalization: set.normalization,
    thresholdVersion: set.thresholdVersion,
    provisionalValues: set.provisionalValues,
    values: set.values,
    calibrationStatus: set.calibrationStatus,
  }])),
])));

for (const windows of Object.values(store.sets)) {
  for (const set of Object.values(windows)) {
    if (set.calibrationStatus !== "calibrated") continue;
    set.calibrationId = `mode-map-v${store.modeMapVersion}:measure-v${set.measurementVersion}:curve-v${set.normalizationVersion}:state-v${set.thresholdVersion}:${set.feedMode}:${set.subWindow}:population-${manifest.splitHash.slice(0, 12)}`;
  }
}
assertFeedAwareAttentionThresholdStore(store);
const afterParameters = stableJson(Object.fromEntries(Object.entries(store.sets).map(([feed, windows]) => [
  feed,
  Object.fromEntries(Object.entries(windows).map(([window, set]) => [window, {
    measurementVersion: set.measurementVersion,
    measurementTransforms: set.measurementTransforms,
    normalizationVersion: set.normalizationVersion,
    normalization: set.normalization,
    thresholdVersion: set.thresholdVersion,
    provisionalValues: set.provisionalValues,
    values: set.values,
    calibrationStatus: set.calibrationStatus,
  }])),
])));
if (beforeParameters !== afterParameters) throw new Error("Calibration identity rebind changed a scoring curve or threshold.");
writeFileSync(thresholdsPath, `${JSON.stringify(store, null, 2)}\n`);
console.log(JSON.stringify({
  manifestSplitHash: manifest.splitHash,
  universeHash: manifest.universeHash,
  iexRegularCalibrationId: store.sets.iex_partial.regular.calibrationId,
  numericalParametersChanged: false,
}, null, 2));
