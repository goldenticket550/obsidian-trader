import { describe, expect, it } from "vitest";
import {
  updateAttentionHistory,
  type AttentionHistoryObservation,
  type AttentionHistoryState,
} from "@/lib/attention/attentionHistory";
import { computeAttentionVelocity } from "@/lib/attention/attentionVelocity";

const minute = 60_000;

function observation(symbol: string, at: number, score: number, overrides: Partial<AttentionHistoryObservation> = {}): AttentionHistoryObservation {
  return {
    symbol,
    at,
    score,
    core: score / 100,
    feedMode: "sip",
    subWindow: "regular",
    calibrationId: "regular-v1",
    participationBaselineMode: "dense",
    participationInput: score / 10,
    participationInputKind: "z",
    displacementZ: score / 20,
    idiosyncrasyZ: score / 25,
    price: 100,
    atr: 2,
    vwap: 100,
    ema9: 100,
    consecutiveExpansionBars: 0,
    pullbackObserved: false,
    priceLostVwap: false,
    dataQualityState: "ok",
    provisional: true,
    ...overrides,
  };
}

describe("A3 score/rank history and attention velocity", () => {
  it("keeps rank as display context while a large rank jump remains a tiny score delta", () => {
    let history: AttentionHistoryState | null = null;
    const first = updateAttentionHistory(history, [
      observation("AAA", 0, 10), observation("BBB", 0, 10.1), observation("CCC", 0, 10.2),
    ]);
    history = first.state;
    expect(first.frame.find((row) => row.symbol === "AAA")?.rank).toBe(3);
    const second = updateAttentionHistory(history, [
      observation("AAA", minute, 10.3), observation("BBB", minute, 10.2), observation("CCC", minute, 10.1),
    ]);
    const aaa = second.frame.find((row) => row.symbol === "AAA")!;
    expect(aaa.rank).toBe(1);
    const velocity = computeAttentionVelocity(second.state.bySymbol.AAA);
    expect(velocity.scoreDelta1m).toBeCloseTo(0.3);
    expect(velocity).not.toHaveProperty("rankDelta");
  });

  it("computes 1m/3m/5m score and percentile deltas plus rolling z-delta", () => {
    let history: AttentionHistoryState | null = null;
    for (let index = 0; index <= 5; index += 1) {
      history = updateAttentionHistory(history, [observation("AAA", index * minute, 10 + index * 2, {
        participationInput: index * 0.5,
        displacementZ: index * 0.5,
        idiosyncrasyZ: index * 0.5,
      })]).state;
    }
    const velocity = computeAttentionVelocity(history!.bySymbol.AAA);
    expect(velocity.scoreDelta1m).toBe(2);
    expect(velocity.scoreDelta3m).toBe(6);
    expect(velocity.scoreDelta5m).toBe(10);
    expect(velocity.rollingZDelta5m).toBe(2.5);
    expect(velocity.scoreVelocityPerMinute).toBe(2);
  });

  it("resets every delta at a participation mode change and computes only post-transition samples", () => {
    let history: AttentionHistoryState | null = null;
    history = updateAttentionHistory(history, [observation("AAA", 0, 20, { participationBaselineMode: "sparse", participationInputKind: "surprise_bits" })]).state;
    history = updateAttentionHistory(history, [observation("AAA", minute, 24, { participationBaselineMode: "sparse", participationInputKind: "surprise_bits" })]).state;
    history = updateAttentionHistory(history, [observation("AAA", 2 * minute, 70, { participationBaselineMode: "dense" })]).state;
    const transition = computeAttentionVelocity(history.bySymbol.AAA, 5 * minute);
    expect(transition).toMatchObject({
      scoreDelta1m: null,
      scoreDelta3m: null,
      scoreDelta5m: null,
      rollingZDelta5m: null,
      velocityEventsSuppressed: true,
      measurementResetReason: "participation_mode_changed",
    });
    expect(transition.modeTransition).toMatchObject({ from: "sparse", to: "dense", at: 2 * minute });
    history = updateAttentionHistory(history, [observation("AAA", 3 * minute, 72, { participationBaselineMode: "dense" })]).state;
    const after = computeAttentionVelocity(history.bySymbol.AAA, 5 * minute);
    expect(after.scoreDelta1m).toBe(2);
    expect(after.scoreDelta3m).toBeNull();
    expect(after.velocityEventsSuppressed).toBe(true);
    expect(after.modeTransition).toBeNull();
    expect(after.suppressVelocityEventsUntil).toBe(7 * minute);
    for (let index = 4; index <= 7; index += 1) {
      history = updateAttentionHistory(history, [observation("AAA", index * minute, 72 + (index - 3) * 2, { participationBaselineMode: "dense" })]).state;
    }
    const released = computeAttentionVelocity(history.bySymbol.AAA, 5 * minute);
    expect(released.modeTransition).toBeNull();
    expect(released.suppressVelocityEventsUntil).toBe(7 * minute);
    expect(released.velocityEventsSuppressed).toBe(false);
  });

  it("retains approximately 120 minutes and drops older samples", () => {
    let history: AttentionHistoryState | null = null;
    for (let index = 0; index <= 121; index += 1) {
      history = updateAttentionHistory(history, [observation("AAA", index * minute, 10)]).state;
    }
    expect(history!.bySymbol.AAA).toHaveLength(121);
    expect(history!.bySymbol.AAA[0].at).toBe(minute);
  });
});
