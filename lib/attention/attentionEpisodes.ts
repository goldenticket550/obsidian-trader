import type { AttentionHistoryPoint } from "./attentionHistory";
import type { AttentionState, AttentionStateTransition } from "./attentionState";
import type { ModeTransitionMarker } from "@/lib/replay/modeTransitionGuard";
import {
  calibrationSetForScore,
  thresholdValuesForReplay,
  type FeedAwareAttentionThresholdStore,
} from "@/lib/replay/feedAwareAttentionThresholds";

export interface AttentionEpisodeConfig {
  gapBars: number;
  maxBackdateMinutes: number;
  episodeCoolingTimeoutMinutes: number;
}

export const DEFAULT_ATTENTION_EPISODE_CONFIG: AttentionEpisodeConfig = {
  gapBars: 2,
  maxBackdateMinutes: 30,
  episodeCoolingTimeoutMinutes: 45,
};

export interface AttentionEpisode {
  episodeId: string;
  symbol: string;
  qualifiedAt: number;
  startedAt: number;
  priceAtStart: number;
  peakAttention: number;
  peakCore: number;
  state: "active" | "cooling" | "completed";
  coolingStartedAt: number | null;
  completedAt: number | null;
  firstInPlayAt: number | null;
  inPlayEntryCount: number;
  reentryCount: number;
  modeTransitions: ModeTransitionMarker[];
  backdateTruncatedAtModeBoundary: boolean;
  backdateTruncatedAt: number | null;
  backdateTruncationReason: "uncalibrated_earlier_window" | "missing_earlier_window" | null;
  accelerationFailedAt: number | null;
}

function validateConfig(config: AttentionEpisodeConfig): void {
  if (!Number.isInteger(config.gapBars) || config.gapBars < 0 ||
      !Number.isInteger(config.maxBackdateMinutes) || config.maxBackdateMinutes < 1 ||
      !Number.isInteger(config.episodeCoolingTimeoutMinutes) || config.episodeCoolingTimeoutMinutes < 1) {
    throw new Error("Episode lifecycle configuration is invalid.");
  }
}

function watchingThreshold(store: FeedAwareAttentionThresholdStore, point: AttentionHistoryPoint): { value: number; calibrated: boolean } {
  const set = calibrationSetForScore(store, point.subWindow, point.feedMode);
  if (set.calibrationId !== point.calibrationId) {
    throw new Error(`History calibration ${point.calibrationId} does not match ${point.feedMode} x ${point.subWindow}.`);
  }
  const resolved = thresholdValuesForReplay(set);
  return { value: resolved.values.watchingEnterCore, calibrated: !resolved.provisional };
}

export function startAttentionEpisode(input: {
  history: readonly AttentionHistoryPoint[];
  calibrationStore: FeedAwareAttentionThresholdStore;
  config?: Partial<AttentionEpisodeConfig>;
}): AttentionEpisode {
  if (input.history.length === 0) throw new Error("Episode qualification requires history.");
  const config = { ...DEFAULT_ATTENTION_EPISODE_CONFIG, ...input.config };
  validateConfig(config);
  const qualifying = input.history.at(-1)!;
  let started = qualifying;
  let consecutiveGaps = 0;
  let truncatedAt: number | null = null;
  let truncationReason: AttentionEpisode["backdateTruncationReason"] = null;
  for (let index = input.history.length - 2; index >= 0; index -= 1) {
    const point = input.history[index];
    if (qualifying.at - point.at > config.maxBackdateMinutes * 60_000) break;
    const next = input.history[index + 1];
    const crossedBoundary = point.subWindow !== next.subWindow || point.feedMode !== next.feedMode || point.participationBaselineMode !== next.participationBaselineMode;
    let threshold: { value: number; calibrated: boolean };
    try {
      threshold = watchingThreshold(input.calibrationStore, point);
    } catch {
      if (crossedBoundary) {
        truncatedAt = next.at;
        truncationReason = "missing_earlier_window";
        break;
      }
      throw new Error(`Missing calibration while back-dating ${qualifying.symbol} inside ${point.subWindow}.`);
    }
    if (crossedBoundary && !threshold.calibrated) {
      truncatedAt = next.at;
      truncationReason = "uncalibrated_earlier_window";
      break;
    }
    if (point.core >= threshold.value) {
      consecutiveGaps = 0;
      started = point;
      continue;
    }
    consecutiveGaps += 1;
    if (consecutiveGaps > config.gapBars) break;
  }
  const run = input.history.filter((point) => point.at >= started.at);
  return {
    episodeId: `a3:${qualifying.symbol}:${qualifying.at}`,
    symbol: qualifying.symbol,
    qualifiedAt: qualifying.at,
    startedAt: started.at,
    priceAtStart: started.price,
    peakAttention: Math.max(...run.map((point) => point.score)),
    peakCore: Math.max(...run.map((point) => point.core)),
    state: "active",
    coolingStartedAt: null,
    completedAt: null,
    firstInPlayAt: null,
    inPlayEntryCount: 0,
    reentryCount: 0,
    modeTransitions: [],
    backdateTruncatedAtModeBoundary: truncatedAt !== null,
    backdateTruncatedAt: truncatedAt,
    backdateTruncationReason: truncationReason,
    accelerationFailedAt: null,
  };
}

/**
 * IN PLAY exit begins a timed cooling lease. State demotion does not complete
 * the episode. IN PLAY re-entry during the lease resumes the same identity;
 * only timeout completion permits a later qualification to create a new one.
 */
export function updateAttentionEpisode(input: {
  episode: AttentionEpisode;
  point: AttentionHistoryPoint;
  attentionState: AttentionState;
  transition?: AttentionStateTransition | null;
  modeTransition?: ModeTransitionMarker | null;
  accelerationFailed?: boolean;
  config?: Partial<AttentionEpisodeConfig>;
}): AttentionEpisode {
  if (input.point.symbol !== input.episode.symbol) throw new Error("Episode updates cannot cross symbols.");
  const config = { ...DEFAULT_ATTENTION_EPISODE_CONFIG, ...input.config };
  validateConfig(config);
  if (input.episode.state === "completed") return input.episode;

  let state: AttentionEpisode["state"] = input.episode.state;
  let coolingStartedAt = input.episode.coolingStartedAt;
  let completedAt = input.episode.completedAt;
  let firstInPlayAt = input.episode.firstInPlayAt;
  let inPlayEntryCount = input.episode.inPlayEntryCount;
  let reentryCount = input.episode.reentryCount;
  const enteredInPlay = input.transition?.to === "IN_PLAY" && input.transition.from !== "IN_PLAY";
  const exitedInPlay = input.transition?.from === "IN_PLAY" && input.transition.to === "COOLING";

  if (enteredInPlay) {
    if (firstInPlayAt === null) firstInPlayAt = input.point.at;
    else if (state === "cooling") reentryCount += 1;
    inPlayEntryCount += 1;
    state = "active";
    coolingStartedAt = null;
  } else if (exitedInPlay || (input.accelerationFailed && state === "active")) {
    state = "cooling";
    coolingStartedAt ??= input.point.at;
  } else if (state === "cooling" && coolingStartedAt !== null &&
             input.point.at - coolingStartedAt >= config.episodeCoolingTimeoutMinutes * 60_000) {
    state = "completed";
    completedAt = input.point.at;
  } else if (firstInPlayAt === null && input.attentionState === "LOW_PRIORITY") {
    state = "completed";
    completedAt = input.point.at;
  }

  return {
    ...input.episode,
    peakAttention: Math.max(input.episode.peakAttention, input.point.score),
    peakCore: Math.max(input.episode.peakCore, input.point.core),
    state,
    coolingStartedAt,
    completedAt,
    firstInPlayAt,
    inPlayEntryCount,
    reentryCount,
    modeTransitions: input.modeTransition ? [...input.episode.modeTransitions, input.modeTransition] : input.episode.modeTransitions,
    accelerationFailedAt: input.accelerationFailed && input.episode.accelerationFailedAt === null ? input.point.at : input.episode.accelerationFailedAt,
  };
}