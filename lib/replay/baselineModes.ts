export const DEFAULT_DENSE_ENTER_THRESHOLD = 0.6;
export const DEFAULT_DENSE_LEAVE_THRESHOLD = 0.5;
export const DEFAULT_DENSE_PRESENCE_THRESHOLD = DEFAULT_DENSE_ENTER_THRESHOLD;
export const DEFAULT_SURPRISE_BITS_AT_MAX = 6;

export type BaselineMode = "dense" | "sparse" | "dead";
export type BaselineAxis = "participation" | "displacement" | "idiosyncrasy";
export type AbsentBarPolicy = "zero_observation" | "missing_observation";
export type ParticipationDataQualityState =
  | "observed_activity"
  | "expected_absence"
  | "dense_mad_zero"
  | "dead_expected_absence"
  | "dead_unexpected_activity";

export interface BaselineModeHysteresis {
  enterDenseAtOrAbove: number;
  leaveDenseAtOrBelow: number;
}

export const DEFAULT_MODE_HYSTERESIS: BaselineModeHysteresis = {
  enterDenseAtOrAbove: DEFAULT_DENSE_ENTER_THRESHOLD,
  leaveDenseAtOrBelow: DEFAULT_DENSE_LEAVE_THRESHOLD,
};

export interface BaselineModeRecord {
  symbol: string;
  minuteEt: string;
  subWindow: string;
  sessionsWithBar: number;
  totalSessions: number;
  pPresent: number;
  mode: BaselineMode;
}

export interface BaselineModeChange {
  symbol: string;
  minuteEt: string;
  subWindow: string;
  oldMode: BaselineMode | null;
  newMode: BaselineMode | null;
  oldPPresent: number | null;
  newPPresent: number | null;
  changeKind: "added" | "removed" | "mode_flip" | "p_present_change";
  modeChanged: boolean;
  cacheInvalidationRequired: boolean;
}

export function absentBarPolicy(axis: BaselineAxis): AbsentBarPolicy {
  return axis === "participation" ? "zero_observation" : "missing_observation";
}

export function axisBaselineObservations(
  valuesBySession: ReadonlyArray<number | null>,
  axis: BaselineAxis
): number[] {
  return axis === "participation"
    ? valuesBySession.map((value) => value ?? 0)
    : valuesBySession.filter((value): value is number => value !== null);
}

function assertModeCounts(sessionsWithBar: number, totalSessions: number): void {
  if (!Number.isInteger(sessionsWithBar) || !Number.isInteger(totalSessions) || totalSessions <= 0) {
    throw new Error("Baseline mode requires non-negative integer counts and at least one total session.");
  }
  if (sessionsWithBar < 0 || sessionsWithBar > totalSessions) {
    throw new Error("sessionsWithBar must be between zero and totalSessions.");
  }
}

function assertHysteresis(config: BaselineModeHysteresis): void {
  if (!(config.enterDenseAtOrAbove > 0 && config.enterDenseAtOrAbove <= 1)) {
    throw new Error("enterDenseAtOrAbove must be in (0, 1].");
  }
  if (!(config.leaveDenseAtOrBelow >= 0 && config.leaveDenseAtOrBelow < config.enterDenseAtOrAbove)) {
    throw new Error("leaveDenseAtOrBelow must be below enterDenseAtOrAbove.");
  }
}

export function classifyBaselineMode(
  sessionsWithBar: number,
  totalSessions: number,
  denseThreshold = DEFAULT_DENSE_ENTER_THRESHOLD
): BaselineMode {
  return classifyStickyBaselineMode(sessionsWithBar, totalSessions, null, {
    enterDenseAtOrAbove: denseThreshold,
    leaveDenseAtOrBelow: Math.min(DEFAULT_DENSE_LEAVE_THRESHOLD, denseThreshold - Number.EPSILON),
  });
}

/** Dense entry at 60%, but an existing dense bucket stays dense until p <= 50%. */
export function classifyStickyBaselineMode(
  sessionsWithBar: number,
  totalSessions: number,
  previousMode: BaselineMode | null,
  config: BaselineModeHysteresis = DEFAULT_MODE_HYSTERESIS
): BaselineMode {
  assertModeCounts(sessionsWithBar, totalSessions);
  assertHysteresis(config);
  if (sessionsWithBar === 0) return "dead";
  const pPresent = sessionsWithBar / totalSessions;
  if (previousMode === "dense") {
    return pPresent <= config.leaveDenseAtOrBelow ? "sparse" : "dense";
  }
  return pPresent >= config.enterDenseAtOrAbove ? "dense" : "sparse";
}

export function baselineCacheIdentity(record: Pick<BaselineModeRecord, "symbol" | "minuteEt" | "mode">, modeMapVersion: number): string {
  return `${modeMapVersion}:${record.symbol}:${record.minuteEt}:${record.mode}`;
}

export function changedModeCacheKeys(changes: BaselineModeChange[], oldVersion: number): string[] {
  return changes.flatMap((change) => change.cacheInvalidationRequired && change.oldMode !== null
    ? [baselineCacheIdentity({ symbol: change.symbol, minuteEt: change.minuteEt, mode: change.oldMode }, oldVersion)]
    : []);
}

function modeRecordKey(record: Pick<BaselineModeRecord, "symbol" | "minuteEt">): string {
  return `${record.symbol}|${record.minuteEt}`;
}

/** Deterministic complete diff, including newly added and removed buckets. */
export function diffBaselineModeMaps(
  previous: ReadonlyArray<BaselineModeRecord>,
  current: ReadonlyArray<BaselineModeRecord>
): BaselineModeChange[] {
  const previousByKey = new Map(previous.map((record) => [modeRecordKey(record), record]));
  const currentByKey = new Map(current.map((record) => [modeRecordKey(record), record]));
  const keys = [...new Set([...previousByKey.keys(), ...currentByKey.keys()])].sort();
  const changes: BaselineModeChange[] = [];
  for (const key of keys) {
    const oldRecord = previousByKey.get(key) ?? null;
    const newRecord = currentByKey.get(key) ?? null;
    if (oldRecord && newRecord && oldRecord.mode === newRecord.mode && Math.abs(oldRecord.pPresent - newRecord.pPresent) < 1e-12) continue;
    const changeKind: BaselineModeChange["changeKind"] = oldRecord === null
      ? "added"
      : newRecord === null
      ? "removed"
      : oldRecord.mode !== newRecord.mode
      ? "mode_flip"
      : "p_present_change";
    const modeChanged = changeKind === "mode_flip";
    changes.push({
      symbol: newRecord?.symbol ?? oldRecord!.symbol,
      minuteEt: newRecord?.minuteEt ?? oldRecord!.minuteEt,
      subWindow: newRecord?.subWindow ?? oldRecord!.subWindow,
      oldMode: oldRecord?.mode ?? null,
      newMode: newRecord?.mode ?? null,
      oldPPresent: oldRecord?.pPresent ?? null,
      newPPresent: newRecord?.pPresent ?? null,
      changeKind,
      modeChanged,
      cacheInvalidationRequired: changeKind === "mode_flip" || changeKind === "removed",
    });
  }
  return changes;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

interface ParticipationSignalBase {
  baselineMode: BaselineMode;
  firstObservedActivity: boolean;
  requiresDisplacementConfluence: boolean;
  dataQualityState: ParticipationDataQualityState;
}

export interface DenseParticipationSignal extends ParticipationSignalBase {
  baselineMode: "dense";
  signalKind: "median_mad_z";
  value: number | null;
  median: number;
  mad: number;
  unavailableReason: "mad_zero" | null;
  transform: "log1p";
}

export interface SparseParticipationSignal extends ParticipationSignalBase {
  baselineMode: "sparse";
  signalKind: "presence_surprise_bits";
  value: number;
  pPresent: number;
  surpriseBits: number;
}

export interface DeadExpectedAbsenceSignal extends ParticipationSignalBase {
  baselineMode: "dead";
  signalKind: "not_applicable";
  value: null;
  unavailableReason: "never_present_no_bar";
}

export interface DeadFirstActivitySignal extends ParticipationSignalBase {
  baselineMode: "dead";
  signalKind: "presence_surprise_bits";
  value: 1;
  pPresent: 0;
  surpriseBits: number;
}

export type ParticipationBaselineSignal =
  | DenseParticipationSignal
  | SparseParticipationSignal
  | DeadExpectedAbsenceSignal
  | DeadFirstActivitySignal;

export interface ParticipationRouteInput {
  baselineMode: BaselineMode;
  historicalVolumeBySession: ReadonlyArray<number | null>;
  currentVolume: number;
  currentPresent: boolean;
  surpriseBitsAtMax?: number;
  modeHysteresis?: BaselineModeHysteresis;
}

export interface ParticipationRouteOps {
  dense: (historicalIncludingZeros: number[], currentVolume: number) => DenseParticipationSignal;
  sparse: (sessionsWithBar: number, totalSessions: number, currentPresent: boolean, surpriseBitsAtMax: number) => SparseParticipationSignal;
}

export function denseParticipationSignal(historicalIncludingZeros: number[], currentVolume: number): DenseParticipationSignal {
  if (historicalIncludingZeros.length === 0) throw new Error("Dense participation requires historical sessions.");
  const transformed = historicalIncludingZeros.map(Math.log1p);
  const center = median(transformed);
  const mad = median(transformed.map((value) => Math.abs(value - center)));
  if (mad === 0) {
    return { baselineMode: "dense", signalKind: "median_mad_z", value: null, median: center, mad, unavailableReason: "mad_zero", transform: "log1p", firstObservedActivity: false, requiresDisplacementConfluence: false, dataQualityState: "dense_mad_zero" };
  }
  return { baselineMode: "dense", signalKind: "median_mad_z", value: 0.6745 * (Math.log1p(currentVolume) - center) / mad, median: center, mad, unavailableReason: null, transform: "log1p", firstObservedActivity: false, requiresDisplacementConfluence: false, dataQualityState: currentVolume > 0 ? "observed_activity" : "expected_absence" };
}

export function sparseParticipationSignal(sessionsWithBar: number, totalSessions: number, currentPresent: boolean, surpriseBitsAtMax = DEFAULT_SURPRISE_BITS_AT_MAX): SparseParticipationSignal {
  if (sessionsWithBar <= 0 || totalSessions <= 0 || sessionsWithBar >= totalSessions) throw new Error("Sparse participation requires presence strictly between zero and total sessions.");
  if (surpriseBitsAtMax <= 0) throw new Error("surpriseBitsAtMax must be positive.");
  const pPresent = sessionsWithBar / totalSessions;
  const surpriseBits = -Math.log2(pPresent);
  return { baselineMode: "sparse", signalKind: "presence_surprise_bits", value: currentPresent ? Math.min(1, surpriseBits / surpriseBitsAtMax) : 0, pPresent, surpriseBits, firstObservedActivity: false, requiresDisplacementConfluence: false, dataQualityState: currentPresent ? "observed_activity" : "expected_absence" };
}

export function routeParticipationBaseline(
  input: ParticipationRouteInput,
  ops: ParticipationRouteOps = { dense: denseParticipationSignal, sparse: sparseParticipationSignal }
): ParticipationBaselineSignal {
  const cap = input.surpriseBitsAtMax ?? DEFAULT_SURPRISE_BITS_AT_MAX;
  if (input.baselineMode === "dead") {
    return input.currentPresent
      ? { baselineMode: "dead", signalKind: "presence_surprise_bits", value: 1, pPresent: 0, surpriseBits: cap, firstObservedActivity: true, requiresDisplacementConfluence: true, dataQualityState: "dead_unexpected_activity" }
      : { baselineMode: "dead", signalKind: "not_applicable", value: null, unavailableReason: "never_present_no_bar", firstObservedActivity: false, requiresDisplacementConfluence: false, dataQualityState: "dead_expected_absence" };
  }
  const totalSessions = input.historicalVolumeBySession.length;
  const sessionsWithBar = input.historicalVolumeBySession.filter((value) => value !== null).length;
  const classified = classifyStickyBaselineMode(sessionsWithBar, totalSessions, input.baselineMode, input.modeHysteresis);
  if (classified !== input.baselineMode) throw new Error("Stored baseline mode does not match the supplied archive observations and hysteresis policy.");
  if (input.baselineMode === "dense") return ops.dense(axisBaselineObservations(input.historicalVolumeBySession, "participation"), input.currentVolume);
  return ops.sparse(sessionsWithBar, totalSessions, input.currentPresent, cap);
}

export function participationCanDriveNewInPlay(signal: ParticipationBaselineSignal, displacementConfluence: boolean): boolean {
  if (signal.value === null || signal.value <= 0) return false;
  return !signal.requiresDisplacementConfluence || displacementConfluence;
}
