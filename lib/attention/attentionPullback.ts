import type { AttentionEpisode } from "./attentionEpisodes";
import type { AttentionHistoryPoint } from "./attentionHistory";

export interface EpisodePullbackConfig {
  directionalExcursionAtr: number;
  retracementAtr: number;
}

export const DEFAULT_EPISODE_PULLBACK_CONFIG: EpisodePullbackConfig = {
  directionalExcursionAtr: 0.5,
  retracementAtr: 0.3,
};

export interface EpisodePullbackMemory {
  episodeId: string;
  priceAtStart: number;
  highSinceStart: number;
  lowSinceStart: number;
  observed: boolean;
}

function applyPoint(
  previous: EpisodePullbackMemory,
  point: Pick<AttentionHistoryPoint, "price" | "atr">,
  config: EpisodePullbackConfig,
): EpisodePullbackMemory {
  const highSinceStart = Math.max(previous.highSinceStart, point.price);
  const lowSinceStart = Math.min(previous.lowSinceStart, point.price);
  const upwardExcursion = highSinceStart - previous.priceAtStart;
  const downwardExcursion = previous.priceAtStart - lowSinceStart;
  const upwardPullback =
    upwardExcursion >= config.directionalExcursionAtr * point.atr &&
    highSinceStart - point.price >= config.retracementAtr * point.atr;
  const downwardPullback =
    downwardExcursion >= config.directionalExcursionAtr * point.atr &&
    point.price - lowSinceStart >= config.retracementAtr * point.atr;
  return {
    ...previous,
    highSinceStart,
    lowSinceStart,
    observed: previous.observed || upwardPullback || downwardPullback,
  };
}

/** Pullback history is scoped to an attention episode, never to the trading day. */
export function updateEpisodePullback(input: {
  previous: EpisodePullbackMemory | null;
  episode: AttentionEpisode | null;
  history: readonly AttentionHistoryPoint[];
  point: AttentionHistoryPoint;
  config?: Partial<EpisodePullbackConfig>;
}): EpisodePullbackMemory | null {
  const { episode, point } = input;
  if (!episode || episode.state === "completed") return null;
  const config = { ...DEFAULT_EPISODE_PULLBACK_CONFIG, ...input.config };
  if (
    config.directionalExcursionAtr <= 0 ||
    config.retracementAtr <= 0 ||
    !Number.isFinite(config.directionalExcursionAtr) ||
    !Number.isFinite(config.retracementAtr)
  ) {
    throw new Error("Episode pullback configuration must contain positive finite ATR thresholds.");
  }
  if (episode.symbol !== point.symbol) {
    throw new Error("Episode pullback updates cannot cross symbols.");
  }
  if (!input.previous || input.previous.episodeId !== episode.episodeId) {
    let memory: EpisodePullbackMemory = {
      episodeId: episode.episodeId,
      priceAtStart: episode.priceAtStart,
      highSinceStart: episode.priceAtStart,
      lowSinceStart: episode.priceAtStart,
      observed: false,
    };
    for (const sample of input.history) {
      if (sample.at < episode.startedAt || sample.at > point.at) continue;
      memory = applyPoint(memory, sample, config);
    }
    return memory;
  }
  return applyPoint(input.previous, point, config);
}