import type { Candle } from "@/types/candle";
import {
  buildContinuousSameTimeBaseline,
  type ContinuousBaselineResult,
} from "./baselines";
import type { AttentionDataQualityState } from "./dataQuality";
import type { BaselineMode, ParticipationBaselineSignal } from "@/lib/replay/baselineModes";

export interface AxisNormalizationConfig {
  z50: number;
  k: number;
}

export interface AttentionNormalizationCurves {
  participationDense: AxisNormalizationConfig;
  participationPresence: AxisNormalizationConfig;
  displacement: AxisNormalizationConfig;
  idiosyncrasy: AxisNormalizationConfig;
}
export interface AttentionMeasurementTransforms {
  participationDense: "log1p";
  participationPresence: "presence_surprise_bits";
  displacementRange: "log1p";
  displacementPathEfficiency: "linear";
  idiosyncrasy: "linear";
}

export const ATTENTION_MEASUREMENT_TRANSFORMS: AttentionMeasurementTransforms = {
  participationDense: "log1p",
  participationPresence: "presence_surprise_bits",
  displacementRange: "log1p",
  displacementPathEfficiency: "linear",
  idiosyncrasy: "linear",
};

export interface AttentionAxisConfig extends AttentionNormalizationCurves {
  minPathAtr: number;
}

/**
 * Provisional only. These curves are copied into every versioned
 * (feedMode x sub-window) calibration set and must be calibrated together
 * with that set's state/velocity thresholds.
 */
export const PROVISIONAL_ATTENTION_NORMALIZATION_CURVES: AttentionNormalizationCurves = {
  participationDense: { z50: 2, k: 1.2 },
  participationPresence: { z50: 3, k: 1.3 },
  displacement: { z50: 2, k: 1.2 },
  idiosyncrasy: { z50: 2, k: 1.2 },
};

export const DEFAULT_ATTENTION_AXIS_CONFIG: AttentionAxisConfig = {
  ...PROVISIONAL_ATTENTION_NORMALIZATION_CURVES,
  minPathAtr: 0.1,
};

export type AxisStatus = "ok" | "unavailable";

export interface AxisComponentExplanation {
  name: string;
  rawValue: number | null;
  baselineMedian: number | null;
  baselineMad: number | null;
  pPresent: number | null;
  surpriseBits: number | null;
  signalKind: "median_mad_z" | "presence_surprise_bits" | "not_applicable";
  baselineMode: BaselineMode | "continuous";
  baselineState: string;
  baselineTransform: "linear" | "log1p" | "none";
  z: number | null;
}

export interface AttentionAxisResult {
  axis: "participation" | "displacement" | "idiosyncrasy";
  status: AxisStatus;
  value: number | null;
  normalizationInput: number | null;
  normalizationInputKind: "z" | "surprise_bits";
  z50: number;
  k: number;
  normalized: number | null;
  baselineMode: BaselineMode | "continuous";
  components: AxisComponentExplanation[];
  unavailableReason: string | null;
}

export interface ParticipationAxisResult extends AttentionAxisResult {
  axis: "participation";
  baselineMode: BaselineMode;
  firstObservedActivity: boolean;
  requiresDisplacementConfluence: boolean;
  currentVolume: number;
  currentDollarVolume: number;
}

export type IdiosyncrasyClassification =
  | "stock_specific"
  | "sector_driven"
  | "market_driven"
  | "unavailable";

export interface IdiosyncrasyAxisResult extends AttentionAxisResult {
  axis: "idiosyncrasy";
  stockReturn: number | null;
  benchmarkReturn: number | null;
  sectorReturn: number | null;
  stockVsBenchmark: number | null;
  sectorVsBenchmark: number | null;
  classification: IdiosyncrasyClassification;
}

function assertNormalizationConfig(config: AxisNormalizationConfig): void {
  if (!Number.isFinite(config.z50) || !Number.isFinite(config.k) || config.k <= 0) {
    throw new Error("Axis normalization requires finite z50 and positive k.");
  }
}

/** Exact A2 normalization curve. The floor prevents a zero geometric core. */
export function normalizeAttentionAxis(value: number, config: AxisNormalizationConfig): number {
  if (!Number.isFinite(value)) throw new Error("Attention-axis normalization requires a finite input.");
  assertNormalizationConfig(config);
  return Math.max(1 / (1 + Math.exp(-config.k * (value - config.z50))), 0.01);
}

function continuousComponent(name: string, rawValue: number | null, baseline: ContinuousBaselineResult | null): AxisComponentExplanation {
  return {
    name,
    rawValue,
    baselineMedian: baseline?.median ?? null,
    baselineMad: baseline?.mad ?? null,
    pPresent: null,
    surpriseBits: null,
    signalKind: "median_mad_z",
    baselineMode: "continuous",
    baselineState: baseline?.state ?? "not_computed",
    baselineTransform: baseline?.transform ?? "none",
    z: baseline?.value ?? null,
  };
}

export function computeParticipationAxis(input: {
  signal: ParticipationBaselineSignal;
  currentVolume: number;
  currentPrice: number;
  dollarVolumeBaseline?: ContinuousBaselineResult | null;
  config?: Pick<AttentionAxisConfig, "participationDense" | "participationPresence">;
}): ParticipationAxisResult {
  const config = input.config ?? DEFAULT_ATTENTION_AXIS_CONFIG;
  const currentDollarVolume = input.currentVolume * input.currentPrice;
  if (![input.currentVolume, input.currentPrice, currentDollarVolume].every(Number.isFinite) || input.currentVolume < 0 || input.currentPrice <= 0) {
    throw new Error("Participation requires finite non-negative volume and a positive price.");
  }

  if (input.signal.signalKind === "not_applicable") {
    const curve = config.participationPresence;
    return {
      axis: "participation",
      status: "unavailable",
      value: null,
      normalizationInput: null,
      normalizationInputKind: "surprise_bits",
      z50: curve.z50,
      k: curve.k,
      normalized: null,
      baselineMode: input.signal.baselineMode,
      components: [{
        name: "presence",
        rawValue: null,
        baselineMedian: null,
        baselineMad: null,
        pPresent: 0,
        surpriseBits: null,
        signalKind: "not_applicable",
        baselineMode: input.signal.baselineMode,
        baselineState: input.signal.dataQualityState,
        baselineTransform: "none",
        z: null,
      }],
      unavailableReason: input.signal.unavailableReason,
      firstObservedActivity: false,
      requiresDisplacementConfluence: false,
      currentVolume: input.currentVolume,
      currentDollarVolume,
    };
  }

  if (input.signal.signalKind === "presence_surprise_bits") {
    const curve = config.participationPresence;
    const observedSurprise = input.signal.dataQualityState === "expected_absence" ? 0 : input.signal.surpriseBits;
    const normalized = normalizeAttentionAxis(observedSurprise, curve);
    return {
      axis: "participation",
      status: "ok",
      value: observedSurprise,
      normalizationInput: observedSurprise,
      normalizationInputKind: "surprise_bits",
      z50: curve.z50,
      k: curve.k,
      normalized,
      baselineMode: input.signal.baselineMode,
      components: [{
        name: "presence",
        rawValue: input.currentVolume,
        baselineMedian: null,
        baselineMad: null,
        pPresent: input.signal.pPresent,
        surpriseBits: observedSurprise,
        signalKind: "presence_surprise_bits",
        baselineMode: input.signal.baselineMode,
        baselineState: input.signal.dataQualityState,
        baselineTransform: "none",
        z: null,
      }],
      unavailableReason: null,
      firstObservedActivity: input.signal.firstObservedActivity,
      requiresDisplacementConfluence: input.signal.requiresDisplacementConfluence,
      currentVolume: input.currentVolume,
      currentDollarVolume,
    };
  }

  const curve = config.participationDense;
  const volumeZ = input.signal.value;
  const dollarZ = input.dollarVolumeBaseline?.state === "ok" ? input.dollarVolumeBaseline.value : null;
  const available = [volumeZ, dollarZ].filter((value): value is number => value !== null);
  const value = available.length === 0 ? null : available.reduce((sum, item) => sum + item, 0) / available.length;
  return {
    axis: "participation",
    status: value === null ? "unavailable" : "ok",
    value,
    normalizationInput: value,
    normalizationInputKind: "z",
    z50: curve.z50,
    k: curve.k,
    normalized: value === null ? null : normalizeAttentionAxis(value, curve),
    baselineMode: "dense",
    components: [
      {
        name: "volume",
        rawValue: input.currentVolume,
        baselineMedian: input.signal.median,
        baselineMad: input.signal.mad,
        pPresent: null,
        surpriseBits: null,
        signalKind: "median_mad_z",
        baselineMode: "dense",
        baselineState: input.signal.unavailableReason ?? "ok",
        baselineTransform: input.signal.transform,
        z: volumeZ,
      },
      continuousComponent("dollar_volume", currentDollarVolume, input.dollarVolumeBaseline ?? null),
    ],
    unavailableReason: value === null ? input.signal.unavailableReason ?? "dense_components_unavailable" : null,
    firstObservedActivity: false,
    requiresDisplacementConfluence: false,
    currentVolume: input.currentVolume,
    currentDollarVolume,
  };
}

export interface PathEfficiencyResult {
  value: number | null;
  totalPath: number;
  minimumPath: number;
}

export function calculatePathEfficiency(
  bars: readonly Candle[],
  atr: number,
  minPathAtr = DEFAULT_ATTENTION_AXIS_CONFIG.minPathAtr
): PathEfficiencyResult {
  if (!Number.isFinite(atr) || atr <= 0 || !Number.isFinite(minPathAtr) || minPathAtr < 0) {
    throw new Error("Path efficiency requires positive ATR and non-negative minPathAtr.");
  }
  if (bars.length === 0) return { value: null, totalPath: 0, minimumPath: minPathAtr * atr };
  let totalPath = Math.abs(bars[0].close - bars[0].open);
  for (let index = 1; index < bars.length; index += 1) {
    totalPath += Math.abs(bars[index].close - bars[index - 1].close);
  }
  const minimumPath = minPathAtr * atr;
  if (totalPath < minimumPath) return { value: null, totalPath, minimumPath };
  const net = Math.abs(bars[bars.length - 1].close - bars[0].open);
  return { value: Math.max(0, Math.min(1, net / totalPath)), totalPath, minimumPath };
}

export function computeDisplacementAxis(input: {
  bars: readonly Candle[];
  atr: number;
  historicalRangeAtr: ReadonlyArray<number | null>;
  historicalPathEfficiency: ReadonlyArray<number | null>;
  dataQualityState: AttentionDataQualityState;
  minSessions?: number;
  config?: Pick<AttentionAxisConfig, "displacement" | "minPathAtr">;
}): AttentionAxisResult {
  const config = input.config ?? DEFAULT_ATTENTION_AXIS_CONFIG;
  if (input.bars.length === 0) {
    return {
      axis: "displacement", status: "unavailable", value: null, normalizationInput: null,
      normalizationInputKind: "z", z50: config.displacement.z50, k: config.displacement.k,
      normalized: null, baselineMode: "continuous", components: [], unavailableReason: "absent_price_bar",
    };
  }
  if (!Number.isFinite(input.atr) || input.atr <= 0) throw new Error("Displacement requires positive ATR.");
  const rangeAtr = (Math.max(...input.bars.map((bar) => bar.high)) - Math.min(...input.bars.map((bar) => bar.low))) / input.atr;
  const path = calculatePathEfficiency(input.bars, input.atr, config.minPathAtr);
  const rangeBaseline = buildContinuousSameTimeBaseline({
    axis: "displacement", historicalValues: input.historicalRangeAtr, currentValue: rangeAtr,
    minSessions: input.minSessions, transform: "log1p", dataQualityState: input.dataQualityState,
  });
  const pathBaseline = path.value === null ? null : buildContinuousSameTimeBaseline({
    axis: "displacement", historicalValues: input.historicalPathEfficiency, currentValue: path.value,
    minSessions: input.minSessions, transform: "linear", dataQualityState: input.dataQualityState,
  });
  const zValues = [rangeBaseline.value, pathBaseline?.value ?? null].filter((value): value is number => value !== null);
  const value = zValues.length === 0 ? null : zValues.reduce((sum, item) => sum + item, 0) / zValues.length;
  return {
    axis: "displacement",
    status: value === null ? "unavailable" : "ok",
    value,
    normalizationInput: value,
    normalizationInputKind: "z",
    z50: config.displacement.z50,
    k: config.displacement.k,
    normalized: value === null ? null : normalizeAttentionAxis(value, config.displacement),
    baselineMode: "continuous",
    components: [
      continuousComponent("range_atr", rangeAtr, rangeBaseline),
      { ...continuousComponent("path_efficiency", path.value, pathBaseline), baselineState: path.value === null ? "below_min_path_atr" : pathBaseline?.state ?? "not_computed" },
      {
        name: "total_path", rawValue: path.totalPath, baselineMedian: null, baselineMad: null,
        pPresent: null, surpriseBits: null, signalKind: "not_applicable", baselineMode: "continuous",
        baselineState: `minimum_path=${path.minimumPath}`, baselineTransform: "none", z: null,
      },
    ],
    unavailableReason: value === null ? "displacement_baseline_unavailable" : null,
  };
}

function barReturn(bar: Candle): number {
  if (!Number.isFinite(bar.open) || !Number.isFinite(bar.close) || bar.open <= 0) throw new Error("Idiosyncrasy bars require finite positive opens and closes.");
  return bar.close / bar.open - 1;
}

export function computeIdiosyncrasyAxis(input: {
  stockBar: Candle | null;
  benchmarkBar: Candle | null;
  sectorBar: Candle | null;
  historicalStockVsBenchmark: ReadonlyArray<number | null>;
  historicalSectorVsBenchmark: ReadonlyArray<number | null>;
  dataQualityState: AttentionDataQualityState;
  minSessions?: number;
  config?: Pick<AttentionAxisConfig, "idiosyncrasy">;
}): IdiosyncrasyAxisResult {
  const config = input.config ?? DEFAULT_ATTENTION_AXIS_CONFIG;
  const unavailableBase = {
    axis: "idiosyncrasy" as const, status: "unavailable" as const, value: null,
    normalizationInput: null, normalizationInputKind: "z" as const, z50: config.idiosyncrasy.z50,
    k: config.idiosyncrasy.k, normalized: null, baselineMode: "continuous" as const, components: [],
    unavailableReason: "absent_price_bar", stockReturn: null, benchmarkReturn: null, sectorReturn: null,
    stockVsBenchmark: null, sectorVsBenchmark: null, classification: "unavailable" as const,
  };
  if (!input.stockBar || !input.benchmarkBar || !input.sectorBar) return unavailableBase;

  const stockReturn = barReturn(input.stockBar);
  const benchmarkReturn = barReturn(input.benchmarkBar);
  const sectorReturn = barReturn(input.sectorBar);
  const stockVsBenchmark = stockReturn - benchmarkReturn;
  const sectorVsBenchmark = sectorReturn - benchmarkReturn;
  const stockMagnitude = Math.abs(stockVsBenchmark);
  const sectorMagnitude = Math.abs(sectorVsBenchmark);
  const stockBaseline = buildContinuousSameTimeBaseline({
    axis: "idiosyncrasy", historicalValues: input.historicalStockVsBenchmark,
    currentValue: stockMagnitude, minSessions: input.minSessions, dataQualityState: input.dataQualityState,
  });
  const sectorBaseline = buildContinuousSameTimeBaseline({
    axis: "idiosyncrasy", historicalValues: input.historicalSectorVsBenchmark,
    currentValue: sectorMagnitude, minSessions: input.minSessions, dataQualityState: input.dataQualityState,
  });
  const stockZ = stockBaseline.value;
  const sectorZ = sectorBaseline.value;
  const available = [stockZ, sectorZ].filter((value): value is number => value !== null);
  const value = available.length === 0 ? null : Math.max(...available);
  const classification: IdiosyncrasyClassification = value === null
    ? "unavailable"
    : value <= 0
    ? "market_driven"
    : (sectorZ ?? -Infinity) >= (stockZ ?? -Infinity)
    ? "sector_driven"
    : "stock_specific";
  return {
    axis: "idiosyncrasy",
    status: value === null ? "unavailable" : "ok",
    value,
    normalizationInput: value,
    normalizationInputKind: "z",
    z50: config.idiosyncrasy.z50,
    k: config.idiosyncrasy.k,
    normalized: value === null ? null : normalizeAttentionAxis(value, config.idiosyncrasy),
    baselineMode: "continuous",
    components: [
      continuousComponent("stock_vs_benchmark", stockVsBenchmark, stockBaseline),
      continuousComponent("sector_vs_benchmark", sectorVsBenchmark, sectorBaseline),
    ],
    unavailableReason: value === null ? "idiosyncrasy_baseline_unavailable" : null,
    stockReturn,
    benchmarkReturn,
    sectorReturn,
    stockVsBenchmark,
    sectorVsBenchmark,
    classification,
  };
}
