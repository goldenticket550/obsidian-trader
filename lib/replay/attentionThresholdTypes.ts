export const ATTENTION_SUB_WINDOWS = [
  "premarket_early",
  "premarket_core",
  "premarket_final",
  "regular",
  "after_hours_core",
  "after_hours_late",
] as const;

export type AttentionSubWindow = typeof ATTENTION_SUB_WINDOWS[number];
export type ThresholdCalibrationStatus = "pending_calibration" | "calibrated" | "unavailable_by_construction";

export interface AttentionThresholdValues {
  watchingEnterCore: number | null;
  watchingExitCore: number | null;
  emergingEnterCore: number | null;
  emergingExitCore: number | null;
  inPlayEnterCore: number | null;
  inPlayExitCore: number | null;
  newInPlayVelocityPerMinute: number | null;
  enterPersistenceMinutes: number | null;
  exitPersistenceMinutes: number | null;
}

export type ResolvedAttentionThresholdValues = {
  [K in keyof AttentionThresholdValues]: number;
};
