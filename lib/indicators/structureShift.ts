import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";
import { findPivots, mostRecentPivot } from "./pivots";

export type StructureShiftState = "waiting" | "confirmed" | "invalidated";

export interface StructureShiftResult {
  state: StructureShiftState;
  triggerSwingHigh: number | null;
  shiftCandleTime: number | null;
  shiftPrice: number | null;
}

/**
 * Stage 5: after a low has formed (e.g. from a liquidity sweep), detect a
 * bullish structure shift — a candle that closes above the most recent
 * meaningful swing high. Deliberately conservative: only a close above a
 * confirmed pivot high counts, so minor wiggles are never labeled a shift.
 */
export function detectStructureShift(
  candles: Candle[],
  sweepIndex: number | null,
  config: StrategyConfig["structureShift"]
): StructureShiftResult {
  const waiting: StructureShiftResult = {
    state: "waiting",
    triggerSwingHigh: null,
    shiftCandleTime: null,
    shiftPrice: null,
  };

  if (sweepIndex === null || candles.length < config.pivotLength * 2 + 2) return waiting;

  const pivots = findPivots(candles, config.pivotLength);
  const swingHigh = mostRecentPivot(pivots, "high", sweepIndex + 1) ?? mostRecentPivot(pivots, "high");

  if (!swingHigh) return waiting;

  for (let i = sweepIndex + 1; i < candles.length; i++) {
    if (candles[i].close > swingHigh.price) {
      return {
        state: "confirmed",
        triggerSwingHigh: swingHigh.price,
        shiftCandleTime: candles[i].time,
        shiftPrice: candles[i].close,
      };
    }
  }

  return {
    state: "waiting",
    triggerSwingHigh: swingHigh.price,
    shiftCandleTime: null,
    shiftPrice: null,
  };
}
