import type { AttentionEpisode } from "./attentionEpisodes";
import type { AttentionHistoryPoint } from "./attentionHistory";

export type AttentionFreshness = "Fresh" | "Developing" | "Mature" | "Extended";

export interface AttentionFreshnessConfig {
  developingMinutes: number;
  matureMinutes: number;
  developingTravelAtr: number;
  matureTravelAtr: number;
  extendedEmaDistanceAtr: number;
  developingExpansionBars: number;
}

export const DEFAULT_ATTENTION_FRESHNESS_CONFIG: AttentionFreshnessConfig = {
  developingMinutes: 10,
  matureMinutes: 30,
  developingTravelAtr: 0.5,
  matureTravelAtr: 1.25,
  extendedEmaDistanceAtr: 1.5,
  developingExpansionBars: 2,
};

export interface AttentionFreshnessResult {
  freshness: AttentionFreshness;
  minutesSinceEpisodeStart: number;
  atrTravelledSinceStart: number;
  distanceFromVwapAtr: number | null;
  distanceFromEma9Atr: number | null;
  consecutiveExpansionBars: number;
  pullbackObserved: boolean;
  reasons: string[];
}

export type AttentionFreshnessPoint = Pick<
  AttentionHistoryPoint,
  "symbol" | "at" | "price" | "atr" | "vwap" | "ema9" | "consecutiveExpansionBars" | "pullbackObserved"
>;

/** Price-and-time-only maturity. Rank and rank duration are not accepted inputs. */
export function classifyAttentionFreshness(
  episode: AttentionEpisode,
  point: AttentionFreshnessPoint,
  config: AttentionFreshnessConfig = DEFAULT_ATTENTION_FRESHNESS_CONFIG
): AttentionFreshnessResult {
  if (episode.symbol !== point.symbol || point.at < episode.startedAt) throw new Error("Freshness requires a current point from its episode.");
  const minutesSinceEpisodeStart = (point.at - episode.startedAt) / 60_000;
  const atrTravelledSinceStart = Math.abs(point.price - episode.priceAtStart) / point.atr;
  const distanceFromVwapAtr = point.vwap === null ? null : Math.abs(point.price - point.vwap) / point.atr;
  const distanceFromEma9Atr = point.ema9 === null ? null : Math.abs(point.price - point.ema9) / point.atr;
  const reasons: string[] = [];
  // Published D1 semantics: Extended means too far from the current 9 EMA now.
  // Episode travel, VWAP distance, and expansion runs remain factual context only.
  const extended = distanceFromEma9Atr !== null
    && distanceFromEma9Atr >= config.extendedEmaDistanceAtr;
  let freshness: AttentionFreshness;
  if (extended) {
    freshness = "Extended";
    reasons.push("ema9_distance_extended");
  } else if (minutesSinceEpisodeStart >= config.matureMinutes
    || atrTravelledSinceStart >= config.matureTravelAtr
    || point.pullbackObserved) {
    freshness = "Mature";
    if (minutesSinceEpisodeStart >= config.matureMinutes) reasons.push("time_mature");
    if (atrTravelledSinceStart >= config.matureTravelAtr) reasons.push("atr_travel_mature");
    if (point.pullbackObserved) reasons.push("pullback_history_mature");
  } else if (minutesSinceEpisodeStart >= config.developingMinutes
    || atrTravelledSinceStart >= config.developingTravelAtr
    || point.consecutiveExpansionBars >= config.developingExpansionBars) {
    freshness = "Developing";
    if (minutesSinceEpisodeStart >= config.developingMinutes) reasons.push("time_developing");
    if (atrTravelledSinceStart >= config.developingTravelAtr) reasons.push("atr_travel_developing");
    if (point.consecutiveExpansionBars >= config.developingExpansionBars) reasons.push("expansion_developing");
  } else {
    freshness = "Fresh";
    reasons.push("early_price_time_stage");
  }
  return {
    freshness,
    minutesSinceEpisodeStart,
    atrTravelledSinceStart,
    distanceFromVwapAtr,
    distanceFromEma9Atr,
    consecutiveExpansionBars: point.consecutiveExpansionBars,
    pullbackObserved: point.pullbackObserved,
    reasons,
  };
}
