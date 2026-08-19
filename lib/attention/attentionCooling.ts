import type { AttentionHistoryPoint } from "./attentionHistory";
import type { AttentionVelocity } from "./attentionVelocity";

export interface AttentionCoolingConfig {
  accelerationVelocityPerMinute: number;
  minimumParticipationRise: number;
  maximumDisplacementFollowZ: number;
  attentionCollapsePoints: number;
  coreCollapse: number;
  failureWindowMinutes: number;
}

export const DEFAULT_ATTENTION_COOLING_CONFIG: AttentionCoolingConfig = {
  accelerationVelocityPerMinute: 2,
  minimumParticipationRise: 0.25,
  maximumDisplacementFollowZ: 0.15,
  attentionCollapsePoints: 10,
  coreCollapse: 0.10,
  failureWindowMinutes: 5,
};

export interface AttentionCoolingMemory {
  armedAt: number | null;
  displacementZAtArm: number | null;
  participationRoseDuringAcceleration: boolean;
  accelerationFailedAt: number | null;
}

export interface AttentionCoolingResult {
  memory: AttentionCoolingMemory;
  accelerationFailed: boolean;
  classification: "ACCELERATION_FAILED" | null;
  evidence: {
    velocitySpiked: boolean;
    participationRose: boolean;
    displacementFailedToFollow: boolean;
    priceLostVwap: boolean;
    attentionCollapsed: boolean;
  };
}

export function updateAttentionCooling(input: {
  previousMemory: AttentionCoolingMemory | null;
  previousPoint: AttentionHistoryPoint | null;
  point: AttentionHistoryPoint;
  velocity: AttentionVelocity;
  config?: AttentionCoolingConfig;
}): AttentionCoolingResult {
  const config = input.config ?? DEFAULT_ATTENTION_COOLING_CONFIG;
  if (Object.values(config).some((value) => !Number.isFinite(value) || value < 0) || config.failureWindowMinutes === 0) {
    throw new Error("Attention cooling configuration requires finite non-negative values and a positive failure window.");
  }
  const memory = input.previousMemory ?? {
    armedAt: null,
    displacementZAtArm: null,
    participationRoseDuringAcceleration: false,
    accelerationFailedAt: null,
  };
  const comparableParticipation = input.previousPoint !== null
    && input.previousPoint.participationBaselineMode === input.point.participationBaselineMode
    && input.previousPoint.participationInputKind === input.point.participationInputKind
    && input.previousPoint.participationInput !== null
    && input.point.participationInput !== null;
  const participationRose = comparableParticipation
    && input.point.participationInput! - input.previousPoint!.participationInput! >= config.minimumParticipationRise;
  const velocitySpiked = !input.velocity.velocityEventsSuppressed
    && (input.velocity.scoreVelocityPerMinute ?? -Infinity) >= config.accelerationVelocityPerMinute;
  const armedNow = velocitySpiked && participationRose;
  const previousArmActive = memory.armedAt !== null
    && input.point.at - memory.armedAt <= config.failureWindowMinutes * 60_000;
  const armedAt = armedNow ? input.point.at : previousArmActive ? memory.armedAt : null;
  const displacementZAtArm = armedNow ? input.point.displacementZ : previousArmActive ? memory.displacementZAtArm : null;
  const participationRoseDuringAcceleration = armedNow || (previousArmActive && memory.participationRoseDuringAcceleration);
  const displacementFailedToFollow = armedAt !== null
    && displacementZAtArm !== null
    && input.point.displacementZ !== null
    && input.point.displacementZ - displacementZAtArm <= config.maximumDisplacementFollowZ;
  const attentionCollapsed = input.previousPoint !== null
    && (input.point.score - input.previousPoint.score <= -config.attentionCollapsePoints
      || input.point.core - input.previousPoint.core <= -config.coreCollapse);
  const failedNow = memory.accelerationFailedAt === null
    && armedAt !== null
    && participationRoseDuringAcceleration
    && displacementFailedToFollow
    && input.point.priceLostVwap
    && attentionCollapsed;
  return {
    memory: {
      armedAt,
      displacementZAtArm,
      participationRoseDuringAcceleration,
      accelerationFailedAt: failedNow ? input.point.at : memory.accelerationFailedAt,
    },
    accelerationFailed: failedNow,
    classification: failedNow ? "ACCELERATION_FAILED" : null,
    evidence: {
      velocitySpiked,
      participationRose,
      displacementFailedToFollow,
      priceLostVwap: input.point.priceLostVwap,
      attentionCollapsed,
    },
  };
}
