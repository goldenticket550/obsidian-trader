import type { Candle } from "@/types/candle";
import { calculateEma, calculateSma, latestValid } from "@/lib/indicators/movingAverages";
import { calculateVwap } from "@/lib/indicators/vwap";
import { calculateAtr } from "@/lib/indicators/atr";
import { findPivots } from "@/lib/indicators/pivots";
import { getSessionTypeForTimestamp } from "@/lib/market-data/session";
import { opsFor } from "./direction";
import type {
  CloseTransitionFact,
  KeyLevel,
  Measured,
  MovingAverageFact,
  RelativeVolumeFact,
  TrendDirection,
  TrendFacts,
  TrendOrigin,
  VwapFact,
} from "./types";

/**
 * CURRENT TREND FACTS — measurements from COMPLETED candles only.
 *
 * Every function here is causal: it is handed a series that has already
 * been trimmed to completed bars, and it never indexes past the end. No
 * function returns a substitute for a value it could not compute — the
 * answer is `null` and the caller says "unavailable".
 *
 * Existing indicator helpers are reused as-is. Where an old helper
 * answers a DIFFERENT question (e.g. `detectVwapReclaim` asks "did a
 * reclaim happen", not "where is price now"), a small adapter lives here
 * rather than the old helper being bent to a new meaning.
 */

/** How many completed bars back the slope comparison looks. */
export const SLOPE_LOOKBACK_BARS = 3;

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/**
 * `above` and `rising` are INDEPENDENT facts.
 *
 * Being above the EMA does not require a historical below-to-above
 * cross — that is `emaReclaim`, a different question the legacy detector
 * already answers. Reporting "above" only after a cross is what made the
 * old scanner miss names that gapped up and never traded below.
 */
export function movingAverageFact(
  series: number[],
  close: Measured<number>,
  ops: ReturnType<typeof opsFor>
): MovingAverageFact {
  const value = latestValid(series);
  if (value === null || close === null) {
    return { value, above: null, rising: null };
  }

  // Slope needs a value SLOPE_LOOKBACK_BARS completed bars back.
  const priorIndex = series.length - 1 - SLOPE_LOOKBACK_BARS;
  const prior = priorIndex >= 0 ? series[priorIndex] : undefined;
  const rising =
    prior !== undefined && Number.isFinite(prior) ? ops.beyond(value, prior) : null;

  return { value, above: ops.beyond(close, value), rising };
}

/**
 * Close-to-close transitions.
 *
 * N transitions require N+1 completed candles. Counting N candles as N
 * transitions is an off-by-one that silently makes every threshold one
 * candle easier to reach.
 */
export function closeTransitions(
  completed: readonly Candle[],
  transitions: number,
  direction: TrendDirection
): CloseTransitionFact {
  const needed = transitions + 1;
  if (completed.length < needed) {
    return { transitions: 0, favourable: 0, measurable: false };
  }

  const ops = opsFor(direction);
  const window = completed.slice(-needed);
  let favourable = 0;
  for (let i = 1; i < window.length; i++) {
    if (ops.beyond(window[i].close, window[i - 1].close)) favourable += 1;
  }
  return { transitions, favourable, measurable: true };
}

/** Green and red candle counts, reported separately from transitions. */
export function candleColourCounts(
  completed: readonly Candle[],
  lookback: number
): { green: Measured<number>; red: Measured<number> } {
  if (completed.length === 0) return { green: null, red: null };
  const window = completed.slice(-lookback);
  let green = 0;
  let red = 0;
  for (const c of window) {
    if (c.close > c.open) green += 1;
    else if (c.close < c.open) red += 1;
  }
  return { green, red };
}

/**
 * VWAP position plus the most recent CAUSAL reclaim.
 *
 * The reclaim scan walks forward and records the last bar that closed
 * across VWAP from the wrong side. It never looks beyond the series it
 * was given, so replaying bar-by-bar produces the same answer the live
 * scan produced at that bar.
 */
export function vwapFact(
  sessionCandles: readonly Candle[],
  close: Measured<number>,
  direction: TrendDirection
): VwapFact {
  if (sessionCandles.length === 0) {
    return { value: null, above: null, reclaimedAt: null };
  }
  const ops = opsFor(direction);
  const series = calculateVwap(sessionCandles as Candle[]);
  const value = latestValid(series);
  if (value === null || close === null) {
    return { value, above: null, reclaimedAt: null };
  }

  let reclaimedAt: string | null = null;
  for (let i = 1; i < sessionCandles.length; i++) {
    const here = series[i];
    const prev = series[i - 1];
    if (!Number.isFinite(here) || !Number.isFinite(prev)) continue;
    const wasWrongSide = !ops.beyond(sessionCandles[i - 1].close, prev);
    const isRightSide = ops.beyond(sessionCandles[i].close, here);
    if (wasWrongSide && isRightSide) reclaimedAt = iso(sessionCandles[i].time);
  }

  return { value, above: ops.beyond(close, value), reclaimedAt };
}

/**
 * Causally confirmed pivots only.
 *
 * `findPivots` is symmetric: a pivot centred at index i needs `length`
 * bars on each side, so it is not knowable until bar i + length has
 * completed. Anything nearer the end of the series is excluded rather
 * than reported as a level that existed earlier than it did.
 */
export function confirmedPivotLevels(
  completed: readonly Candle[],
  pivotLength: number,
  direction: TrendDirection
): KeyLevel[] {
  if (completed.length < pivotLength * 2 + 1) return [];
  const wanted = direction === "bullish" ? "high" : "low";
  return findPivots(completed as Candle[], pivotLength)
    .filter((p) => p.type === wanted)
    .filter((p) => p.index + pivotLength <= completed.length - 1)
    .map((p) => ({
      name: wanted === "high" ? "Pivot high" : "Pivot low",
      price: p.price,
      availableFrom: iso(completed[p.index + pivotLength].time),
    }));
}

/**
 * The nearest key level still AHEAD of price in the trade's direction.
 * Levels already passed are not "next" and are excluded.
 */
export function nearestLevelAhead(
  levels: readonly KeyLevel[],
  price: Measured<number>,
  direction: TrendDirection
): { level: KeyLevel | null; distancePct: Measured<number> } {
  if (price === null || levels.length === 0) return { level: null, distancePct: null };
  const ops = opsFor(direction);

  let best: KeyLevel | null = null;
  for (const level of levels) {
    if (!Number.isFinite(level.price)) continue;
    if (!ops.beyond(level.price, price)) continue;
    if (best === null || Math.abs(level.price - price) < Math.abs(best.price - price)) {
      best = level;
    }
  }
  if (best === null) return { level: null, distancePct: null };
  return {
    level: best,
    distancePct: price === 0 ? null : (Math.abs(best.price - price) / price) * 100,
  };
}

/** Percent move from the LOCKED origin, in the setup's direction. */
export function moveFromOrigin(
  origin: TrendOrigin | null,
  price: Measured<number>,
  atr: Measured<number>,
  direction: TrendDirection
): { dollars: Measured<number>; pct: Measured<number>; atrs: Measured<number> } {
  if (origin === null || price === null) return { dollars: null, pct: null, atrs: null };
  const ops = opsFor(direction);
  const dollars = ops.gain(origin.price, price);
  const pct = origin.price === 0 ? null : (dollars / origin.price) * 100;
  const atrs = atr !== null && atr > 0 ? dollars / atr : null;
  return { dollars, pct, atrs };
}

export interface TrendFactsInput {
  direction: TrendDirection;
  /** Completed 1m candles for the session, ascending. */
  oneMinute: readonly Candle[];
  /** Completed 5m candles for the session, ascending. */
  fiveMinute: readonly Candle[];
  /** Completed daily candles, ascending. Higher-timeframe context only. */
  daily: readonly Candle[];
  /** Key levels already resolved by the caller, each with availability. */
  levels: readonly KeyLevel[];
  relativeVolume: RelativeVolumeFact;
  relativeToBenchmark: Measured<number>;
  relativeToSector: Measured<number>;
  origin: TrendOrigin | null;
  transitions: number;
  pivotLength: number;
}

/** Assembles every current fact. Pure: no clock, no I/O, no mutation. */
export function computeTrendFacts(input: TrendFactsInput): TrendFacts {
  const ops = opsFor(input.direction);
  const { fiveMinute, oneMinute, daily } = input;

  const price = fiveMinute.length > 0 ? fiveMinute[fiveMinute.length - 1].close : null;

  const atrSeries = fiveMinute.length > 0 ? calculateAtr(fiveMinute as Candle[], 14) : [];
  const atr5m = latestValid(atrSeries);

  const oneMinuteEma9 = movingAverageFact(
    oneMinute.length > 0 ? calculateEma(oneMinute as Candle[], 9) : [],
    oneMinute.length > 0 ? oneMinute[oneMinute.length - 1].close : null,
    ops
  );
  const fiveMinuteEma9 = movingAverageFact(
    fiveMinute.length > 0 ? calculateEma(fiveMinute as Candle[], 9) : [],
    price,
    ops
  );
  const fiveMinuteSma20 = movingAverageFact(
    fiveMinute.length > 0 ? calculateSma(fiveMinute as Candle[], 20) : [],
    price,
    ops
  );
  // Higher-timeframe context. Deliberately a separate field from the
  // 5-minute 20 SMA — they are different questions about different data.
  const dailySma20 = movingAverageFact(
    daily.length > 0 ? calculateSma(daily as Candle[], 20) : [],
    price,
    ops
  );

  const vwap = vwapFact(fiveMinute, price, input.direction);

  const pivots = confirmedPivotLevels(fiveMinute, input.pivotLength, input.direction);
  const levels = [...input.levels, ...pivots];

  const { level: nearestLevel, distancePct } = nearestLevelAhead(
    levels,
    price,
    input.direction
  );

  const colours = candleColourCounts(fiveMinute, input.transitions + 1);
  const move = moveFromOrigin(input.origin, price, atr5m, input.direction);

  const atrFromFiveMinuteEma =
    fiveMinuteEma9.value !== null && price !== null && atr5m !== null && atr5m > 0
      ? Math.abs(price - fiveMinuteEma9.value) / atr5m
      : null;

  return {
    price,
    oneMinuteEma9,
    fiveMinuteEma9,
    fiveMinuteSma20,
    dailySma20,
    vwap,
    atr5m,
    levels,
    closeTransitions: closeTransitions(fiveMinute, input.transitions, input.direction),
    greenCandles: colours.green,
    redCandles: colours.red,
    relativeVolume: input.relativeVolume,
    relativeToBenchmark: input.relativeToBenchmark,
    relativeToSector: input.relativeToSector,
    fromOriginDollars: move.dollars,
    fromOriginPct: move.pct,
    fromOriginAtr: move.atrs,
    nearestLevel,
    distanceToNearestLevelPct: distancePct,
    atrFromFiveMinuteEma,
  };
}

/**
 * The opening range: high/low of the first `minutes` of the REGULAR
 * session.
 *
 * Causal in two ways. It is built only from regular-session bars whose
 * window has already CLOSED, so it cannot be read before it exists; and
 * `availableFrom` records the moment it became knowable, so a consumer
 * cannot treat it as a level that was there at the open.
 *
 * Returns null until the window has fully completed — a partial opening
 * range is not an opening range.
 */
export function openingRangeLevels(
  fiveMinute: readonly Candle[],
  minutes: number
): { high: KeyLevel; low: KeyLevel } | null {
  const regular = fiveMinute.filter(
    (c) => getSessionTypeForTimestamp(new Date(c.time * 1000)) === "regular"
  );
  if (regular.length === 0) return null;

  const openAt = regular[0].time;
  const windowEnd = openAt + minutes * 60;
  const inWindow = regular.filter((c) => c.time < windowEnd);
  if (inWindow.length === 0) return null;

  // The window must have CLOSED: the last bar in it must have finished,
  // which requires a bar at or beyond the window end to exist.
  const closed = regular.some((c) => c.time >= windowEnd);
  if (!closed) return null;

  const availableFrom = iso(windowEnd);
  return {
    high: {
      name: "Opening-range high",
      price: Math.max(...inWindow.map((c) => c.high)),
      availableFrom,
    },
    low: {
      name: "Opening-range low",
      price: Math.min(...inWindow.map((c) => c.low)),
      availableFrom,
    },
  };
}

/**
 * Chooses the TAP 2 continuation level for this setup.
 *
 * The premarket level is TAP 2 only while it is genuinely still OVERHEAD
 * in the regular session. On a gap day price opens beyond it, so it is
 * not an unbroken continuation level at all and waiting for a break of
 * it means waiting forever — observed on 2026-08-03, where both NVDA and
 * GOOGL opened above their premarket high and TAP 2 was unreachable.
 *
 * In that case the opening-range level takes over. Only these two may
 * ever be TAP 2; every other level is a separate `key_level_break`.
 *
 * Returns null while no level qualifies yet, which is honest rather than
 * falling back to something that was never overhead.
 */
export function selectTap2Level(args: {
  fiveMinute: readonly Candle[];
  premarket: KeyLevel | null;
  direction: TrendDirection;
  openingRangeMinutes: number;
}): KeyLevel | null {
  const { fiveMinute, premarket, direction } = args;
  const ops = opsFor(direction);

  const regular = fiveMinute.filter(
    (c) => getSessionTypeForTimestamp(new Date(c.time * 1000)) === "regular"
  );
  if (regular.length === 0) return premarket;

  // The premarket level is TAP 2 only while it is genuinely UNBROKEN.
  //
  // Two ways it stops being an overhead continuation level, and both
  // must count. It can be gapped over at the open — judged from the
  // session OPEN, fixed at 9:30 and never revised. Or it can be taken
  // out intraday BEFORE a setup ever became actionable, which is what
  // real NVDA did on 2026-08-03: it opened below 199.20, crossed it
  // around 10:00, and TAP 1 only arrived at 10:40. Checking the open
  // alone left TAP 2 pointing at a level that had already gone.
  //
  // Causal: only completed bars up to this evaluation are considered, so
  // replaying bar-by-bar switches levels at the same bar the live scan
  // would have.
  const sessionOpen = regular[0].open;
  const gappedOver = premarket !== null && ops.beyond(sessionOpen, premarket.price);
  // PRIOR closes only. Including the current bar would mean the very
  // candle that breaks the level also disqualifies it, so TAP 2 could
  // never fire on the break itself.
  const brokenIntraday =
    premarket !== null &&
    regular.slice(0, -1).some((c) => ops.beyond(c.close, premarket.price));
  const premarketStillOverhead = premarket !== null && !gappedOver && !brokenIntraday;

  if (premarketStillOverhead) return premarket;

  const openingRange = openingRangeLevels(fiveMinute, args.openingRangeMinutes);
  if (openingRange === null) return null;
  return direction === "bullish" ? openingRange.high : openingRange.low;
}
