import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";
import { calculateVwap } from "./vwap";
import { calculateEma } from "./movingAverages";

/**
 * Rule D2 — which benchmark represents this symbol.
 *
 * A per-symbol override wins if configured (e.g. semiconductor names ->
 * SMH); otherwise the whole watchlist falls back to the configured
 * default (QQQ). Pure and configuration-driven, so it is not session
 * dependent and needs no reset.
 */
export function resolveBenchmarkSymbol(
  symbol: string,
  config: StrategyConfig["benchmarkAlignment"]
): string {
  return config.overrides[symbol] ?? config.defaultBenchmark;
}

export interface BenchmarkAlignmentResult {
  passed: boolean;
  insufficientData: boolean;
  benchmarkSymbol: string;
  benchmarkPrice: number | null;
  benchmarkVwap: number | null;
  benchmarkEma: number | null;
  aligned: boolean;
  detail: string;
}

/**
 * Rule D1 — is the benchmark itself in gear?
 *
 * "Aligned" means the benchmark's own price is above BOTH its own
 * session VWAP and its own 9 EMA — the same VWAP/EMA maths already used
 * for the stock being scored, just applied to the benchmark series.
 * Both sub-checks are `gt`, ANDed.
 *
 * If the benchmark's candles could not be fetched, or there are too few
 * to compute either line, this reports insufficientData. That is
 * deliberately distinct from "not aligned": an unknown benchmark must
 * never be silently scored as though it were confirmed misaligned.
 */
export function detectBenchmarkAlignment(
  benchmarkSymbol: string,
  benchmarkCandles: Candle[],
  emaPeriod: number
): BenchmarkAlignmentResult {
  const unavailable: BenchmarkAlignmentResult = {
    passed: false,
    insufficientData: true,
    benchmarkSymbol,
    benchmarkPrice: null,
    benchmarkVwap: null,
    benchmarkEma: null,
    aligned: false,
    detail: `${benchmarkSymbol} data unavailable — alignment not evaluated`,
  };

  // Same floors the underlying VWAP/EMA detectors use.
  if (benchmarkCandles.length < 2) return unavailable;
  if (benchmarkCandles.length < emaPeriod + 2) return unavailable;

  const lastIndex = benchmarkCandles.length - 1;
  const benchmarkPrice = benchmarkCandles[lastIndex].close;
  const benchmarkVwap = calculateVwap(benchmarkCandles)[lastIndex];
  const benchmarkEma = calculateEma(benchmarkCandles, emaPeriod)[lastIndex];

  if (!Number.isFinite(benchmarkVwap) || !Number.isFinite(benchmarkEma)) return unavailable;

  const aboveVwap = benchmarkPrice > benchmarkVwap;
  const aboveEma = benchmarkPrice > benchmarkEma;
  const aligned = aboveVwap && aboveEma;

  return {
    passed: aligned,
    insufficientData: false,
    benchmarkSymbol,
    benchmarkPrice,
    benchmarkVwap,
    benchmarkEma,
    aligned,
    detail: aligned
      ? `${benchmarkSymbol} $${benchmarkPrice.toFixed(2)} above its VWAP $${benchmarkVwap.toFixed(2)} and 9 EMA $${benchmarkEma.toFixed(2)}`
      : `${benchmarkSymbol} $${benchmarkPrice.toFixed(2)} not above both — VWAP $${benchmarkVwap.toFixed(2)}, 9 EMA $${benchmarkEma.toFixed(2)}`,
  };
}
