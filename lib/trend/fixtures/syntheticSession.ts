import type { Candle } from "@/types/candle";

/**
 * DETERMINISTIC SYNTHETIC SESSIONS for replay and tests.
 *
 * IMPORTANT: these are SYNTHETIC price paths, not recorded market data.
 * They are shaped to exercise the detector's lifecycle — weakness, a
 * non-session-low higher low, stabilisation, EMA/VWAP recovery, a
 * premarket-high break, continuation and then failure — and nothing
 * here should be read as what any real symbol actually did. The replay
 * tool labels its data source explicitly for exactly this reason.
 *
 * 1-minute bars are generated first and 5-minute bars are AGGREGATED
 * from them, so the two timeframes cannot disagree the way two
 * independently hand-written series would.
 */

export interface SyntheticSession {
  symbol: string;
  tradingDate: string;
  /**
   * FALSE for recorded market data, true for a generated path. Always
   * surfaced by the replay tool so a shaped fixture can never be mistaken
   * for what a symbol actually did.
   */
  synthetic: boolean;
  /**
   * Same-feed median volume for the 5m bar at each Eastern minute-of-day.
   * Preferred over the scalar baseline when present: volume varies
   * enormously across the morning, and a flat baseline would call every
   * 9:35 bar a shock.
   */
  fiveMinuteBaselineByMinute?: Record<number, number>;
  oneMinute: Candle[];
  fiveMinute: Candle[];
  daily: Candle[];
  premarketHigh: number;
  premarketLow: number;
  previousDayHigh: number;
  previousDayLow: number;
  /** Median same-feed volume for this time of day, per 1m bar. */
  oneMinuteVolumeBaseline: number;
  /** Median same-feed volume for this time of day, per 5m bar. */
  fiveMinuteVolumeBaseline: number;
}

/** 9:30 AM ET on the given date, in epoch seconds (EDT = UTC-4). */
export function regularOpenEpoch(tradingDate: string): number {
  return Math.floor(Date.parse(`${tradingDate}T13:30:00Z`) / 1000);
}

interface Leg {
  minutes: number;
  /** Total price change across the leg. */
  delta: number;
  /** Volume multiple versus the baseline for bars in this leg. */
  volumeMultiple: number;
  /** Extra wick beyond the body, as a fraction of |delta| per bar. */
  wick?: number;
}

function buildOneMinute(
  start: number,
  openPrice: number,
  legs: Leg[],
  baselineVolume: number
): Candle[] {
  const candles: Candle[] = [];
  let price = openPrice;
  let minute = 0;

  for (const leg of legs) {
    const step = leg.delta / leg.minutes;
    for (let i = 0; i < leg.minutes; i++) {
      const open = price;
      const close = price + step;
      const body = Math.abs(close - open);
      const wick = (leg.wick ?? 0.35) * (body === 0 ? 0.02 : body);
      candles.push({
        time: start + minute * 60,
        open: round(open),
        high: round(Math.max(open, close) + wick),
        low: round(Math.min(open, close) - wick),
        close: round(close),
        volume: Math.round(baselineVolume * leg.volumeMultiple),
      });
      price = close;
      minute += 1;
    }
  }
  return candles;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Aggregates 1m candles into 5m candles. Only whole buckets are kept. */
export function aggregateToFiveMinute(oneMinute: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + 5 <= oneMinute.length; i += 5) {
    const bucket = oneMinute.slice(i, i + 5);
    out.push({
      time: bucket[0].time,
      open: bucket[0].open,
      high: Math.max(...bucket.map((c) => c.high)),
      low: Math.min(...bucket.map((c) => c.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((a, c) => a + c.volume, 0),
    });
  }
  return out;
}

function flatDaily(tradingDate: string, closes: number[]): Candle[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const end = Date.parse(`${tradingDate}T20:00:00Z`);
  return closes.map((close, i) => {
    const t = Math.floor((end - (closes.length - 1 - i) * dayMs) / 1000);
    return {
      time: t,
      open: close,
      high: round(close * 1.01),
      low: round(close * 0.99),
      close,
      volume: 1_000_000,
    };
  });
}

/**
 * The canonical bullish lifecycle session.
 *
 * Shape, in order:
 *   1. opening weakness down to the session low
 *   2. a bounce
 *   3. a pullback that holds ABOVE the session low — the higher low
 *   4. a quiet hold (contracting range) while volume builds
 *   5. a push through the premarket high on rising volume
 *   6. continuation far enough to cross percentage milestones
 *   7. extension away from the 5m 9 EMA, then a break back down
 */
export function bullishLifecycleSession(
  symbol: string,
  tradingDate: string,
  basePrice = 100
): SyntheticSession {
  const start = regularOpenEpoch(tradingDate);
  const baselineVolume = 10_000;

  const legs: Leg[] = [
    // 1. Opening weakness: 100.00 -> 97.00 over 20 minutes.
    { minutes: 20, delta: -3.0, volumeMultiple: 1.0 },
    // 2. Bounce: 97.00 -> 98.60.
    { minutes: 10, delta: 1.6, volumeMultiple: 1.0 },
    // 3. Pullback to a HIGHER low: 98.60 -> 97.80 (above the 97.00 low).
    { minutes: 10, delta: -0.8, volumeMultiple: 0.9 },
    // 4. Quiet hold, contracting: 97.80 -> 98.00.
    { minutes: 10, delta: 0.2, volumeMultiple: 1.1, wick: 0.15 },
    // 5. Push up toward, but NOT through, the premarket high (103.00),
    //    so Trend Watch (TAP 1) is earned BEFORE the level break (TAP 2).
    { minutes: 20, delta: 3.4, volumeMultiple: 2.2, wick: 0.2 },
    // 6. Continuation: 101.40 -> 108.00 (crosses 3%, 5%, 7% and 10%).
    { minutes: 30, delta: 6.6, volumeMultiple: 2.0, wick: 0.2 },
    // 7. Failure: back down through the origin's invalidation.
    { minutes: 25, delta: -11.0, volumeMultiple: 1.6 },
  ];

  const oneMinute = buildOneMinute(start, basePrice, legs, baselineVolume);
  const fiveMinute = aggregateToFiveMinute(oneMinute);

  return {
    symbol,
    tradingDate,
    synthetic: true,
    oneMinute,
    fiveMinute,
    daily: flatDaily(tradingDate, [96, 96.5, 97, 97.5, 98, 98.5, 99, 99.2, 99.5, 99.8,
      100, 100.2, 100.4, 100.6, 100.8, 101, 101.2, 101.4, 101.6, 101.8]),
    premarketHigh: 103.0,
    premarketLow: 99.0,
    previousDayHigh: 104.0,
    previousDayLow: 96.0,
    oneMinuteVolumeBaseline: baselineVolume,
    fiveMinuteVolumeBaseline: baselineVolume * 5,
  };
}

/**
 * The bearish mirror of the same session, reflected about `basePrice`.
 * Used to prove the two directions are genuinely one implementation.
 */
export function bearishLifecycleSession(
  symbol: string,
  tradingDate: string,
  basePrice = 100
): SyntheticSession {
  const bull = bullishLifecycleSession(symbol, tradingDate, basePrice);
  const mirrorCandle = (c: Candle): Candle => ({
    time: c.time,
    open: round(2 * basePrice - c.open),
    high: round(2 * basePrice - c.low),
    low: round(2 * basePrice - c.high),
    close: round(2 * basePrice - c.close),
    volume: c.volume,
  });

  return {
    ...bull,
    oneMinute: bull.oneMinute.map(mirrorCandle),
    fiveMinute: bull.fiveMinute.map(mirrorCandle),
    daily: bull.daily.map(mirrorCandle),
    premarketHigh: round(2 * basePrice - bull.premarketLow),
    premarketLow: round(2 * basePrice - bull.premarketHigh),
    previousDayHigh: round(2 * basePrice - bull.previousDayLow),
    previousDayLow: round(2 * basePrice - bull.previousDayHigh),
  };
}
