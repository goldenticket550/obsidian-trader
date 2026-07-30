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
  /**
   * True only when there were fewer than 2 candles, so no sweep could be
   * looked for at all. Same defect as detectConsecutiveBullish had: one
   * shared `fail` object served both "no data" and "checked the whole
   * series and found nothing", and the UI rendered them identically.
   */
  insufficientData: boolean;
  /**
   * The level the detector was watching at the end of its scan — the
   * running low established by all candles before the most recent one.
   * Null only when nothing was evaluated. This is the number that
   * answers "how close did it get?".
   */
  watchedLevel: number | null;
  /**
   * True when price DID trade below a watched level but never closed
   * back above it within `maxCandlesToReclaim`. That is a materially
   * different outcome from "price never breached anything" — the setup
   * was attempted and failed, rather than never starting.
   */
  breachedWithoutReclaim: boolean;
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
  // Nothing can be evaluated with fewer than two candles — the only case
  // where null/false across the board is the honest answer.
  if (candles.length < 2) {
    return {
      passed: false,
      sweptLevel: null,
      sweptLevelSource: null,
      sweepCandleTime: null,
      reclaimCandleTime: null,
      experimental: true,
      insufficientData: true,
      watchedLevel: null,
      breachedWithoutReclaim: false,
    };
  }

  // Observations recorded as the scan runs, so a negative result can say
  // what it actually looked at. Neither participates in the decision.
  let watchedLevel: number | null = null;
  let breachedWithoutReclaim = false;

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
    // Last value wins, so this ends as the level in force for the most
    // recent candle — what the detector was watching when it gave up.
    watchedLevel = priorLow;

    const candidates: { level: number; source: "pivot_low" | "session_low" }[] = [];
    if (mostRecentPivotLow !== null && mostRecentPivotLow <= priorLow) {
      candidates.push({ level: mostRecentPivotLow, source: "pivot_low" });
    }
    candidates.push({ level: priorLow, source: "session_low" });

    for (const candidate of candidates) {
      if (candles[i].low >= candidate.level) continue;

      // Price went below a watched level. Whether or not it reclaims, the
      // attempt happened and is worth reporting.
      breachedWithoutReclaim = true;

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
            insufficientData: false,
            watchedLevel: candidate.level,
            breachedWithoutReclaim: false,
          };
        }
      }
    }
  }

  // Checked the whole series and found no qualifying sweep. Report what
  // was watched and whether it was ever breached.
  return {
    passed: false,
    sweptLevel: null,
    sweptLevelSource: null,
    sweepCandleTime: null,
    reclaimCandleTime: null,
    experimental: true,
    insufficientData: false,
    watchedLevel,
    breachedWithoutReclaim,
  };
}
