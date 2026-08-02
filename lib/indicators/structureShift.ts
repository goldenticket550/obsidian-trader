import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";
import { findPivots, mostRecentPivot } from "./pivots";

export type StructureShiftState = "waiting" | "confirmed" | "invalidated";

export interface StructureShiftResult {
  state: StructureShiftState;
  triggerSwingHigh: number | null;
  shiftCandleTime: number | null;
  shiftPrice: number | null;
  /**
   * Market time at which `triggerSwingHigh` became KNOWABLE — read-only,
   * and used by nothing in this file.
   *
   * A pivot is symmetric: `findPivots` requires `pivotLength` lower highs
   * on each side, so a pivot centred at index `i` is not identifiable
   * until bar `i + pivotLength` has completed. That completing bar's
   * timestamp is this value.
   *
   * Exposed because the swing-high PRICE on its own is a hindsight value:
   * a consumer replaying candles chronologically cannot otherwise tell
   * when the level actually existed. Null whenever there is no swing-high
   * pivot — never a guess, and never the centre bar's own time, which is
   * `pivotLength` bars too early.
   */
  triggerSwingHighConfirmedTime: number | null;
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
    triggerSwingHighConfirmedTime: null,
  };

  if (sweepIndex === null || candles.length < config.pivotLength * 2 + 2) return waiting;

  const pivots = findPivots(candles, config.pivotLength);
  const swingHigh = mostRecentPivot(pivots, "high", sweepIndex + 1) ?? mostRecentPivot(pivots, "high");

  if (!swingHigh) return waiting;

  // The bar that completes the pivot's right-hand side. `findPivots` only
  // emits a pivot when `index < candles.length - pivotLength`, so this bar
  // always exists — it is read, never assumed.
  const confirmedTime = candles[swingHigh.index + config.pivotLength].time;

  for (let i = sweepIndex + 1; i < candles.length; i++) {
    if (candles[i].close > swingHigh.price) {
      return {
        state: "confirmed",
        triggerSwingHigh: swingHigh.price,
        shiftCandleTime: candles[i].time,
        shiftPrice: candles[i].close,
        triggerSwingHighConfirmedTime: confirmedTime,
      };
    }
  }

  return {
    state: "waiting",
    triggerSwingHigh: swingHigh.price,
    shiftCandleTime: null,
    shiftPrice: null,
    // The level is real and dated even while the shift has not fired: a
    // swing high exists once its pivot completes, whether or not price
    // has yet closed above it.
    triggerSwingHighConfirmedTime: confirmedTime,
  };
}
