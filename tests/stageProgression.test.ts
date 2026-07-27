import { describe, it, expect } from "vitest";
import {
  buildStageProgression,
  stageReach,
  VISUAL_STAGES,
} from "@/lib/scanner/stageProgression";
import type { SetupStage } from "@/types/setup";

const ALL_STAGES: SetupStage[] = [
  "none",
  "intraday_decline",
  "recovery_from_low",
  "consecutive_bullish",
  "liquidity_sweep",
  "structure_shift",
  "ema_reclaim",
  "fair_value_gap",
  "gap_proximity",
  "confirmed",
];

function statesFor(stage: SetupStage, score = 0, threshold = 7, invalidated = false) {
  return buildStageProgression(stage, score, threshold, invalidated).map((n) => n.state);
}

describe("stageReach", () => {
  it("covers every SetupStage with no undefined gaps", () => {
    for (const stage of ALL_STAGES) {
      expect(Number.isInteger(stageReach(stage))).toBe(true);
    }
  });

  it("leaves Sweep unreached for the precursor stages", () => {
    // Decline / recovery / consecutive-bullish come BEFORE a sweep. They
    // must not light the first pip.
    expect(stageReach("none")).toBe(0);
    expect(stageReach("intraday_decline")).toBe(0);
    expect(stageReach("recovery_from_low")).toBe(0);
    expect(stageReach("consecutive_bullish")).toBe(0);
  });

  it("advances through sweep, structure shift, and ema reclaim in order", () => {
    expect(stageReach("liquidity_sweep")).toBe(1);
    expect(stageReach("structure_shift")).toBe(2);
    expect(stageReach("ema_reclaim")).toBe(3);
  });

  it("treats all three gap-related stages as reaching FVG", () => {
    expect(stageReach("fair_value_gap")).toBe(4);
    expect(stageReach("gap_proximity")).toBe(4);
    expect(stageReach("confirmed")).toBe(4);
  });
});

describe("buildStageProgression", () => {
  it("always returns exactly the five visual stages in order", () => {
    const nodes = buildStageProgression("none", 0, 7, false);
    expect(nodes.map((n) => n.key)).toEqual(VISUAL_STAGES.map((v) => v.key));
  });

  it("marks everything pending for a setup that has not swept", () => {
    expect(statesFor("intraday_decline")).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("marks the reached stage current and earlier ones completed", () => {
    expect(statesFor("ema_reclaim")).toEqual([
      "completed",
      "completed",
      "current",
      "pending",
      "pending",
    ]);
  });

  it("does NOT complete Score qualified merely because the stage is confirmed", () => {
    // The whole point of the separate rule: stage says the pattern formed,
    // the score says whether it cleared the user's own bar.
    const states = statesFor("confirmed", 5.0, 7);
    expect(states[4]).toBe("pending");
  });

  it("completes Score qualified when the score actually meets the threshold", () => {
    const states = statesFor("confirmed", 7.0, 7);
    expect(states[4]).toBe("completed");
  });

  it("completes Score qualified exactly at the threshold boundary", () => {
    expect(statesFor("confirmed", 6.99, 7)[4]).toBe("pending");
    expect(statesFor("confirmed", 7.0, 7)[4]).toBe("completed");
  });

  it("can qualify on score even from an earlier stage", () => {
    // Score is an independent axis; it isn't gated behind reaching FVG.
    expect(statesFor("liquidity_sweep", 9, 7)[4]).toBe("completed");
  });

  it("marks the current stage invalidated when a condition is invalidated", () => {
    const states = statesFor("structure_shift", 3, 7, true);
    expect(states[1]).toBe("invalidated");
    expect(states[0]).toBe("completed");
  });

  it("marks Score qualified invalidated too, regardless of the score", () => {
    const states = statesFor("confirmed", 9.5, 7, true);
    expect(states[4]).toBe("invalidated");
  });

  it("produces a valid state for every SetupStage without throwing", () => {
    for (const stage of ALL_STAGES) {
      const nodes = buildStageProgression(stage, 5, 7, false);
      expect(nodes).toHaveLength(5);
      for (const node of nodes) {
        expect(["completed", "current", "pending", "invalidated"]).toContain(node.state);
      }
    }
  });
});
