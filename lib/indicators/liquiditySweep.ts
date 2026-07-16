import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";
import { findPivots } from "./pivots";

export interface LiquiditySweepResult {
  passed: boolean;
  sweptLevel: number | null;
  sweptLevelSource: "pivot_low" | "session_low" | null;
  sweepCandleTime: number | null;
  reclaimCandleTime: number | null;
  /** Marked experimental per spec until validated against real data. */
  experimental: true;
}

/**
 * Stage 4 (EXPERIMENTAL): detects a bullish liquidity sweep — price trades
 * below a recent pivot low or the session low, then closes back above that
 * level within `maxCandlesToReclaim` candles.
 *
 * V1 scope is intentionally limited to recent pivot lows and the current
 * session low, per spec. Previous-day low, premarket low, and equal lows
 * are left for a later iteration.
 */
export function detectLiquiditySweep(
  candles: Candle[],
  sessionLow: number,
  config: StrategyConfig["liquiditySweep"]
): LiquiditySweepResult {
  const fail: LiquiditySweepResult = {
    passed: false,
    sweptLevel: null,
    sweptLevelSource: null,
    sweepCandleTime: null,
    reclaimCandleTime: null,
    experimental: true,
  };

  if (candles.length < 2) return fail;

  // Pivot lows are only meaningful once there's enough data on both sides
  // of a candidate pivot; skip pivot candidates (not the whole detector)
  // when the series is too short for that.
  let mostRecentPivotLow: number | null = null;
  if (candles.length >= config.pivotLookback * 2 + 1) {
    const pivots = findPivots(candles, config.pivotLookback).filter((p) => p.type === "low");
    if (pivots.length > 0) {
      mostRecentPivotLow = pivots[pivots.length - 1].price;
    }
  }

  // Walk forward tracking the RUNNING low up to (not including) each
  // candle. A sweep is a candle trading below a level that was already
  // established by prior candles — using the whole-session minimum here
  // would be tautological, since that minimum necessarily includes the
  // sweep candle itself.
  for (let i = 1; i < candles.length; i++) {
    const priorLow = Math.min(...candles.slice(0, i).map((c) => c.low));
    const candidates: { level: number; source: "pivot_low" | "session_low" }[] = [];
    if (mostRecentPivotLow !== null && mostRecentPivotLow <= priorLow) {
      candidates.push({ level: mostRecentPivotLow, source: "pivot_low" });
    }
    candidates.push({ level: priorLow, source: "session_low" });

    for (const candidate of candidates) {
      if (candles[i].low >= candidate.level) continue;

      const windowEnd = Math.min(i + config.maxCandlesToReclaim, candles.length - 1);
      for (let j = i + 1; j <= windowEnd; j++) {
        if (candles[j].close > candidate.level) {
          return {
            passed: true,
            sweptLevel: candidate.level,
            sweptLevelSource: candidate.source,
            sweepCandleTime: candles[i].time,
            reclaimCandleTime: candles[j].time,
            experimental: true,
          };
        }
      }
    }
  }

  return fail;
}
