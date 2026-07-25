import type { Candle } from "@/types/candle";

export type PressureLabel = "strong_buy_pressure" | "strong_sell_pressure" | "neutral";

export interface PressureResult {
  label: PressureLabel;
  bodyPercent: number;
  relativeVolume: number;
  closeNearExtreme: boolean;
}

/**
 * bodyPercent = how much of the candle's total range is "body" (the
 * open-to-close move) rather than wicks — a high body percent means a
 * decisive, one-directional candle rather than an indecisive one.
 */
export function calculateBodyPercent(candle: Candle): number {
  const range = candle.high - candle.low;
  if (range === 0) return 0;
  return Math.abs(candle.close - candle.open) / range;
}

/**
 * Classifies a candle's directional conviction using body size, close
 * position within its range, and relative volume — never claims to know
 * WHO is trading (no "institutional buying" language, per spec: volume
 * alone cannot prove who caused a move). This is a description of the
 * candle's shape and participation level, not a claim about intent.
 */
export function classifyPressure(
  candle: Candle,
  averageVolume: number,
  minBodyPercent = 0.6,
  minRelativeVolume = 1.5
): PressureResult {
  const bodyPercent = calculateBodyPercent(candle);
  const relativeVolume = averageVolume === 0 ? 0 : candle.volume / averageVolume;
  const range = candle.high - candle.low;

  const isBullish = candle.close > candle.open;
  const isBearish = candle.close < candle.open;

  // "Close near the extreme" = close sits in the outer 25% of the
  // candle's range, in the direction of the move — a bullish candle
  // closing near its high, or a bearish candle closing near its low.
  const closeNearExtreme =
    range > 0 &&
    ((isBullish && candle.high - candle.close <= range * 0.25) ||
      (isBearish && candle.close - candle.low <= range * 0.25));

  const meetsThreshold = bodyPercent >= minBodyPercent && relativeVolume >= minRelativeVolume;

  let label: PressureLabel = "neutral";
  if (meetsThreshold && closeNearExtreme) {
    if (isBullish) label = "strong_buy_pressure";
    if (isBearish) label = "strong_sell_pressure";
  }

  return { label, bodyPercent, relativeVolume, closeNearExtreme };
}
