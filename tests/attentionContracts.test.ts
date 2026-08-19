import { describe, expect, it } from "vitest";
import { createAttentionAlertPayload, createAttentionScorePayload } from "@/lib/replay/attentionContracts";
import { routeParticipationBaseline } from "@/lib/replay/baselineModes";

describe("attention score and alert contracts", () => {
  it("carries participation mode, first activity, and limited history on every payload", () => {
    const participation = routeParticipationBaseline({ baselineMode: "dead", historicalVolumeBySession: [null], currentVolume: 1, currentPresent: true });
    const score = createAttentionScorePayload({ symbol: "AA", evaluatedAt: 1, score: 80, dataQualityState: "limited_history" }, participation);
    expect(score).toMatchObject({ participationBaselineMode: "dead", firstObservedActivity: true, participationDataQualityState: "dead_unexpected_activity", dataQualityState: "limited_history", limitedHistory: true });
  });

  it("blocks first-observed NOW IN PLAY without displacement confluence", () => {
    const participation = routeParticipationBaseline({ baselineMode: "dead", historicalVolumeBySession: [null], currentVolume: 1, currentPresent: true });
    const score = createAttentionScorePayload({ symbol: "AA", evaluatedAt: 1, score: 80, dataQualityState: "ok" }, participation);
    expect(() => createAttentionAlertPayload(score, participation, { eventType: "new_in_play", displacementConfluence: false, velocityEventsSuppressed: false, modeTransition: null })).toThrow(/displacement confluence/);
    expect(createAttentionAlertPayload(score, participation, { eventType: "new_in_play", displacementConfluence: true, velocityEventsSuppressed: false, modeTransition: null }).firstObservedActivity).toBe(true);
  });

  it("blocks velocity-derived alerts during the transition guard", () => {
    const participation = routeParticipationBaseline({ baselineMode: "sparse", historicalVolumeBySession: [1, null], currentVolume: 2, currentPresent: true });
    const score = createAttentionScorePayload({ symbol: "AA", evaluatedAt: 1, score: 40, dataQualityState: "ok" }, participation);
    expect(() => createAttentionAlertPayload(score, participation, { eventType: "acceleration", displacementConfluence: true, velocityEventsSuppressed: true, modeTransition: null })).toThrow(/suppressed/);
  });
});
