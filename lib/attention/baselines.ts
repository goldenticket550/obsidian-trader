import type { Candle } from "@/types/candle";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import { groupBySession } from "@/lib/market-data/sessionFilter";
import {
  axisBaselineObservations,
  routeParticipationBaseline,
  type BaselineAxis,
  type BaselineMode,
  type ParticipationBaselineSignal,
} from "@/lib/replay/baselineModes";
import type { AttentionDataQualityState } from "./dataQuality";

export const DEFAULT_BASELINE_LOOKBACK_SESSIONS = 20;
export const DEFAULT_BASELINE_MIN_SESSIONS = 10;
export const DEFAULT_BASELINE_WINSOR_PERCENTILE = 0.95;
export const DEFAULT_BASELINE_Z_CLAMP = 8;

export interface SameTimeObservation {
  tradingDate: string;
  value: number | null;
}

export function collectSameTimeBucket(
  candles: readonly Candle[],
  knownTradingDates: readonly string[],
  minuteOfDay: number,
  bucketMinutes: 1 | 5,
  metric: (bars: readonly Candle[]) => number
): SameTimeObservation[] {
  const groups = new Map(groupBySession([...candles], "extended").map((group) => [group.tradingDate, group.candles]));
  return [...knownTradingDates].sort().map((tradingDate) => {
    const bars = (groups.get(tradingDate) ?? []).filter((bar) => {
      const minute = getEasternTimeParts(new Date(bar.time * 1000)).minutesSinceMidnight;
      return minute >= minuteOfDay && minute < minuteOfDay + bucketMinutes;
    });
    return { tradingDate, value: bars.length === 0 ? null : metric(bars) };
  });
}

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const weight = index - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * weight;
}

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

export type ContinuousBaselineTransform = "linear" | "log1p";

export interface ContinuousBaselineResult {
  signalKind: "median_mad_z";
  state: "ok" | "insufficient_baseline" | "unavailable";
  value: number | null;
  sampleSize: number;
  median: number | null;
  mad: number | null;
  winsorCap: number | null;
  absentBarPolicy: "zero_observation" | "missing_observation";
  dataQualityState: AttentionDataQualityState;
  calibrationEligible: boolean;
  transform: ContinuousBaselineTransform;
}

export function buildContinuousSameTimeBaseline(input: {
  axis: BaselineAxis;
  historicalValues: ReadonlyArray<number | null>;
  currentValue: number;
  minSessions?: number;
  winsorPercentile?: number;
  zClamp?: number;
  madFloor?: number;
  transform?: ContinuousBaselineTransform;
  dataQualityState: AttentionDataQualityState;
}): ContinuousBaselineResult {
  const minSessions = input.minSessions ?? DEFAULT_BASELINE_MIN_SESSIONS;
  const transform = input.transform ?? "linear";
  const transformValue = transform === "log1p" ? Math.log1p : (value: number) => value;
  const observations = axisBaselineObservations(input.historicalValues, input.axis).map(transformValue);
  const absentBarPolicy = input.axis === "participation" ? "zero_observation" : "missing_observation";
  const calibrationEligible = input.dataQualityState === "ok";
  if (observations.length < minSessions) return { signalKind: "median_mad_z", state: "insufficient_baseline", value: null, sampleSize: observations.length, median: null, mad: null, winsorCap: null, absentBarPolicy, dataQualityState: input.dataQualityState, calibrationEligible, transform };
  const winsorCap = quantile(observations, input.winsorPercentile ?? DEFAULT_BASELINE_WINSOR_PERCENTILE);
  const winsorized = observations.map((value) => Math.min(value, winsorCap));
  const center = median(winsorized);
  const mad = median(winsorized.map((value) => Math.abs(value - center)));
  if (mad <= (input.madFloor ?? 1e-12)) return { signalKind: "median_mad_z", state: "unavailable", value: null, sampleSize: observations.length, median: center, mad, winsorCap, absentBarPolicy, dataQualityState: input.dataQualityState, calibrationEligible, transform };
  const unclamped = (transformValue(input.currentValue) - center) / (1.4826 * mad);
  const clamp = input.zClamp ?? DEFAULT_BASELINE_Z_CLAMP;
  return { signalKind: "median_mad_z", state: "ok", value: Math.max(-clamp, Math.min(clamp, unclamped)), sampleSize: observations.length, median: center, mad, winsorCap, absentBarPolicy, dataQualityState: input.dataQualityState, calibrationEligible, transform };
}
export function buildParticipationSameTimeBaseline(input: {
  baselineMode: BaselineMode;
  historicalValues: ReadonlyArray<number | null>;
  currentValue: number;
  currentPresent: boolean;
  dataQualityState: AttentionDataQualityState;
}): ParticipationBaselineSignal & { calibrationEligible: boolean; symbolDataQualityState: AttentionDataQualityState } {
  const signal = routeParticipationBaseline({
    baselineMode: input.baselineMode,
    historicalVolumeBySession: input.historicalValues,
    currentVolume: input.currentValue,
    currentPresent: input.currentPresent,
  });
  return { ...signal, calibrationEligible: input.dataQualityState === "ok", symbolDataQualityState: input.dataQualityState };
}
