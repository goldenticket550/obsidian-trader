import type { Candle } from "@/types/candle";
import type { TrendDirection } from "./types";

/**
 * Bullish and bearish as ONE parameterised implementation.
 *
 * Every directional comparison in the scanner goes through here, so the
 * two directions cannot drift apart. A bug fixed for one is fixed for
 * both by construction, and a mirror test genuinely tests the mirror
 * rather than a second hand-written copy.
 */
export interface DirectionOps {
  direction: TrendDirection;
  /** Is `value` in the favourable direction relative to `reference`? */
  beyond(value: number, reference: number): boolean;
  /** Is `value` in the ADVERSE direction relative to `reference`? */
  adverse(value: number, reference: number): boolean;
  /** The favourable extreme of a candle (high for bullish). */
  extreme(candle: Candle): number;
  /** The adverse extreme of a candle (low for bullish). */
  adverseExtreme(candle: Candle): number;
  /** Signed distance travelled in the favourable direction. */
  gain(from: number, to: number): number;
  /** Move `price` by `offset` in the ADVERSE direction. */
  adverseOffset(price: number, offset: number): number;
  /** Close location within its own range, 1 = closed at favourable end. */
  closeStrength(candle: Candle): number | null;
  /** More favourable of two values. */
  best(a: number, b: number): number;
}

const BULLISH: DirectionOps = {
  direction: "bullish",
  beyond: (v, r) => v > r,
  adverse: (v, r) => v < r,
  extreme: (c) => c.high,
  adverseExtreme: (c) => c.low,
  gain: (from, to) => to - from,
  adverseOffset: (p, o) => p - o,
  closeStrength: (c) => {
    const range = c.high - c.low;
    // A zero-range candle has no close location. Unavailable, not 0 or 1.
    if (!(range > 0)) return null;
    return (c.close - c.low) / range;
  },
  best: (a, b) => Math.max(a, b),
};

const BEARISH: DirectionOps = {
  direction: "bearish",
  beyond: (v, r) => v < r,
  adverse: (v, r) => v > r,
  extreme: (c) => c.low,
  adverseExtreme: (c) => c.high,
  gain: (from, to) => from - to,
  adverseOffset: (p, o) => p + o,
  closeStrength: (c) => {
    const range = c.high - c.low;
    if (!(range > 0)) return null;
    return (c.high - c.close) / range;
  },
  best: (a, b) => Math.min(a, b),
};

export function opsFor(direction: TrendDirection): DirectionOps {
  return direction === "bullish" ? BULLISH : BEARISH;
}

export { BULLISH, BEARISH };
