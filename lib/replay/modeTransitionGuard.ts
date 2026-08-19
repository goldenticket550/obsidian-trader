import type { BaselineMode } from "./baselineModes";

export const DEFAULT_MODE_TRANSITION_GUARD_MS = 10 * 60_000;
export const DEFAULT_VELOCITY_WINDOW_MS = 15 * 60_000;

export interface AttentionScoreEvaluation {
  at: number;
  score: number;
  participationBaselineMode: BaselineMode;
}

export interface ModeTransitionMarker {
  at: number;
  from: BaselineMode;
  to: BaselineMode;
  suppressVelocityEventsUntil: number;
}

export interface ModeAwareVelocityState {
  participationBaselineMode: BaselineMode;
  samples: AttentionScoreEvaluation[];
  suppressVelocityEventsUntil: number | null;
}

export interface ModeAwareVelocityResult {
  state: ModeAwareVelocityState;
  score: AttentionScoreEvaluation;
  velocityPerMinute: number | null;
  velocityEventsSuppressed: boolean;
  modeTransition: ModeTransitionMarker | null;
}

export interface ModeTransitionGuardConfig {
  guardMs?: number;
  velocityWindowMs?: number;
}

function assertEvaluation(evaluation: AttentionScoreEvaluation): void {
  if (!Number.isFinite(evaluation.at) || !Number.isFinite(evaluation.score)) {
    throw new Error("Attention evaluations require finite timestamps and scores.");
  }
}

/**
 * Updates velocity without ever differencing scores produced by different
 * participation methodologies. The score remains available during the guard.
 */
export function updateModeAwareVelocity(
  previous: ModeAwareVelocityState | null,
  evaluation: AttentionScoreEvaluation,
  config: ModeTransitionGuardConfig = {}
): ModeAwareVelocityResult {
  assertEvaluation(evaluation);
  const guardMs = config.guardMs ?? DEFAULT_MODE_TRANSITION_GUARD_MS;
  const velocityWindowMs = config.velocityWindowMs ?? DEFAULT_VELOCITY_WINDOW_MS;
  if (guardMs < 0 || velocityWindowMs <= 0) throw new Error("Mode-transition guard windows must be valid positive durations.");

  if (!previous) {
    return {
      state: {
        participationBaselineMode: evaluation.participationBaselineMode,
        samples: [evaluation],
        suppressVelocityEventsUntil: null,
      },
      score: evaluation,
      velocityPerMinute: null,
      velocityEventsSuppressed: false,
      modeTransition: null,
    };
  }

  if (evaluation.at <= previous.samples[previous.samples.length - 1].at) {
    throw new Error("Attention evaluations must be strictly chronological.");
  }

  if (previous.participationBaselineMode !== evaluation.participationBaselineMode) {
    const marker: ModeTransitionMarker = {
      at: evaluation.at,
      from: previous.participationBaselineMode,
      to: evaluation.participationBaselineMode,
      suppressVelocityEventsUntil: evaluation.at + guardMs,
    };
    return {
      state: {
        participationBaselineMode: evaluation.participationBaselineMode,
        samples: [evaluation],
        suppressVelocityEventsUntil: marker.suppressVelocityEventsUntil,
      },
      score: evaluation,
      velocityPerMinute: null,
      velocityEventsSuppressed: guardMs > 0,
      modeTransition: marker,
    };
  }

  const samples = [...previous.samples, evaluation]
    .filter((sample) => sample.at >= evaluation.at - velocityWindowMs);
  const oldest = samples[0];
  const elapsedMinutes = (evaluation.at - oldest.at) / 60_000;
  const velocityPerMinute = elapsedMinutes > 0 ? (evaluation.score - oldest.score) / elapsedMinutes : null;
  const suppressUntil = previous.suppressVelocityEventsUntil;

  return {
    state: {
      participationBaselineMode: evaluation.participationBaselineMode,
      samples,
      suppressVelocityEventsUntil: suppressUntil,
    },
    score: evaluation,
    velocityPerMinute,
    velocityEventsSuppressed: suppressUntil !== null && evaluation.at < suppressUntil,
    modeTransition: null,
  };
}

export function compareAttentionScores(
  earlier: AttentionScoreEvaluation,
  later: AttentionScoreEvaluation,
  options: { allowCrossMode?: boolean } = {}
): number {
  if (earlier.participationBaselineMode !== later.participationBaselineMode && !options.allowCrossMode) {
    throw new Error("Cross-mode attention-score comparison requires explicit allowCrossMode opt-in.");
  }
  return later.score - earlier.score;
}

export interface EpisodeModeContinuity {
  episodeId: string;
  modeTransitions: ModeTransitionMarker[];
}

export function recordEpisodeModeTransition(
  episode: EpisodeModeContinuity,
  marker: ModeTransitionMarker
): EpisodeModeContinuity {
  return { ...episode, modeTransitions: [...episode.modeTransitions, marker] };
}
