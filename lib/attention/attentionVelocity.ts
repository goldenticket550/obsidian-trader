import type { AttentionHistoryPoint } from "./attentionHistory";
import {
  DEFAULT_MODE_TRANSITION_GUARD_MS,
  type ModeTransitionMarker,
} from "@/lib/replay/modeTransitionGuard";

export interface AttentionVelocity {
  scoreDelta1m: number | null;
  scoreDelta3m: number | null;
  scoreDelta5m: number | null;
  coreDelta1m: number | null;
  percentileDelta1m: number | null;
  percentileDelta3m: number | null;
  percentileDelta5m: number | null;
  rollingZDelta5m: number | null;
  scoreVelocityPerMinute: number | null;
  velocityEventsSuppressed: boolean;
  suppressVelocityEventsUntil: number | null;
  modeTransition: ModeTransitionMarker | null;
  measurementWindowStartedAt: number;
  measurementResetReason: "initial" | "participation_mode_changed" | "calibration_changed" | "feed_mode_changed" | null;
}

function sampleAt(points: readonly AttentionHistoryPoint[], at: number): AttentionHistoryPoint | null {
  return points.findLast((point) => point.at === at) ?? null;
}

function delta(
  points: readonly AttentionHistoryPoint[],
  latest: AttentionHistoryPoint,
  minutes: 1 | 3 | 5,
  field: "score" | "core" | "percentile" | "rollingZComposite"
): number | null {
  const earlier = sampleAt(points, latest.at - minutes * 60_000);
  const currentValue = latest[field];
  const earlierValue = earlier?.[field] ?? null;
  return currentValue === null || earlierValue === null ? null : currentValue - earlierValue;
}

function sameMeasurement(a: AttentionHistoryPoint, b: AttentionHistoryPoint): boolean {
  return a.participationBaselineMode === b.participationBaselineMode
    && a.feedMode === b.feedMode
    && a.calibrationId === b.calibrationId;
}

/**
 * Computes only score/core/z/percentile deltas. Rank is intentionally absent.
 * The sample suffix resets before any incomparable participation/feed/curve identity.
 */
export function computeAttentionVelocity(
  history: readonly AttentionHistoryPoint[],
  guardMs = DEFAULT_MODE_TRANSITION_GUARD_MS
): AttentionVelocity {
  if (history.length === 0) throw new Error("Attention velocity requires score history.");
  if (!Number.isFinite(guardMs) || guardMs < 0) throw new Error("Attention velocity guard must be non-negative.");
  const latest = history.at(-1)!;
  let suffixStart = history.length - 1;
  while (suffixStart > 0 && sameMeasurement(history[suffixStart - 1], latest)) suffixStart -= 1;
  const suffix = history.slice(suffixStart);
  const immediatePrevious = history.at(-2) ?? null;
  const modeChanged = immediatePrevious !== null && immediatePrevious.participationBaselineMode !== latest.participationBaselineMode;
  const feedChanged = immediatePrevious !== null && immediatePrevious.feedMode !== latest.feedMode;
  const calibrationChanged = immediatePrevious !== null && !modeChanged && !feedChanged && immediatePrevious.calibrationId !== latest.calibrationId;
  const transition: ModeTransitionMarker | null = modeChanged ? {
    at: latest.at,
    from: immediatePrevious!.participationBaselineMode,
    to: latest.participationBaselineMode,
    suppressVelocityEventsUntil: latest.at + guardMs,
  } : null;
  const lastModeTransitionAt = history.findLast((point, index) =>
    index > 0 && history[index - 1].participationBaselineMode !== point.participationBaselineMode
  )?.at ?? null;
  const suppressVelocityEventsUntil = transition?.suppressVelocityEventsUntil
    ?? (lastModeTransitionAt === null ? null : lastModeTransitionAt + guardMs);
  const scoreDelta1m = delta(suffix, latest, 1, "score");
  const scoreDelta3m = delta(suffix, latest, 3, "score");
  const scoreDelta5m = delta(suffix, latest, 5, "score");
  const scoreVelocityPerMinute = scoreDelta3m !== null
    ? scoreDelta3m / 3
    : scoreDelta1m !== null
    ? scoreDelta1m
    : scoreDelta5m !== null
    ? scoreDelta5m / 5
    : null;
  return {
    scoreDelta1m,
    scoreDelta3m,
    scoreDelta5m,
    coreDelta1m: delta(suffix, latest, 1, "core"),
    percentileDelta1m: delta(suffix, latest, 1, "percentile"),
    percentileDelta3m: delta(suffix, latest, 3, "percentile"),
    percentileDelta5m: delta(suffix, latest, 5, "percentile"),
    rollingZDelta5m: delta(suffix, latest, 5, "rollingZComposite"),
    scoreVelocityPerMinute,
    velocityEventsSuppressed: suppressVelocityEventsUntil !== null && latest.at < suppressVelocityEventsUntil,
    suppressVelocityEventsUntil,
    modeTransition: transition,
    measurementWindowStartedAt: suffix[0].at,
    measurementResetReason: immediatePrevious === null
      ? "initial"
      : modeChanged
      ? "participation_mode_changed"
      : feedChanged
      ? "feed_mode_changed"
      : calibrationChanged
      ? "calibration_changed"
      : null,
  };
}
