import { describe, expect, it } from "vitest";
import {
  assertAttentionStateFrameInvariants,
  updateAttentionState,
  type AttentionStateMemory,
} from "@/lib/attention/attentionState";
import { startAttentionEpisode, updateAttentionEpisode } from "@/lib/attention/attentionEpisodes";
import type { AttentionHistoryPoint } from "@/lib/attention/attentionHistory";
import {
  PROVISIONAL_A3_THRESHOLD_VALUES,
  createPendingFeedAwareThresholdStore,
} from "@/lib/replay/feedAwareAttentionThresholds";

const minute = 60_000;

function point(input: {
  at: number;
  core: number;
  subWindow?: AttentionHistoryPoint["subWindow"];
  calibrationId: string;
  mode?: AttentionHistoryPoint["participationBaselineMode"];
  price?: number;
}): AttentionHistoryPoint {
  return {
    symbol: "AAA", at: input.at, score: input.core * 100, core: input.core,
    feedMode: "sip", subWindow: input.subWindow ?? "regular", calibrationId: input.calibrationId,
    participationBaselineMode: input.mode ?? "dense", participationInput: 1, participationInputKind: "z",
    displacementZ: 1, idiosyncrasyZ: 1, price: input.price ?? 100, atr: 2, vwap: 100, ema9: 100,
    consecutiveExpansionBars: 0, pullbackObserved: false, priceLostVwap: false, dataQualityState: "ok",
    provisional: true, rank: 1, percentile: 1, rollingZComposite: 1,
  };
}

describe("A3 staged states and episode back-dating", () => {
  it("requires two consecutive minutes in both promotion and demotion directions", () => {
    let memory: AttentionStateMemory | null = null;
    let update = updateAttentionState({ previous: memory, at: 0, core: 0.30, thresholds: PROVISIONAL_A3_THRESHOLD_VALUES });
    memory = update.memory;
    expect(memory.state).toBe("LOW_PRIORITY");
    expect(memory.candidateObservations).toBe(1);
    update = updateAttentionState({ previous: memory, at: minute, core: 0.30, thresholds: PROVISIONAL_A3_THRESHOLD_VALUES });
    memory = update.memory;
    expect(update.transition).toMatchObject({ from: "LOW_PRIORITY", to: "WATCHING", persistedMinutes: 2 });
    update = updateAttentionState({ previous: memory, at: 2 * minute, core: 0.10, thresholds: PROVISIONAL_A3_THRESHOLD_VALUES });
    memory = update.memory;
    expect(memory.state).toBe("WATCHING");
    update = updateAttentionState({ previous: memory, at: 3 * minute, core: 0.10, thresholds: PROVISIONAL_A3_THRESHOLD_VALUES });
    expect(update.transition).toMatchObject({ from: "WATCHING", to: "LOW_PRIORITY", persistedMinutes: 2 });
  });

  it("accepts the 2025-10-10 AMD/CRWV ordering while both symbols have pending transitions", () => {
    const thresholds = {
      ...PROVISIONAL_A3_THRESHOLD_VALUES,
      watchingEnterCore: 0.25,
      watchingExitCore: 0.20,
      emergingEnterCore: 0.50,
      emergingExitCore: 0.40,
      inPlayEnterCore: 0.991,
      inPlayExitCore: 0.995,
    };
    let amd: AttentionStateMemory | null = null;
    amd = updateAttentionState({ previous: amd, at: 0, core: 1, thresholds }).memory;
    amd = updateAttentionState({ previous: amd, at: minute, core: 1, thresholds }).memory;
    amd = updateAttentionState({ previous: amd, at: 2 * minute, core: 0.990347, thresholds }).memory;
    let crwv: AttentionStateMemory | null = null;
    crwv = updateAttentionState({ previous: crwv, at: 0, core: 0.5, thresholds }).memory;
    crwv = updateAttentionState({ previous: crwv, at: minute, core: 0.5, thresholds }).memory;
    crwv = updateAttentionState({ previous: crwv, at: 2 * minute, core: 0.991485, thresholds }).memory;
    expect(amd).toMatchObject({ state: "IN_PLAY", pendingTransition: "exiting", pendingTransitionMinutes: 1 });
    expect(crwv).toMatchObject({ state: "EMERGING", pendingTransition: "promoting", pendingTransitionMinutes: 1 });
    expect(() => assertAttentionStateFrameInvariants([
      { symbol: "AMD", feedMode: "sip", subWindow: "regular", core: 0.990347, memory: amd!, thresholds, persistenceMinutes: 2 },
      { symbol: "CRWV", feedMode: "sip", subWindow: "regular", core: 0.991485, memory: crwv!, thresholds, persistenceMinutes: 2 },
    ])).not.toThrow();
  });

  it("fails I1-I4 divergence in settled state, but not during declared persistence", () => {
    const thresholds = PROVISIONAL_A3_THRESHOLD_VALUES;
    let earned = updateAttentionState({ previous: null, at: 0, core: 0.55, thresholds }).memory;
    earned = updateAttentionState({ previous: earned, at: minute, core: 0.55, thresholds }).memory;
    const unearned = { ...earned, stateEnterThresholdMetAt: null };
    expect(() => assertAttentionStateFrameInvariants([
      { symbol: "BAD", feedMode: "sip", subWindow: "regular", core: 0.55, memory: unearned, thresholds, persistenceMinutes: 2 },
    ])).toThrow(/I1 NO UNEARNED STATE/);
  });

  it("accepts cross-symbol inversion while enforcing each settled symbol's own I4' band", () => {
    const thresholds = PROVISIONAL_A3_THRESHOLD_VALUES;
    let watching = updateAttentionState({ previous: null, at: 0, core: 0.30, thresholds }).memory;
    watching = updateAttentionState({ previous: watching, at: minute, core: 0.30, thresholds }).memory;
    watching = updateAttentionState({ previous: watching, at: 2 * minute, core: 0.49, thresholds }).memory;
    let emerging = updateAttentionState({ previous: null, at: 0, core: 0.55, thresholds }).memory;
    emerging = updateAttentionState({ previous: emerging, at: minute, core: 0.55, thresholds }).memory;
    emerging = updateAttentionState({ previous: emerging, at: 2 * minute, core: 0.41, thresholds }).memory;
    expect(watching).toMatchObject({ state: "WATCHING", pendingTransition: "none" });
    expect(emerging).toMatchObject({ state: "EMERGING", pendingTransition: "none" });
    const rows = [
      { symbol: "HIGHER_SCORE", feedMode: "sip" as const, subWindow: "regular" as const, core: 0.49, memory: watching, thresholds, persistenceMinutes: 2 },
      { symbol: "LOWER_SCORE", feedMode: "sip" as const, subWindow: "regular" as const, core: 0.41, memory: emerging, thresholds, persistenceMinutes: 2 },
    ];
    expect(() => assertAttentionStateFrameInvariants(rows)).not.toThrow();
    expect(() => assertAttentionStateFrameInvariants([{ ...rows[0], core: 0.55 }])).toThrow(/I4' SETTLED OCCUPANCY BAND/);
  });

  it("preserves a higher pending promotion when a lower-state settlement commits", () => {
    const thresholds = PROVISIONAL_A3_THRESHOLD_VALUES;
    let memory = updateAttentionState({ previous: null, at: 0, core: 0.55, thresholds }).memory;
    const update = updateAttentionState({ previous: memory, at: minute, core: 0.75, thresholds });
    memory = update.memory;
    expect(update.transition).toMatchObject({ from: "LOW_PRIORITY", to: "EMERGING" });
    expect(memory).toMatchObject({
      state: "EMERGING", candidateState: "IN_PLAY", pendingTransition: "promoting", pendingTransitionMinutes: 1,
    });
    expect(() => assertAttentionStateFrameInvariants([{
      symbol: "IWM", feedMode: "sip", subWindow: "premarket_early", core: 0.75,
      memory, thresholds, persistenceMinutes: 2,
    }])).not.toThrow();
  });

  it("back-dates within one sub-window across the allowed two-bar gap", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    const calibrationId = store.sets.sip.regular.calibrationId;
    const episode = startAttentionEpisode({
      calibrationStore: store,
      history: [
        point({ at: 0, core: 0.30, calibrationId, price: 100 }),
        point({ at: minute, core: 0.18, calibrationId, price: 100.2 }),
        point({ at: 2 * minute, core: 0.27, calibrationId, price: 100.4 }),
        point({ at: 3 * minute, core: 0.32, calibrationId, price: 100.8 }),
      ],
    });
    expect(episode.startedAt).toBe(0);
    expect(episode.priceAtStart).toBe(100);
    expect(episode.qualifiedAt).toBe(3 * minute);
    expect(episode.backdateTruncatedAtModeBoundary).toBe(false);
  });

  it("truncates at 09:30 rather than borrowing the regular threshold for sparse premarket", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    const premarket = store.sets.sip.premarket_final;
    const regular = store.sets.sip.regular;
    const episode = startAttentionEpisode({
      calibrationStore: store,
      history: [
        point({ at: 0, core: 0.40, subWindow: "premarket_final", calibrationId: premarket.calibrationId, mode: "sparse", price: 99 }),
        point({ at: minute, core: 0.35, subWindow: "regular", calibrationId: regular.calibrationId, mode: "dense", price: 101 }),
      ],
    });
    expect(episode.startedAt).toBe(minute);
    expect(episode.priceAtStart).toBe(101);
    expect(episode.backdateTruncatedAtModeBoundary).toBe(true);
    expect(episode.backdateTruncatedAt).toBe(minute);
    expect(episode.backdateTruncationReason).toBe("uncalibrated_earlier_window");
  });

  it("keeps one episode identity through ACCELERATION_FAILED and COOLING", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    const calibrationId = store.sets.sip.regular.calibrationId;
    const current = point({ at: minute, core: 0.55, calibrationId, price: 99 });
    const original = startAttentionEpisode({ calibrationStore: store, history: [
      point({ at: 0, core: 0.30, calibrationId, price: 100 }), current,
    ] });
    const cooling = updateAttentionEpisode({
      episode: original, point: current, attentionState: "COOLING", accelerationFailed: true,
    });
    const repeated = updateAttentionEpisode({
      episode: cooling, point: { ...current, at: 2 * minute }, attentionState: "COOLING", accelerationFailed: true,
    });
    expect(cooling.episodeId).toBe(original.episodeId);
    expect(cooling).toMatchObject({ state: "cooling", accelerationFailedAt: minute });
    expect(repeated.episodeId).toBe(original.episodeId);
    expect(repeated.accelerationFailedAt).toBe(minute);
  });
  it("keeps IN PLAY slow to leave with independent exit persistence", () => {
    const thresholds = { ...PROVISIONAL_A3_THRESHOLD_VALUES, enterPersistenceMinutes: 2, exitPersistenceMinutes: 5 };
    let memory = updateAttentionState({ previous: null, at: 0, core: 0.75, thresholds, enterPersistenceMinutes: 2, exitPersistenceMinutes: 5 }).memory;
    memory = updateAttentionState({ previous: memory, at: minute, core: 0.75, thresholds, enterPersistenceMinutes: 2, exitPersistenceMinutes: 5 }).memory;
    expect(memory.state).toBe("IN_PLAY");
    for (let index = 2; index < 6; index++) {
      memory = updateAttentionState({ previous: memory, at: index * minute, core: 0.1, thresholds, enterPersistenceMinutes: 2, exitPersistenceMinutes: 5 }).memory;
      expect(memory.state).toBe("IN_PLAY");
      expect(memory.pendingTransition).toBe("exiting");
      expect(memory.pendingTransitionMinutes).toBe(index - 1);
    }
    memory = updateAttentionState({ previous: memory, at: 6 * minute, core: 0.1, thresholds, enterPersistenceMinutes: 2, exitPersistenceMinutes: 5 }).memory;
    expect(memory.state).toBe("COOLING");
  });
});
