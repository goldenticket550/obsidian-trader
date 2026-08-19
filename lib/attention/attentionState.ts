import type { AttentionFeedMode } from "./attentionScore";
import type { AttentionSubWindow, ResolvedAttentionThresholdValues } from "@/lib/replay/attentionThresholdTypes";

export const ATTENTION_STATES = ["LOW_PRIORITY", "WATCHING", "EMERGING", "IN_PLAY", "COOLING"] as const;
export type AttentionState = typeof ATTENTION_STATES[number];
export type PendingAttentionTransition = "none" | "promoting" | "exiting";

export interface AttentionThresholdRuns {
  watchingEnter: number;
  emergingEnter: number;
  inPlayEnter: number;
  watchingExit: number;
  emergingExit: number;
  inPlayExit: number;
}

export interface AttentionStateMemory {
  state: AttentionState;
  stateEnteredAt: number;
  /** Null only for LOW_PRIORITY and COOLING, which do not have an enter threshold. */
  stateEnterThresholdMetAt: number | null;
  candidateState: AttentionState | null;
  candidateSince: number | null;
  candidateObservations: number;
  pendingTransition: PendingAttentionTransition;
  pendingTransitionMinutes: number;
  thresholdRuns: AttentionThresholdRuns;
  lastEvaluatedAt: number;
}

export interface AttentionStateTransition {
  at: number;
  from: AttentionState;
  to: AttentionState;
  persistedMinutes: number;
  reason: string;
}

export interface AttentionStateUpdate {
  memory: AttentionStateMemory;
  transition: AttentionStateTransition | null;
}

const stagedLevel = (state: AttentionState): number | null => {
  if (state === "LOW_PRIORITY") return 0;
  if (state === "WATCHING") return 1;
  if (state === "EMERGING") return 2;
  if (state === "IN_PLAY") return 3;
  return null;
};

/** COOLING preserves at least EMERGING membership for I2, but is excluded from I3/I4' ladder checks. */
const qualificationLevel = (state: AttentionState): number => state === "COOLING" ? 2 : stagedLevel(state)!;

function enterThreshold(state: AttentionState, thresholds: ResolvedAttentionThresholdValues): number | null {
  if (state === "WATCHING") return thresholds.watchingEnterCore;
  if (state === "EMERGING") return thresholds.emergingEnterCore;
  if (state === "IN_PLAY") return thresholds.inPlayEnterCore;
  return null;
}

function promotionTarget(core: number, thresholds: ResolvedAttentionThresholdValues): AttentionState | null {
  if (core >= thresholds.inPlayEnterCore) return "IN_PLAY";
  if (core >= thresholds.emergingEnterCore) return "EMERGING";
  if (core >= thresholds.watchingEnterCore) return "WATCHING";
  return null;
}

function desiredState(
  current: AttentionState,
  core: number,
  thresholds: ResolvedAttentionThresholdValues,
  accelerationFailed: boolean,
): { state: AttentionState; reason: string } {
  if (accelerationFailed && (current === "IN_PLAY" || current === "EMERGING" || current === "COOLING")) {
    return { state: "COOLING", reason: "acceleration_failed" };
  }
  const promotion = promotionTarget(core, thresholds);
  if (current === "LOW_PRIORITY") {
    return promotion ? { state: promotion, reason: `${promotion.toLowerCase()}_enter_core` } : { state: current, reason: "below_watching_enter" };
  }
  if (current === "WATCHING") {
    if (promotion === "IN_PLAY" || promotion === "EMERGING") return { state: promotion, reason: `${promotion.toLowerCase()}_enter_core` };
    return core < thresholds.watchingExitCore
      ? { state: "LOW_PRIORITY", reason: "watching_exit_core" }
      : { state: current, reason: "watching_hysteresis" };
  }
  if (current === "EMERGING") {
    if (promotion === "IN_PLAY") return { state: promotion, reason: "in_play_enter_core" };
    if (core < thresholds.emergingExitCore) {
      return promotion === "WATCHING"
        ? { state: "WATCHING", reason: "emerging_exit_core" }
        : { state: "LOW_PRIORITY", reason: "emerging_exit_below_watching_enter" };
    }
    return { state: current, reason: "emerging_hysteresis" };
  }
  if (current === "IN_PLAY") {
    return core < thresholds.inPlayExitCore
      ? { state: "COOLING", reason: "in_play_exit_core" }
      : { state: current, reason: "in_play_hysteresis" };
  }
  if (promotion === "IN_PLAY" || promotion === "EMERGING") {
    return { state: promotion, reason: "cooling_recovered" };
  }
  if (core < thresholds.emergingExitCore) {
    return promotion === "WATCHING"
      ? { state: "WATCHING", reason: "cooling_deescalated" }
      : { state: "LOW_PRIORITY", reason: "cooling_below_watching_enter" };
  }
  return { state: current, reason: "cooling_hysteresis" };
}

function nextRuns(
  previous: AttentionThresholdRuns | null,
  core: number,
  thresholds: ResolvedAttentionThresholdValues,
  consecutive: boolean,
): AttentionThresholdRuns {
  const count = (met: boolean, prior: number) => met ? (consecutive ? prior + 1 : 1) : 0;
  const p = previous ?? { watchingEnter: 0, emergingEnter: 0, inPlayEnter: 0, watchingExit: 0, emergingExit: 0, inPlayExit: 0 };
  return {
    watchingEnter: count(core >= thresholds.watchingEnterCore, p.watchingEnter),
    emergingEnter: count(core >= thresholds.emergingEnterCore, p.emergingEnter),
    inPlayEnter: count(core >= thresholds.inPlayEnterCore, p.inPlayEnter),
    watchingExit: count(core < thresholds.watchingExitCore, p.watchingExit),
    emergingExit: count(core < thresholds.emergingExitCore, p.emergingExit),
    inPlayExit: count(core < thresholds.inPlayExitCore, p.inPlayExit),
  };
}

function pendingKind(from: AttentionState, to: AttentionState): PendingAttentionTransition {
  if (from === to) return "none";
  if (to === "COOLING") return "exiting";
  const fromLevel = qualificationLevel(from);
  const toLevel = qualificationLevel(to);
  return toLevel > fromLevel ? "promoting" : "exiting";
}

function settledTarget(
  current: AttentionState,
  core: number,
  thresholds: ResolvedAttentionThresholdValues,
  runs: AttentionThresholdRuns,
  enterPersistenceMinutes: number,
  exitPersistenceMinutes: number,
): { state: AttentionState; persistedMinutes: number; reason: string } | null {
  const level = qualificationLevel(current);
  if (runs.inPlayEnter >= enterPersistenceMinutes && current !== "IN_PLAY") {
    return { state: "IN_PLAY", persistedMinutes: runs.inPlayEnter, reason: "in_play_enter_settled" };
  }
  if (runs.emergingEnter >= enterPersistenceMinutes && level < 2) {
    return { state: "EMERGING", persistedMinutes: runs.emergingEnter, reason: "emerging_enter_settled" };
  }
  if (runs.watchingEnter >= enterPersistenceMinutes && level < 1) {
    return { state: "WATCHING", persistedMinutes: runs.watchingEnter, reason: "watching_enter_settled" };
  }
  if (current === "IN_PLAY" && runs.inPlayExit >= exitPersistenceMinutes) {
    return { state: "COOLING", persistedMinutes: runs.inPlayExit, reason: "in_play_exit_settled" };
  }
  if ((current === "EMERGING" || current === "COOLING") && runs.emergingExit >= exitPersistenceMinutes) {
    const target = core >= thresholds.watchingEnterCore && runs.watchingEnter >= enterPersistenceMinutes ? "WATCHING" : "LOW_PRIORITY";
    return { state: target, persistedMinutes: runs.emergingExit, reason: "emerging_exit_settled" };
  }
  if (current === "WATCHING" && runs.watchingExit >= exitPersistenceMinutes) {
    return { state: "LOW_PRIORITY", persistedMinutes: runs.watchingExit, reason: "watching_exit_settled" };
  }
  return null;
}

/** State transitions use core and persistence only; raw display rank is not accepted. */
export function updateAttentionState(input: {
  previous: AttentionStateMemory | null;
  at: number;
  core: number;
  thresholds: ResolvedAttentionThresholdValues;
  persistenceMinutes?: number;
  enterPersistenceMinutes?: number;
  exitPersistenceMinutes?: number;
  accelerationFailed?: boolean;
}): AttentionStateUpdate {
  const enterPersistenceMinutes = input.enterPersistenceMinutes ?? input.persistenceMinutes ?? 2;
  const exitPersistenceMinutes = input.exitPersistenceMinutes ?? input.persistenceMinutes ?? 2;
  if (!Number.isInteger(enterPersistenceMinutes) || enterPersistenceMinutes < 2 || !Number.isInteger(exitPersistenceMinutes) || exitPersistenceMinutes < 2) {
    throw new Error("Attention state enter/exit persistence must each be at least two minutes.");
  }
  if (!Number.isFinite(input.at) || !Number.isFinite(input.core) || input.core < 0 || input.core > 1) {
    throw new Error("Attention state requires finite timestamp and core in [0,1].");
  }
  const consecutive = input.previous === null || input.at - input.previous.lastEvaluatedAt <= 60_000;
  const runs = nextRuns(input.previous?.thresholdRuns ?? null, input.core, input.thresholds, consecutive);
  if (!input.previous) {
    const initialDesired = desiredState("LOW_PRIORITY", input.core, input.thresholds, input.accelerationFailed ?? false);
    const pending = initialDesired.state === "LOW_PRIORITY" ? "none" : "promoting";
    return {
      memory: {
        state: "LOW_PRIORITY",
        stateEnteredAt: input.at,
        stateEnterThresholdMetAt: null,
        candidateState: initialDesired.state === "LOW_PRIORITY" ? null : initialDesired.state,
        candidateSince: initialDesired.state === "LOW_PRIORITY" ? null : input.at,
        candidateObservations: initialDesired.state === "LOW_PRIORITY" ? 0 : 1,
        pendingTransition: pending,
        pendingTransitionMinutes: pending === "none" ? 0 : 1,
        thresholdRuns: runs,
        lastEvaluatedAt: input.at,
      },
      transition: null,
    };
  }
  if (input.at <= input.previous.lastEvaluatedAt) throw new Error("Attention state evaluations must be strictly chronological.");
  const desired = desiredState(input.previous.state, input.core, input.thresholds, input.accelerationFailed ?? false);
  const settled = settledTarget(input.previous.state, input.core, input.thresholds, runs, enterPersistenceMinutes, exitPersistenceMinutes);
  if (settled && settled.state !== input.previous.state) {
    const postSettlementDesired = desiredState(settled.state, input.core, input.thresholds, input.accelerationFailed ?? false);
    const hasNextPending = postSettlementDesired.state !== settled.state;
    const nextPendingMinutes = !hasNextPending ? 0
      : postSettlementDesired.state === "IN_PLAY" ? runs.inPlayEnter
        : postSettlementDesired.state === "EMERGING" ? runs.emergingEnter
          : postSettlementDesired.state === "WATCHING" ? runs.watchingEnter
            : postSettlementDesired.state === "LOW_PRIORITY" ? runs.watchingExit
              : runs.inPlayExit;
    const nextPendingSince = hasNextPending ? input.at - Math.max(0, nextPendingMinutes - 1) * 60_000 : null;
    const transition: AttentionStateTransition = {
      at: input.at,
      from: input.previous.state,
      to: settled.state,
      persistedMinutes: settled.persistedMinutes,
      reason: settled.reason,
    };
    return {
      memory: {
        state: settled.state,
        stateEnteredAt: input.at,
        stateEnterThresholdMetAt: enterThreshold(settled.state, input.thresholds) === null ? null : input.at,
        candidateState: hasNextPending ? postSettlementDesired.state : null,
        candidateSince: nextPendingSince,
        candidateObservations: nextPendingMinutes,
        pendingTransition: hasNextPending ? pendingKind(settled.state, postSettlementDesired.state) : "none",
        pendingTransitionMinutes: nextPendingMinutes,
        thresholdRuns: runs,
        lastEvaluatedAt: input.at,
      },
      transition,
    };
  }
  if (desired.state === input.previous.state) {
    return {
      memory: {
        ...input.previous,
        candidateState: null,
        candidateSince: null,
        candidateObservations: 0,
        pendingTransition: "none",
        pendingTransitionMinutes: 0,
        thresholdRuns: runs,
        lastEvaluatedAt: input.at,
      },
      transition: null,
    };
  }
  const sameCandidate = consecutive && input.previous.candidateState === desired.state;
  const candidateSince = sameCandidate ? input.previous.candidateSince! : input.at;
  const candidateObservations = sameCandidate ? input.previous.candidateObservations + 1 : 1;
  const pendingTransition = pendingKind(input.previous.state, desired.state);
  const requiredPersistenceMinutes = pendingTransition === "promoting" ? enterPersistenceMinutes : exitPersistenceMinutes;
  if (candidateObservations < requiredPersistenceMinutes) {
    return {
      memory: {
        ...input.previous,
        candidateState: desired.state,
        candidateSince,
        candidateObservations,
        pendingTransition,
        pendingTransitionMinutes: candidateObservations,
        thresholdRuns: runs,
        lastEvaluatedAt: input.at,
      },
      transition: null,
    };
  }
  const transition: AttentionStateTransition = {
    at: input.at,
    from: input.previous.state,
    to: desired.state,
    persistedMinutes: candidateObservations,
    reason: desired.reason,
  };
  return {
    memory: {
      state: desired.state,
      stateEnteredAt: input.at,
      stateEnterThresholdMetAt: enterThreshold(desired.state, input.thresholds) === null ? null : input.at,
      candidateState: null,
      candidateSince: null,
      candidateObservations: 0,
      pendingTransition: "none",
      pendingTransitionMinutes: 0,
      thresholdRuns: runs,
      lastEvaluatedAt: input.at,
    },
    transition,
  };
}

export interface AttentionStateInvariantRow {
  symbol: string;
  feedMode: AttentionFeedMode;
  subWindow: AttentionSubWindow;
  core: number;
  memory: AttentionStateMemory;
  thresholds: ResolvedAttentionThresholdValues;
  persistenceMinutes?: number;
  enterPersistenceMinutes?: number;
  exitPersistenceMinutes?: number;
}

function easternMinute(at: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(at));
}

export function explainAttentionState(
  memory: AttentionStateMemory,
  core: number,
  thresholds: ResolvedAttentionThresholdValues,
): string {
  if (memory.pendingTransition !== "none" && memory.candidateState && memory.candidateSince !== null) {
    return `${memory.pendingTransition === "promoting" ? "promotion" : "exit"} pending toward ${memory.candidateState}; threshold condition held for ${memory.pendingTransitionMinutes} minute${memory.pendingTransitionMinutes === 1 ? "" : "s"} since ${easternMinute(memory.candidateSince)}`;
  }
  const since = easternMinute(memory.stateEnteredAt);
  if (memory.state === "LOW_PRIORITY") {
    return `held in LOW PRIORITY since ${since}; core ${core.toFixed(3)} is below WATCHING entry ${thresholds.watchingEnterCore.toFixed(3)}`;
  }
  if (memory.state === "WATCHING") {
    return `held in WATCHING since ${since}; core ${core.toFixed(3)} is above exit ${thresholds.watchingExitCore.toFixed(3)} and below EMERGING entry ${thresholds.emergingEnterCore.toFixed(3)}`;
  }
  if (memory.state === "EMERGING") {
    return `held in EMERGING since ${since}; core ${core.toFixed(3)} is above exit ${thresholds.emergingExitCore.toFixed(3)} and below IN PLAY entry ${thresholds.inPlayEnterCore.toFixed(3)}`;
  }
  if (memory.state === "IN_PLAY") {
    return `held in IN PLAY since ${since}; core ${core.toFixed(3)} remains above exit ${thresholds.inPlayExitCore.toFixed(3)}`;
  }
  return `held in COOLING since ${since}; deterioration memory is active`;
}

/** I1-I4': anti-divergence, settled transitions, and per-symbol occupancy bands. */
export function assertAttentionStateFrameInvariants(rows: readonly AttentionStateInvariantRow[]): void {
  for (const row of rows) {
    const { state, stateEnteredAt, stateEnterThresholdMetAt, thresholdRuns } = row.memory;
    const enterPersistenceMinutes = row.enterPersistenceMinutes ?? row.persistenceMinutes ?? 2;
    const exitPersistenceMinutes = row.exitPersistenceMinutes ?? row.persistenceMinutes ?? 2;
    const level = qualificationLevel(state);
    const orderedLevel = stagedLevel(state);
    if ((state === "WATCHING" || state === "EMERGING" || state === "IN_PLAY")
      && (stateEnterThresholdMetAt === null || stateEnterThresholdMetAt < stateEnteredAt)) {
      throw new Error(`I1 NO UNEARNED STATE violated by ${row.symbol}: ${state} has no enter-threshold evidence in its current occupancy.`);
    }
    if (thresholdRuns.watchingEnter >= enterPersistenceMinutes && level < 1) {
      throw new Error(`I2 SETTLED PROMOTION violated by ${row.symbol}: WATCHING enter persisted without promotion.`);
    }
    if (thresholdRuns.emergingEnter >= enterPersistenceMinutes && level < 2) {
      throw new Error(`I2 SETTLED PROMOTION violated by ${row.symbol}: EMERGING enter persisted without promotion (state=${state}, pending=${row.memory.pendingTransition}:${row.memory.pendingTransitionMinutes}, runs=${JSON.stringify(thresholdRuns)}).`);
    }
    if (thresholdRuns.inPlayEnter >= enterPersistenceMinutes && state !== "IN_PLAY") {
      throw new Error(`I2 SETTLED PROMOTION violated by ${row.symbol}: IN_PLAY enter persisted without promotion.`);
    }
    if (thresholdRuns.watchingExit >= exitPersistenceMinutes && orderedLevel !== null && orderedLevel >= 1) {
      throw new Error(`I3 SETTLED DEMOTION violated by ${row.symbol}: WATCHING exit persisted without demotion (state=${state}, pending=${row.memory.pendingTransition}:${row.memory.pendingTransitionMinutes}, runs=${JSON.stringify(thresholdRuns)}).`);
    }
    if (thresholdRuns.emergingExit >= exitPersistenceMinutes && orderedLevel !== null && orderedLevel >= 2) {
      throw new Error(`I3 SETTLED DEMOTION violated by ${row.symbol}: EMERGING exit persisted without demotion.`);
    }
    if (thresholdRuns.inPlayExit >= exitPersistenceMinutes && state === "IN_PLAY") {
      throw new Error(`I3 SETTLED DEMOTION violated by ${row.symbol}: IN_PLAY exit persisted without demotion.`);
    }
    if (row.memory.pendingTransition !== "none" || state === "COOLING") continue;
    const inBand = state === "LOW_PRIORITY"
      ? row.core < row.thresholds.watchingEnterCore
      : state === "WATCHING"
        ? row.core >= row.thresholds.watchingExitCore && row.core < row.thresholds.emergingEnterCore
        : state === "EMERGING"
          ? row.core >= row.thresholds.emergingExitCore && row.core < row.thresholds.inPlayEnterCore
          : row.core >= row.thresholds.inPlayExitCore;
    if (!inBand) {
      throw new Error(`I4' SETTLED OCCUPANCY BAND violated by ${row.symbol} in ${row.feedMode}|${row.subWindow}: state=${state}, core=${row.core.toFixed(6)}.`);
    }
  }
}
