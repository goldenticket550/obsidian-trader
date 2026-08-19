import { describe, expect, it } from "vitest";
import { AttentionA3ReplayEngine, DEFAULT_ATTENTION_A3_REPLAY_CONFIG } from "@/lib/attention/attentionA3Replay";
import type { AttentionHistoryObservation } from "@/lib/attention/attentionHistory";
import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";
import { createPendingFeedAwareThresholdStore } from "@/lib/replay/feedAwareAttentionThresholds";

const minute = 60_000;

function observation(input: {
  at: number;
  score: number;
  core: number;
  calibrationId: string;
  subWindow?: AttentionHistoryObservation["subWindow"];
  mode?: AttentionHistoryObservation["participationBaselineMode"];
  price?: number;
  pullbackObserved?: boolean;
  consecutiveExpansionBars?: number;
}): AttentionHistoryObservation {
  return {
    symbol: "AAOI", at: input.at, score: input.score, core: input.core, feedMode: "sip",
    subWindow: input.subWindow ?? "regular", calibrationId: input.calibrationId,
    participationBaselineMode: input.mode ?? "dense", participationInput: input.score / 20,
    participationInputKind: input.mode === "sparse" ? "surprise_bits" : "z",
    displacementZ: input.score / 25, idiosyncrasyZ: input.score / 30,
    price: input.price ?? 100, atr: 2, vwap: 100, ema9: 100,
    consecutiveExpansionBars: input.consecutiveExpansionBars ?? (input.at >= 5 * minute ? 2 : 0),
    pullbackObserved: input.pullbackObserved ?? false,
    priceLostVwap: false, dataQualityState: "ok", provisional: true,
  };
}

describe("A3 replay engine composition", () => {
  it("builds one back-dated episode through staged states and produces provisional IN PLAY rows", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    const calibrationId = store.sets.sip.regular.calibrationId;
    const engine = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE);
    const sequence = [
      { score: 30, core: 0.30, price: 100 },
      { score: 32, core: 0.30, price: 100.1 },
      { score: 50, core: 0.55, price: 100.4 },
      { score: 55, core: 0.55, price: 100.6 },
      { score: 68, core: 0.72, price: 100.8 },
      { score: 75, core: 0.72, price: 101.0 },
      { score: 82, core: 0.75, price: 101.2 },
    ];
    const frames = sequence.map((row, index) => engine.processMinute([
      observation({ at: index * minute, calibrationId, ...row }),
    ]));
    expect(frames[1].rows[0].transition).toMatchObject({ from: "LOW_PRIORITY", to: "WATCHING" });
    expect(frames[3].rows[0].transition).toMatchObject({ from: "WATCHING", to: "EMERGING" });
    expect(frames[5].rows[0].transition).toMatchObject({ from: "EMERGING", to: "IN_PLAY" });
    const final = frames.at(-1)!;
    expect(final.rows[0].episode).toMatchObject({ startedAt: 0, priceAtStart: 100, state: "active" });
    expect(final.rows[0].freshness?.freshness).toBe("Developing");
    expect(final.lists.inPlay.map((row) => row.symbol)).toEqual(["AAOI"]);
    expect(final).toMatchObject({ provisional: true, conclusionsAllowed: false });
  });

  it("preserves an existing episode and records the 09:30 sparse-to-dense marker", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    const premarket = store.sets.sip.premarket_final.calibrationId;
    const regular = store.sets.sip.regular.calibrationId;
    const engine = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE);
    engine.processMinute([observation({ at: 0, score: 30, core: 0.30, calibrationId: premarket, subWindow: "premarket_final", mode: "sparse" })]);
    const qualified = engine.processMinute([observation({ at: minute, score: 32, core: 0.30, calibrationId: premarket, subWindow: "premarket_final", mode: "sparse" })]);
    const episodeId = qualified.rows[0].episode?.episodeId;
    const atOpen = engine.processMinute([observation({ at: 2 * minute, score: 70, core: 0.35, calibrationId: regular, subWindow: "regular", mode: "dense" })]);
    expect(atOpen.rows[0].velocity.scoreDelta1m).toBeNull();
    expect(atOpen.rows[0].velocity.velocityEventsSuppressed).toBe(true);
    expect(atOpen.rows[0].episode?.episodeId).toBe(episodeId);
    expect(atOpen.rows[0].episode?.modeTransitions).toHaveLength(1);
    expect(atOpen.rows[0].episode?.modeTransitions[0]).toMatchObject({ from: "sparse", to: "dense" });
  });

  it("can say nothing on a quiet frame", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    const engine = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE);
    const frame = engine.processMinute([observation({
      at: 0, score: 8.3, core: 0.083, calibrationId: store.sets.sip.regular.calibrationId,
    })]);
    expect(frame.rows[0].state).toBe("LOW_PRIORITY");
    expect(frame.lists.inPlay).toHaveLength(0);
  });

  it("does not carry a 06:00 session pullback into a fresh 14:00 episode", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    const calibrationId = store.sets.sip.regular.calibrationId;
    const engine = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE);
    const at1400 = 14 * 60 * minute;
    engine.processMinute([observation({
      at: at1400,
      score: 30,
      core: 0.30,
      calibrationId,
      pullbackObserved: true,
      consecutiveExpansionBars: 0,
    })]);
    const qualified = engine.processMinute([observation({
      at: at1400 + minute,
      score: 32,
      core: 0.30,
      calibrationId,
      price: 100.1,
      pullbackObserved: true,
      consecutiveExpansionBars: 0,
    })]);
    expect(qualified.rows[0].episode).not.toBeNull();
    expect(qualified.rows[0].freshness).toMatchObject({
      freshness: "Fresh",
      pullbackObserved: false,
    });
  });
  it("uses rolling-median core only for state while velocity and display remain raw", () => {
    const store = createPendingFeedAwareThresholdStore(3);
    const calibrationId = store.sets.sip.regular.calibrationId;
    const engine = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE, {
      ...DEFAULT_ATTENTION_A3_REPLAY_CONFIG,
      stateSmoothingMinutes: 3,
    });
    engine.processMinute([observation({ at: 0, score: 20, core: 0.10, calibrationId })]);
    engine.processMinute([observation({ at: minute, score: 80, core: 0.90, calibrationId })]);
    const frame = engine.processMinute([observation({ at: 2 * minute, score: 20, core: 0.10, calibrationId })]);
    expect(frame.rows[0].coreSmoothed).toBeCloseTo(0.10, 8);
    expect(frame.rows[0].point.score).toBe(20);
    expect(frame.rows[0].velocity.scoreDelta1m).toBe(-60);
    expect(frame.rows[0].velocity.coreDelta1m).toBeCloseTo(-0.80, 8);
  });
});
