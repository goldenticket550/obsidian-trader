import {
  updateAttentionHistory,
  type AttentionHistoryObservation,
  type AttentionHistoryPoint,
  type AttentionHistoryState,
} from "./attentionHistory";
import { computeAttentionVelocity, type AttentionVelocity } from "./attentionVelocity";
import {
  assertAttentionStateFrameInvariants,
  explainAttentionState,
  updateAttentionState,
  type PendingAttentionTransition,
  type AttentionStateMemory,
  type AttentionStateTransition,
} from "./attentionState";
import {
  startAttentionEpisode,
  updateAttentionEpisode,
  type AttentionEpisode,
} from "./attentionEpisodes";
import { classifyAttentionFreshness, type AttentionFreshnessResult } from "./attentionFreshness";
import {
  updateEpisodePullback,
  type EpisodePullbackMemory,
} from "./attentionPullback";
import {
  updateAttentionCooling,
  type AttentionCoolingMemory,
  type AttentionCoolingResult,
} from "./attentionCooling";
import {
  buildAttentionLists,
  DEFAULT_ATTENTION_LIST_CONFIG,
  type AttentionListConfig,
  type AttentionLists,
} from "./attentionLists";
import { rankableUniverse, type UniverseSymbol } from "./universePolicy";
import {
  calibrationSetForScore,
  thresholdValuesForReplay,
  type FeedAwareAttentionThresholdStore,
} from "@/lib/replay/feedAwareAttentionThresholds";

interface SymbolA3Memory {
  state: AttentionStateMemory | null;
  episode: AttentionEpisode | null;
  cooling: AttentionCoolingMemory | null;
  pullback: EpisodePullbackMemory | null;
}

export interface AttentionA3ReplayConfig {
  /** Rolling median window for state decisions. Zero preserves raw-core behavior. */
  stateSmoothingMinutes: number;
  episodeCoolingTimeoutMinutes: number;
  listConfig: AttentionListConfig;
}

export const DEFAULT_ATTENTION_A3_REPLAY_CONFIG: AttentionA3ReplayConfig = {
  stateSmoothingMinutes: 0,
  episodeCoolingTimeoutMinutes: 45,
  listConfig: DEFAULT_ATTENTION_LIST_CONFIG,
};

function smoothedStateCore(
  history: readonly AttentionHistoryPoint[],
  minutes: number,
): number {
  if (minutes === 0) return history.at(-1)!.core;
  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error("State smoothing must be zero or a positive integer number of minutes.");
  }
  const latest = history.at(-1)!;
  const cutoff = latest.at - (minutes - 1) * 60_000;
  const values = history
    .filter((point) => point.at >= cutoff)
    .map((point) => point.core)
    .sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}
export interface AttentionA3ProcessTimings {
  stateMachineMs: number;
  episodeMs: number;
}

export interface AttentionA3EngineState {
  history: AttentionHistoryState | null;
  symbols: Record<string, SymbolA3Memory>;
}

export interface AttentionA3FrameRow {
  symbol: string;
  point: AttentionHistoryPoint;
  coreSmoothed: number;
  velocity: AttentionVelocity;
  state: AttentionStateMemory["state"];
  stateEnteredAt: number;
  statePersistenceMinutes: number;
  pendingTransition: PendingAttentionTransition;
  pendingTransitionMinutes: number;
  stateExplanation: string;
  transition: AttentionStateTransition | null;
  episode: AttentionEpisode | null;
  freshness: AttentionFreshnessResult | null;
  cooling: AttentionCoolingResult;
  thresholdCalibrationStatus: "pending_calibration" | "calibrated" | "unavailable_by_construction";
  provisional: boolean;
  conclusionsAllowed: boolean;
}

export interface AttentionA3Frame {
  at: number;
  rows: AttentionA3FrameRow[];
  lists: AttentionLists;
  provisional: boolean;
  conclusionsAllowed: boolean;
}

export class AttentionA3ReplayEngine {
  private state: AttentionA3EngineState = { history: null, symbols: {} };

  constructor(
    private readonly calibrationStore: FeedAwareAttentionThresholdStore,
    private readonly universe: readonly UniverseSymbol[],
    private readonly config: AttentionA3ReplayConfig = DEFAULT_ATTENTION_A3_REPLAY_CONFIG,
  ) {
    if (!Number.isInteger(config.episodeCoolingTimeoutMinutes) || config.episodeCoolingTimeoutMinutes < 1) {
      throw new Error("Episode cooling timeout must be a positive integer number of minutes.");
    }
    if (!Number.isInteger(config.stateSmoothingMinutes) || config.stateSmoothingMinutes < 0) {
      throw new Error("State smoothing must be zero or a positive integer number of minutes.");
    }
  }

  snapshot(): AttentionA3EngineState {
    return structuredClone(this.state);
  }

  /** Restore only a checkpoint whose configuration identity was validated by the runtime. */
  restore(snapshot: AttentionA3EngineState): void {
    if (!snapshot || typeof snapshot !== "object" || !snapshot.symbols) {
      throw new Error("A3 restore requires a valid engine snapshot.");
    }
    this.state = structuredClone(snapshot);
  }

  processMinute(observations: readonly AttentionHistoryObservation[], timings?: AttentionA3ProcessTimings): AttentionA3Frame {
    const rankable = new Set(rankableUniverse(this.universe).map((entry) => entry.symbol));
    const eligible = observations.filter((row) => rankable.has(row.symbol));
    if (eligible.length === 0) throw new Error("A3 replay requires at least one rankable observation.");
    const processStartedAt = performance.now();
    let episodeMs = 0;
    const previousHistory = this.state.history;
    const historyUpdate = updateAttentionHistory(previousHistory, eligible);
    this.state.history = historyUpdate.state;
    const rows: AttentionA3FrameRow[] = [];

    for (const point of historyUpdate.frame) {
      const memory = this.state.symbols[point.symbol] ?? { state: null, episode: null, cooling: null, pullback: null };
      const symbolHistory = historyUpdate.state.bySymbol[point.symbol];
      const previousPoint = previousHistory?.bySymbol[point.symbol]?.at(-1) ?? null;
      const velocity = computeAttentionVelocity(symbolHistory);
      const coreSmoothed = smoothedStateCore(symbolHistory, this.config.stateSmoothingMinutes);
      const cooling = updateAttentionCooling({
        previousMemory: memory.episode?.state === "completed" ? null : memory.cooling,
        previousPoint,
        point,
        velocity,
      });
      const calibrationSet = calibrationSetForScore(this.calibrationStore, point.subWindow, point.feedMode);
      if (calibrationSet.calibrationId !== point.calibrationId) {
        throw new Error(`A3 point ${point.symbol} carries the wrong feed/window calibration identity.`);
      }
      const thresholds = thresholdValuesForReplay(calibrationSet);
      if (point.provisional !== thresholds.provisional) {
        throw new Error(`A3 point ${point.symbol} has inconsistent provisional calibration metadata.`);
      }
      const stateUpdate = updateAttentionState({
        previous: memory.state,
        at: point.at,
        core: coreSmoothed,
        thresholds: thresholds.values,
        enterPersistenceMinutes: thresholds.values.enterPersistenceMinutes,
        exitPersistenceMinutes: thresholds.values.exitPersistenceMinutes,
        accelerationFailed: cooling.accelerationFailed,
      });
      const episodeStartedAt = performance.now();
      let episode = memory.episode;
      if ((stateUpdate.transition?.from === "LOW_PRIORITY" && stateUpdate.transition.to !== "LOW_PRIORITY") ||
          (episode?.state === "completed" && stateUpdate.transition?.to === "IN_PLAY")) {
        episode = startAttentionEpisode({
          history: symbolHistory,
          calibrationStore: this.calibrationStore,
          config: { episodeCoolingTimeoutMinutes: this.config.episodeCoolingTimeoutMinutes },
        });
      }
      if (episode) {
        episode = updateAttentionEpisode({
          episode,
          point,
          attentionState: stateUpdate.memory.state,
          transition: stateUpdate.transition,
          modeTransition: velocity.modeTransition,
          accelerationFailed: cooling.accelerationFailed,
          config: { episodeCoolingTimeoutMinutes: this.config.episodeCoolingTimeoutMinutes },
        });
      }
      const pullback = updateEpisodePullback({
        previous: memory.pullback,
        episode,
        history: symbolHistory,
        point,
      });
      const freshnessPoint = pullback
        ? { ...point, pullbackObserved: pullback.observed }
        : point;
      const freshness = episode && episode.state !== "completed"
        ? classifyAttentionFreshness(episode, freshnessPoint)
        : null;
      episodeMs += performance.now() - episodeStartedAt;
      const statePersistenceMinutes = Math.floor((point.at - stateUpdate.memory.stateEnteredAt) / 60_000) + 1;
      this.state.symbols[point.symbol] = {
        state: stateUpdate.memory,
        episode,
        cooling: cooling.memory,
        pullback,
      };
      rows.push({
        symbol: point.symbol,
        point,
        coreSmoothed,
        velocity,
        state: stateUpdate.memory.state,
        stateEnteredAt: stateUpdate.memory.stateEnteredAt,
        statePersistenceMinutes,
        pendingTransition: stateUpdate.memory.pendingTransition,
        pendingTransitionMinutes: stateUpdate.memory.pendingTransitionMinutes,
        stateExplanation: explainAttentionState(stateUpdate.memory, coreSmoothed, thresholds.values),
        transition: stateUpdate.transition,
        episode,
        freshness,
        cooling,
        thresholdCalibrationStatus: calibrationSet.calibrationStatus,
        provisional: thresholds.provisional,
        conclusionsAllowed: thresholds.conclusionsAllowed,
      });
    }

    assertAttentionStateFrameInvariants(rows.map((row) => {
      const set = calibrationSetForScore(this.calibrationStore, row.point.subWindow, row.point.feedMode);
      return {
        symbol: row.symbol,
        feedMode: row.point.feedMode,
        subWindow: row.point.subWindow,
        core: row.coreSmoothed,
        memory: this.state.symbols[row.symbol].state!,
        thresholds: thresholdValuesForReplay(set).values,
        enterPersistenceMinutes: thresholdValuesForReplay(set).values.enterPersistenceMinutes,
        exitPersistenceMinutes: thresholdValuesForReplay(set).values.exitPersistenceMinutes,
      };
    }));
    const lists = buildAttentionLists(rows.map((row) => {
      const set = calibrationSetForScore(this.calibrationStore, row.point.subWindow, row.point.feedMode);
      return {
        symbol: row.symbol,
        point: row.point,
        state: row.state,
        statePersistenceMinutes: row.statePersistenceMinutes,
        pendingTransition: row.pendingTransition,
        pendingTransitionMinutes: row.pendingTransitionMinutes,
        stateExplanation: row.stateExplanation,
        episode: row.episode,
        freshness: row.freshness,
        velocity: row.velocity,
        dataQualityState: row.point.dataQualityState,
      };
    }), this.universe, this.config.listConfig);
    const provisional = rows.some((row) => row.provisional);
    if (timings) {
      timings.episodeMs = episodeMs;
      timings.stateMachineMs = performance.now() - processStartedAt - episodeMs;
    }
    return {
      at: rows[0].point.at,
      rows,
      lists,
      provisional,
      conclusionsAllowed: !provisional && rows.every((row) => row.conclusionsAllowed),
    };
  }
}
