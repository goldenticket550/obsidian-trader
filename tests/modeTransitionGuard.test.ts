import { describe, expect, it } from "vitest";
import {
  compareAttentionScores,
  recordEpisodeModeTransition,
  updateModeAwareVelocity,
} from "@/lib/replay/modeTransitionGuard";

const minute = 60_000;

describe("mode-transition guard", () => {
  it("keeps the score visible, resets velocity, and suppresses velocity events", () => {
    const initial = updateModeAwareVelocity(null, { at: 0, score: 25, participationBaselineMode: "sparse" });
    const beforeOpen = updateModeAwareVelocity(initial.state, { at: 9 * minute, score: 35, participationBaselineMode: "sparse" });
    expect(beforeOpen.velocityPerMinute).toBeCloseTo(10 / 9);

    const atOpen = updateModeAwareVelocity(beforeOpen.state, { at: 10 * minute, score: 80, participationBaselineMode: "dense" });
    expect(atOpen.score.score).toBe(80);
    expect(atOpen.velocityPerMinute).toBeNull();
    expect(atOpen.velocityEventsSuppressed).toBe(true);
    expect(atOpen.state.samples).toHaveLength(1);
    expect(atOpen.modeTransition).toMatchObject({ from: "sparse", to: "dense", at: 10 * minute });
  });

  it("computes velocity only from post-transition samples and releases after the guard", () => {
    const sparse = updateModeAwareVelocity(null, { at: 0, score: 30, participationBaselineMode: "sparse" });
    const transition = updateModeAwareVelocity(sparse.state, { at: minute, score: 70, participationBaselineMode: "dense" }, { guardMs: 5 * minute });
    const guarded = updateModeAwareVelocity(transition.state, { at: 3 * minute, score: 74, participationBaselineMode: "dense" }, { guardMs: 5 * minute });
    expect(guarded.velocityPerMinute).toBe(2);
    expect(guarded.velocityEventsSuppressed).toBe(true);
    const released = updateModeAwareVelocity(guarded.state, { at: 6 * minute, score: 79, participationBaselineMode: "dense" }, { guardMs: 5 * minute });
    expect(released.velocityPerMinute).toBeCloseTo(9 / 5);
    expect(released.velocityEventsSuppressed).toBe(false);
  });

  it("forbids cross-mode score comparison unless explicitly opted in", () => {
    const sparse = { at: 0, score: 30, participationBaselineMode: "sparse" as const };
    const dense = { at: minute, score: 70, participationBaselineMode: "dense" as const };
    expect(() => compareAttentionScores(sparse, dense)).toThrow(/explicit allowCrossMode/);
    expect(compareAttentionScores(sparse, dense, { allowCrossMode: true })).toBe(40);
  });

  it("preserves episode identity and records the transition marker", () => {
    const sparse = updateModeAwareVelocity(null, { at: 0, score: 30, participationBaselineMode: "sparse" });
    const transition = updateModeAwareVelocity(sparse.state, { at: minute, score: 70, participationBaselineMode: "dense" });
    const episode = recordEpisodeModeTransition({ episodeId: "ep-1", modeTransitions: [] }, transition.modeTransition!);
    expect(episode.episodeId).toBe("ep-1");
    expect(episode.modeTransitions).toEqual([transition.modeTransition]);
  });
});
