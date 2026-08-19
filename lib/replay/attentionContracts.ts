import type { AttentionDataQualityState } from "@/lib/attention/dataQuality";
import type { BaselineMode, ParticipationBaselineSignal, ParticipationDataQualityState } from "./baselineModes";
import { participationCanDriveNewInPlay } from "./baselineModes";
import type { ModeTransitionMarker } from "./modeTransitionGuard";

export interface AttentionScorePayload {
  symbol: string;
  evaluatedAt: number;
  score: number;
  participationBaselineMode: BaselineMode;
  participationSignalKind: ParticipationBaselineSignal["signalKind"];
  participationDataQualityState: ParticipationDataQualityState;
  firstObservedActivity: boolean;
  dataQualityState: AttentionDataQualityState;
  limitedHistory: boolean;
}

export interface AttentionAlertPayload extends AttentionScorePayload {
  eventType: "new_in_play" | "acceleration" | "state_change";
  displacementConfluence: boolean;
  velocityEventsSuppressed: boolean;
  modeTransition: ModeTransitionMarker | null;
}

export function createAttentionScorePayload(
  input: Omit<AttentionScorePayload, "participationBaselineMode" | "participationSignalKind" | "participationDataQualityState" | "firstObservedActivity" | "limitedHistory">,
  participation: ParticipationBaselineSignal
): AttentionScorePayload {
  return {
    ...input,
    participationBaselineMode: participation.baselineMode,
    participationSignalKind: participation.signalKind,
    participationDataQualityState: participation.dataQualityState,
    firstObservedActivity: participation.firstObservedActivity,
    limitedHistory: input.dataQualityState === "limited_history",
  };
}

export function createAttentionAlertPayload(
  score: AttentionScorePayload,
  participation: ParticipationBaselineSignal,
  input: Pick<AttentionAlertPayload, "eventType" | "displacementConfluence" | "velocityEventsSuppressed" | "modeTransition">
): AttentionAlertPayload {
  if ((input.eventType === "new_in_play" || input.eventType === "acceleration") && input.velocityEventsSuppressed) {
    throw new Error("Velocity-derived events are suppressed during a participation mode-transition guard.");
  }
  if (input.eventType === "new_in_play" && !participationCanDriveNewInPlay(participation, input.displacementConfluence)) {
    throw new Error("First-observed participation cannot drive NEW IN PLAY without displacement confluence.");
  }
  if (score.participationBaselineMode !== participation.baselineMode) {
    throw new Error("Alert participation mode must match its emitted score.");
  }
  return { ...score, ...input };
}
