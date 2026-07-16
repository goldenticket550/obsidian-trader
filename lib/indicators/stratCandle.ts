import type { Candle } from "@/types/candle";

export type StratCandleType = "1" | "2u" | "2d" | "3";

/**
 * Classifies a candle using Rob Smith's "The Strat" typing, relative to
 * the prior candle:
 * - "1" (inside bar): high <= prior high AND low >= prior low
 * - "2u" (directional up): high > prior high AND low >= prior low
 * - "2d" (directional down): low < prior low AND high <= prior high
 * - "3" (outside bar): high > prior high AND low < prior low
 *
 * This is a pure OHLC comparison — no interpretation involved.
 */
export function classifyStratCandle(candle: Candle, prior: Candle): StratCandleType {
  const brokeHigh = candle.high > prior.high;
  const brokeLow = candle.low < prior.low;

  if (brokeHigh && brokeLow) return "3";
  if (brokeHigh) return "2u";
  if (brokeLow) return "2d";
  return "1";
}

export interface StratConfirmationResult {
  passed: boolean;
  pattern: string | null;
  currentType: StratCandleType | null;
  priorType: StratCandleType | null;
}

/**
 * Optional confirmation (per your setup): awards a point when the two most
 * recent candles form a recognized bullish Strat pattern going into the
 * reclaim — either a 2-2 reversal (2d followed by 2u) or an inside bar (1)
 * immediately preceding the current bullish candle. This never gates a
 * green status; it's the same tier as volume/wick confirmations.
 */
export function detectStratConfirmation(candles: Candle[]): StratConfirmationResult {
  if (candles.length < 3) {
    return { passed: false, pattern: null, currentType: null, priorType: null };
  }

  const [twoBack, oneBack, current] = candles.slice(-3);

  const priorType = classifyStratCandle(oneBack, twoBack);
  const currentType = classifyStratCandle(current, oneBack);

  // 2-2 reversal: a down directional bar followed by an up directional bar.
  if (priorType === "2d" && currentType === "2u") {
    return { passed: true, pattern: "2-2 reversal", currentType, priorType };
  }

  // Inside bar setting up a directional break higher.
  if (priorType === "1" && currentType === "2u") {
    return { passed: true, pattern: "1-2u break", currentType, priorType };
  }

  return { passed: false, pattern: null, currentType, priorType };
}
