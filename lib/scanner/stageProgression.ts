import type { SetupStage } from "@/types/setup";

/**
 * Maps the scanner's ten detailed SetupStage values onto the five-stage
 * visual progression, as a pure tested function rather than logic smeared
 * through UI markup.
 *
 * The one rule worth stating explicitly: SCORE QUALIFIED is driven by the
 * actual numeric score clearing the configured threshold — NOT by the
 * stage reaching "confirmed". Those are different claims, and conflating
 * them would let the final pip light up on a setup that never actually
 * met the user's own score bar.
 */
export type VisualStage = "sweep" | "structure_shift" | "ema_reclaim" | "fvg" | "score_qualified";

export type StageState = "completed" | "current" | "pending" | "invalidated";

export const VISUAL_STAGES: { key: VisualStage; label: string }[] = [
  { key: "sweep", label: "Sweep" },
  { key: "structure_shift", label: "Structure shift" },
  { key: "ema_reclaim", label: "EMA reclaim" },
  { key: "fvg", label: "FVG" },
  { key: "score_qualified", label: "Score qualified" },
];

/**
 * How far along the five-stage track a given SetupStage reaches.
 * 0 = hasn't reached Sweep yet. Early stages (decline, recovery,
 * consecutive bullish) deliberately leave Sweep pending — they are
 * precursors, not the sweep itself.
 */
const REACH_BY_STAGE: Record<SetupStage, number> = {
  none: 0,
  intraday_decline: 0,
  recovery_from_low: 0,
  consecutive_bullish: 0,
  liquidity_sweep: 1,
  structure_shift: 2,
  ema_reclaim: 3,
  fair_value_gap: 4,
  gap_proximity: 4,
  confirmed: 4,
};

export function stageReach(stage: SetupStage): number {
  return REACH_BY_STAGE[stage] ?? 0;
}

export interface VisualStageNode {
  key: VisualStage;
  label: string;
  state: StageState;
}

/**
 * @param stage    the scanner's current SetupStage
 * @param score    the setup's actual 0-10 score
 * @param scoreThreshold  the user's configured minimum (risk settings)
 * @param invalidated  whether any condition is currently invalidated
 */
export function buildStageProgression(
  stage: SetupStage,
  score: number,
  scoreThreshold: number,
  invalidated: boolean
): VisualStageNode[] {
  const reach = stageReach(stage);
  const scoreQualified = score >= scoreThreshold;

  return VISUAL_STAGES.map((visual, index) => {
    const position = index + 1; // 1-based, matching REACH_BY_STAGE

    // The final pip answers a numeric question, not a stage question.
    if (visual.key === "score_qualified") {
      if (invalidated) return { ...visual, state: "invalidated" as StageState };
      return { ...visual, state: scoreQualified ? "completed" : "pending" };
    }

    if (invalidated && position === reach) {
      return { ...visual, state: "invalidated" as StageState };
    }
    if (position < reach) return { ...visual, state: "completed" as StageState };
    if (position === reach) return { ...visual, state: "current" as StageState };
    return { ...visual, state: "pending" as StageState };
  });
}
