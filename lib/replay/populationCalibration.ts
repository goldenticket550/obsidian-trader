import {
  normalizeAttentionAxis,
  type AttentionNormalizationCurves,
  type AxisNormalizationConfig,
} from "@/lib/attention/attentionAxes";
import type { AttentionFeedMode } from "@/lib/attention/attentionScore";
import type {
  AttentionSubWindow,
  ResolvedAttentionThresholdValues,
} from "./attentionThresholdTypes";

export const POPULATION_CALIBRATION_VERSION = 1;
export const MINIMUM_IN_PLAY_PARTNER_Z = 1.9;

export interface RawCalibrationPoint {
  tradingDate: string;
  symbol: string;
  minuteOfDay: number;
  feedMode: AttentionFeedMode;
  subWindow: AttentionSubWindow;
  participationInput: number;
  participationInputKind: "z" | "surprise_bits";
  displacementZ: number;
  idiosyncrasyZ: number;
  limitedHistory: boolean;
}

export interface ScoredCalibrationPoint extends RawCalibrationPoint {
  core: number;
  attention: number;
}

export interface CalibrationPopulationTargets {
  watching: number;
  emerging: number;
  inPlay: number;
}

export type PopulationTargetStatistic = "mean" | "median";

export const POPULATION_TARGETS: Record<
  AttentionSubWindow,
  CalibrationPopulationTargets
> = {
  premarket_early: { watching: 12, emerging: 6, inPlay: 3 },
  premarket_core: { watching: 18, emerging: 10, inPlay: 5 },
  premarket_final: { watching: 20, emerging: 12, inPlay: 5 },
  regular: { watching: 26, emerging: 15, inPlay: 7 },
  after_hours_core: { watching: 16, emerging: 9, inPlay: 4 },
  after_hours_late: { watching: 10, emerging: 5, inPlay: 2 },
};

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new Error("Quantile requires observations.");
  if (!Number.isFinite(q) || q < 0 || q > 1)
    throw new Error("Quantile q must be in [0,1].");
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const weight = index - lower;
  return (
    sorted[lower] +
    ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * weight
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

export function deriveCalibrationCurve(
  values: readonly number[],
  kind: "z" | "surprise_bits",
  fallback: AxisNormalizationConfig,
): AxisNormalizationConfig {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 30) return { ...fallback };
  const distribution =
    kind === "surprise_bits" ? usable.filter((value) => value > 0) : usable;
  if (distribution.length < 20) return { ...fallback };
  const q25 = quantile(distribution, 0.25);
  const q50 = quantile(distribution, 0.5);
  const q85 = quantile(distribution, 0.85);
  const z50 =
    kind === "surprise_bits"
      ? clamp((q50 + q85) / 2, 1.75, 4.5)
      : clamp(q85, 1.55, 3.25);
  const spread = Math.max(0.25, q85 - q25);
  const k = clamp(Math.log(9) / spread, 0.65, 1.75);
  return { z50: rounded(z50, 3), k: rounded(k, 3) };
}

export function scoreRawCalibrationPoint(
  point: RawCalibrationPoint,
  curves: AttentionNormalizationCurves,
  idiosyncrasyInfluence = 0.15,
): ScoredCalibrationPoint {
  const participationCurve =
    point.participationInputKind === "surprise_bits"
      ? curves.participationPresence
      : curves.participationDense;
  const participation = normalizeAttentionAxis(
    point.participationInput,
    participationCurve,
  );
  const displacement = normalizeAttentionAxis(
    point.displacementZ,
    curves.displacement,
  );
  const idiosyncrasy = normalizeAttentionAxis(
    point.idiosyncrasyZ,
    curves.idiosyncrasy,
  );
  const core =
    point.feedMode === "sip"
      ? Math.sqrt(participation * displacement)
      : Math.sqrt(displacement * idiosyncrasy);
  const modifier =
    point.feedMode === "sip"
      ? 1 + (idiosyncrasyInfluence * clamp(point.idiosyncrasyZ, -3, 3)) / 3
      : 1;
  const maxModifier = 1 + idiosyncrasyInfluence;
  return { ...point, core, attention: 100 * core * modifier / maxModifier };
}

function thresholdAtTarget(
  points: readonly ScoredCalibrationPoint[],
  target: number,
  statistic: PopulationTargetStatistic,
): number {
  const bySeries = new Map<string, ScoredCalibrationPoint[]>();
  for (const point of points) {
    const key = `${point.tradingDate}|${point.symbol}`;
    const series = bySeries.get(key) ?? [];
    series.push(point);
    bySeries.set(key, series);
  }
  const bySession = new Map<string, Map<string, number>>();
  for (const series of bySeries.values()) {
    series.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    let persistentMaximum = 0;
    for (let index = 1; index < series.length; index += 1) {
      const previous = series[index - 1];
      const current = series[index];
      if (current.minuteOfDay - previous.minuteOfDay !== 1) continue;
      persistentMaximum = Math.max(
        persistentMaximum,
        Math.min(previous.core, current.core),
      );
    }
    const { tradingDate, symbol } = series[0];
    const bySymbol = bySession.get(tradingDate) ?? new Map<string, number>();
    bySymbol.set(symbol, persistentMaximum);
    bySession.set(tradingDate, bySymbol);
  }
  if (statistic === "median") {
    const boundaries = [...bySession.values()].map((bySymbol) => {
      const values = [...bySymbol.values()].sort((a, b) => b - a);
      return values[Math.min(target - 1, values.length - 1)] ?? 1;
    });
    return rounded(quantile(boundaries, 0.5), 4);
  }

  // Pooling one persistent maximum per symbol/session selects the boundary
  // whose training-session mean is target.
  const descending = [...bySession.values()]
    .flatMap((bySymbol) => [...bySymbol.values()])
    .sort((a, b) => b - a);
  const targetPopulation = target * bySession.size;
  return rounded(
    descending[Math.min(targetPopulation - 1, descending.length - 1)] ?? 1,
    4,
  );
}

function positiveVelocityThreshold(
  points: readonly ScoredCalibrationPoint[],
): number {
  const bySeries = new Map<string, ScoredCalibrationPoint[]>();
  for (const point of points) {
    const key = `${point.tradingDate}|${point.symbol}`;
    const series = bySeries.get(key) ?? [];
    series.push(point);
    bySeries.set(key, series);
  }
  const velocities: number[] = [];
  for (const series of bySeries.values()) {
    series.sort((a, b) => a.minuteOfDay - b.minuteOfDay);
    const byMinute = new Map(series.map((point) => [point.minuteOfDay, point]));
    for (const point of series) {
      const earlier = byMinute.get(point.minuteOfDay - 3);
      if (!earlier) continue;
      const velocity = (point.attention - earlier.attention) / 3;
      if (velocity > 0) velocities.push(velocity);
    }
  }
  return velocities.length < 20
    ? 2
    : rounded(Math.max(0.25, quantile(velocities, 0.9)), 3);
}

export function derivePopulationThresholds(
  points: readonly ScoredCalibrationPoint[],
  targets: CalibrationPopulationTargets,
  statistic: PopulationTargetStatistic = "mean",
): ResolvedAttentionThresholdValues {
  if (points.length === 0)
    throw new Error("Population thresholds require scored training points.");
  let watchingEnterCore = thresholdAtTarget(
    points,
    targets.watching,
    statistic,
  );
  let emergingEnterCore = thresholdAtTarget(
    points,
    targets.emerging,
    statistic,
  );
  let inPlayEnterCore = thresholdAtTarget(points, targets.inPlay, statistic);
  watchingEnterCore = clamp(watchingEnterCore, 0.12, 0.97);
  emergingEnterCore = clamp(
    Math.max(emergingEnterCore, watchingEnterCore + 0.01),
    0.24,
    0.985,
  );
  inPlayEnterCore = clamp(
    Math.max(inPlayEnterCore, emergingEnterCore + 0.01),
    0.45,
    0.995,
  );
  return {
    watchingEnterCore: rounded(watchingEnterCore),
    watchingExitCore: rounded(Math.max(0.08, watchingEnterCore - 0.015)),
    emergingEnterCore: rounded(emergingEnterCore),
    emergingExitCore: rounded(
      Math.max(watchingEnterCore + 0.002, emergingEnterCore - 0.015),
    ),
    inPlayEnterCore: rounded(inPlayEnterCore),
    inPlayExitCore: rounded(
      Math.max(emergingEnterCore + 0.002, inPlayEnterCore - 0.015),
    ),
    newInPlayVelocityPerMinute: positiveVelocityThreshold(points),
    enterPersistenceMinutes: 2,
    exitPersistenceMinutes: 2,
  };
}

export function inverseNormalizedValue(
  normalized: number,
  curve: AxisNormalizationConfig,
): number {
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized >= 1) {
    throw new Error(
      "Inverse normalization requires a value strictly between zero and one.",
    );
  }
  return curve.z50 + Math.log(normalized / (1 - normalized)) / curve.k;
}

export function partnerInputRequired(
  coreThreshold: number,
  saturatedAxisInput: number,
  saturatedCurve: AxisNormalizationConfig,
  partnerCurve: AxisNormalizationConfig,
): number {
  const saturated = normalizeAttentionAxis(saturatedAxisInput, saturatedCurve);
  const requiredNormalized = (coreThreshold * coreThreshold) / saturated;
  if (requiredNormalized >= 1) return Infinity;
  if (requiredNormalized <= 0.01) return -Infinity;
  return inverseNormalizedValue(requiredNormalized, partnerCurve);
}

export interface ConfluenceCheck {
  firstAxisAtSixRequiresPartnerZ: number;
  secondAxisAtSixRequiresPartnerZ: number;
  minimumRequiredPartnerZ: number;
  passed: boolean;
}

export function assertCalibrationConfluence(input: {
  feedMode: AttentionFeedMode;
  curves: AttentionNormalizationCurves;
  thresholds: ResolvedAttentionThresholdValues;
  minimumPartnerZ?: number;
}): ConfluenceCheck {
  const first =
    input.feedMode === "sip"
      ? input.curves.participationDense
      : input.curves.displacement;
  const second =
    input.feedMode === "sip"
      ? input.curves.displacement
      : input.curves.idiosyncrasy;
  const minimumRequiredPartnerZ =
    input.minimumPartnerZ ?? MINIMUM_IN_PLAY_PARTNER_Z;
  const firstAxisAtSixRequiresPartnerZ = partnerInputRequired(
    input.thresholds.inPlayEnterCore,
    6,
    first,
    second,
  );
  const secondAxisAtSixRequiresPartnerZ = partnerInputRequired(
    input.thresholds.inPlayEnterCore,
    6,
    second,
    first,
  );
  const passed =
    firstAxisAtSixRequiresPartnerZ >= minimumRequiredPartnerZ &&
    secondAxisAtSixRequiresPartnerZ >= minimumRequiredPartnerZ;
  if (!passed) {
    throw new Error(
      `Confluence calibration failed: partner z ${Math.min(firstAxisAtSixRequiresPartnerZ, secondAxisAtSixRequiresPartnerZ).toFixed(3)} < ${minimumRequiredPartnerZ}.`,
    );
  }
  return {
    firstAxisAtSixRequiresPartnerZ,
    secondAxisAtSixRequiresPartnerZ,
    minimumRequiredPartnerZ,
    passed,
  };
}
