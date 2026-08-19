import type { AttentionSubWindow, ThresholdCalibrationStatus } from "@/lib/replay/attentionThresholds";
import type { FeedAwareAttentionThresholdSet } from "@/lib/replay/feedAwareAttentionThresholds";
import {
  normalizeAttentionAxis,
  type AttentionAxisResult,
  type AxisNormalizationConfig,
  type IdiosyncrasyAxisResult,
  type ParticipationAxisResult,
} from "./attentionAxes";

export const ATTENTION_FEED_MODES = ["sip", "iex_partial"] as const;
export type AttentionFeedMode = typeof ATTENTION_FEED_MODES[number];

export interface AttentionScoreConfig {
  idiosyncrasyInfluence: number;
}

export const DEFAULT_ATTENTION_SCORE_CONFIG: AttentionScoreConfig = {
  idiosyncrasyInfluence: 0.15,
};

export const ATTENTION_SCORE_CALIBRATION_GUARDS = {
  deadStockCeiling: 15,
  provisionalWatchingCoreFloor: 0.25,
} as const;

export interface AttentionScoreExplanation {
  feedMode: AttentionFeedMode;
  subWindow: AttentionSubWindow;
  participation: ParticipationAxisResult;
  displacement: AttentionAxisResult;
  idiosyncrasy: IdiosyncrasyAxisResult;
  coreAxes: readonly ["participation", "displacement"] | readonly ["displacement", "idiosyncrasy"];
  core: number | null;
  modifier: number;
  modifierKind: "bounded_idiosyncrasy" | "none_idiosyncrasy_in_core";
  modifierContext: number | null;
  idiosyncrasyInfluence: number;
  maxModifier: number;
  modifierScale: number;
  final: number | null;
}

export interface AttentionScoreResult {
  status: "ok" | "unavailable";
  unavailableReason: "insufficient_reference" | "axis_unavailable" | null;
  attention: number | null;
  feedMode: AttentionFeedMode;
  subWindow: AttentionSubWindow;
  participationScoringWeight: 1 | 0;
  participationDisplayOnly: boolean;
  volumeAccelerationEnabled: boolean;
  thresholdCalibrationStatus: ThresholdCalibrationStatus;
  normalizationCalibrationStatus: ThresholdCalibrationStatus;
  calibrationId: string;
  normalizationVersion: number;
  provisional: boolean;
  conclusionsAllowed: boolean;
  explanation: AttentionScoreExplanation;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function assertScoreConfig(config: AttentionScoreConfig): void {
  if (!Number.isFinite(config.idiosyncrasyInfluence) || config.idiosyncrasyInfluence < 0 || config.idiosyncrasyInfluence > 0.15) {
    throw new Error("idiosyncrasyInfluence must be between 0 and 0.15 during A2.");
  }
}

function assertExplainableAxis(axis: AttentionAxisResult): void {
  if (axis.components.length === 0) throw new Error(`${axis.axis} cannot be scored without component-level explainability.`);
  if (axis.status === "ok" && (axis.normalizationInput === null || axis.normalized === null)) {
    throw new Error(`${axis.axis} is marked ok without a normalization input and value.`);
  }
  const hasBaselineEvidence = axis.components.some((component) =>
    component.signalKind === "median_mad_z"
      ? component.baselineMedian !== null && component.baselineMad !== null
      : component.signalKind === "presence_surprise_bits"
      ? component.pPresent !== null && component.surpriseBits !== null
      : false
  );
  if (axis.status === "ok" && !hasBaselineEvidence) {
    throw new Error(`${axis.axis} cannot be scored without median/MAD or presence-surprise evidence.`);
  }
}

function assertComponentTransform(
  axis: AttentionAxisResult,
  componentName: string,
  expected: "linear" | "log1p" | "none",
): void {
  const component = axis.components.find((entry) => entry.name === componentName);
  if (component && component.baselineTransform !== expected) {
    throw new Error(`${axis.axis}.${componentName} transform ${component.baselineTransform} does not match calibrated ${expected}.`);
  }
}
function assertAxisCurve(axis: AttentionAxisResult, expected: AxisNormalizationConfig): void {
  if (axis.z50 !== expected.z50 || axis.k !== expected.k) {
    throw new Error(
      `${axis.axis} curve z50=${axis.z50},k=${axis.k} does not match calibration z50=${expected.z50},k=${expected.k}.`
    );
  }
  if (axis.status === "ok" && axis.normalizationInput !== null && axis.normalized !== null) {
    const expectedNormalized = normalizeAttentionAxis(axis.normalizationInput, expected);
    if (Math.abs(axis.normalized - expectedNormalized) > 1e-12) {
      throw new Error(`${axis.axis} normalized value does not match its versioned calibration curve.`);
    }
  }
}

function assertScoringCalibration(
  set: FeedAwareAttentionThresholdSet,
  feedMode: AttentionFeedMode,
  subWindow: AttentionSubWindow,
  participation: ParticipationAxisResult,
  displacement: AttentionAxisResult,
  idiosyncrasy: IdiosyncrasyAxisResult
): void {
  if (set.feedMode !== feedMode || set.subWindow !== subWindow) {
    throw new Error(`Score requires the exact ${feedMode} x ${subWindow} calibration set; fallback is forbidden.`);
  }
  const participationCurve = participation.baselineMode === "dense"
    ? set.normalization.participationDense
    : set.normalization.participationPresence;
  assertAxisCurve(participation, participationCurve);
  assertAxisCurve(displacement, set.normalization.displacement);
  assertAxisCurve(idiosyncrasy, set.normalization.idiosyncrasy);
  if (participation.baselineMode === "dense") {
    assertComponentTransform(participation, "volume", "log1p");
    assertComponentTransform(participation, "dollar_volume", "log1p");
  } else {
    assertComponentTransform(participation, "presence", "none");
  }
  assertComponentTransform(displacement, "range_atr", "log1p");
  assertComponentTransform(displacement, "path_efficiency", "linear");
  assertComponentTransform(idiosyncrasy, "stock_vs_benchmark", "linear");
  assertComponentTransform(idiosyncrasy, "sector_vs_benchmark", "linear");
}

export function scoreAttention(input: {
  feedMode: AttentionFeedMode;
  subWindow: AttentionSubWindow;
  participation: ParticipationAxisResult;
  displacement: AttentionAxisResult;
  idiosyncrasy: IdiosyncrasyAxisResult;
  calibrationSet: FeedAwareAttentionThresholdSet;
  config?: AttentionScoreConfig;
}): AttentionScoreResult {
  const config = input.config ?? DEFAULT_ATTENTION_SCORE_CONFIG;
  assertScoreConfig(config);
  if (input.calibrationSet.feedMode !== input.feedMode || input.calibrationSet.subWindow !== input.subWindow) {
    throw new Error(`Score requires the exact ${input.feedMode} x ${input.subWindow} calibration set; fallback is forbidden.`);
  }
  if (input.calibrationSet.calibrationStatus === "unavailable_by_construction") {
    return {
      status: "unavailable",
      unavailableReason: "insufficient_reference",
      attention: null,
      feedMode: input.feedMode,
      subWindow: input.subWindow,
      participationScoringWeight: 0,
      participationDisplayOnly: true,
      volumeAccelerationEnabled: false,
      thresholdCalibrationStatus: input.calibrationSet.calibrationStatus,
      normalizationCalibrationStatus: input.calibrationSet.calibrationStatus,
      calibrationId: input.calibrationSet.calibrationId,
      normalizationVersion: input.calibrationSet.normalizationVersion,
      provisional: false,
      conclusionsAllowed: false,
      explanation: {
        feedMode: input.feedMode,
        subWindow: input.subWindow,
        participation: input.participation,
        displacement: input.displacement,
        idiosyncrasy: input.idiosyncrasy,
        coreAxes: ["displacement", "idiosyncrasy"],
        core: null,
        modifier: 1,
        modifierKind: "none_idiosyncrasy_in_core",
        modifierContext: null,
        idiosyncrasyInfluence: config.idiosyncrasyInfluence,
        maxModifier: 1 + config.idiosyncrasyInfluence,
        modifierScale: 1 / (1 + config.idiosyncrasyInfluence),
        final: null,
      },
    };
  }
  assertExplainableAxis(input.participation);
  assertExplainableAxis(input.displacement);
  assertExplainableAxis(input.idiosyncrasy);
  assertScoringCalibration(
    input.calibrationSet,
    input.feedMode,
    input.subWindow,
    input.participation,
    input.displacement,
    input.idiosyncrasy
  );
  const pathA = input.feedMode === "sip";
  const first = pathA ? input.participation.normalized : input.displacement.normalized;
  const second = pathA ? input.displacement.normalized : input.idiosyncrasy.normalized;
  const core = first === null || second === null ? null : Math.sqrt(first * second);
  const modifierContext = pathA && input.idiosyncrasy.value !== null
    ? clamp(input.idiosyncrasy.value, -3, 3) / 3
    : null;
  const modifier = pathA
    ? 1 + config.idiosyncrasyInfluence * (modifierContext ?? 0)
    : 1;
  const maxModifier = 1 + config.idiosyncrasyInfluence;
  const modifierScale = modifier / maxModifier;
  const attention = core === null ? null : 100 * core * modifierScale;
  return {
    status: attention === null ? "unavailable" : "ok",
    unavailableReason: attention === null ? "axis_unavailable" : null,
    attention,
    feedMode: input.feedMode,
    subWindow: input.subWindow,
    participationScoringWeight: pathA ? 1 : 0,
    participationDisplayOnly: !pathA,
    volumeAccelerationEnabled: pathA,
    thresholdCalibrationStatus: input.calibrationSet.calibrationStatus,
    normalizationCalibrationStatus: input.calibrationSet.calibrationStatus,
    calibrationId: input.calibrationSet.calibrationId,
    normalizationVersion: input.calibrationSet.normalizationVersion,
    provisional: input.calibrationSet.calibrationStatus !== "calibrated",
    conclusionsAllowed: input.calibrationSet.calibrationStatus === "calibrated",
    explanation: {
      feedMode: input.feedMode,
      subWindow: input.subWindow,
      participation: input.participation,
      displacement: input.displacement,
      idiosyncrasy: input.idiosyncrasy,
      coreAxes: pathA ? ["participation", "displacement"] : ["displacement", "idiosyncrasy"],
      core,
      modifier,
      modifierKind: pathA ? "bounded_idiosyncrasy" : "none_idiosyncrasy_in_core",
      modifierContext,
      idiosyncrasyInfluence: config.idiosyncrasyInfluence,
      maxModifier,
      modifierScale,
      final: attention,
    },
  };
}

/** Pure replay/config mapping. This does not wire the attention engine into the live scanner. */
export function attentionFeedModeForProviderFeed(feed: string): AttentionFeedMode {
  if (feed === "sip") return "sip";
  if (feed === "iex") return "iex_partial";
  throw new Error(`Unsupported attention feed: ${feed}. No scoring-mode fallback is permitted.`);
}

export function volumeCoverageLabel(feedMode: AttentionFeedMode): "SIP CONSOLIDATED" | "IEX PARTIAL" {
  return feedMode === "sip" ? "SIP CONSOLIDATED" : "IEX PARTIAL";
}
