import type { Candle } from "@/types/candle";

/** Builds a candle with sensible defaults, letting tests override only what matters. */
export function makeCandle(overrides: Partial<Candle> & { time: number }): Candle {
  return {
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1000,
    ...overrides,
  };
}

/** A flat, low-volatility series — useful as a "nothing happening" baseline. */
export function flatSeries(count: number, price = 100, startTime = 0, intervalSeconds = 300): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: startTime + i * intervalSeconds,
    open: price,
    high: price + 0.1,
    low: price - 0.1,
    close: price,
    volume: 1000,
  }));
}

/** A steadily rising series, useful for EMA/SMA reclaim tests. */
export function risingSeries(
  count: number,
  startPrice = 100,
  step = 0.5,
  startTime = 0,
  intervalSeconds = 300
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price + step;
    candles.push({
      time: startTime + i * intervalSeconds,
      open,
      close,
      high: Math.max(open, close) + 0.1,
      low: Math.min(open, close) - 0.1,
      volume: 1000,
    });
    price = close;
  }
  return candles;
}

/** A falling series, mirror of risingSeries. */
export function fallingSeries(
  count: number,
  startPrice = 100,
  step = 0.5,
  startTime = 0,
  intervalSeconds = 300
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = price - step;
    candles.push({
      time: startTime + i * intervalSeconds,
      open,
      close,
      high: Math.max(open, close) + 0.1,
      low: Math.min(open, close) - 0.1,
      volume: 1000,
    });
    price = close;
  }
  return candles;
}

/**
 * A full "textbook" bullish reclaim sequence: decline, session low,
 * recovery, 3 consecutive bullish candles, a sweep-and-reclaim, a
 * structure-shift break, and an EMA reclaim — built so every detector in
 * the chain should fire on this fixture. Used as an integration fixture
 * for the scorer test.
 */
export function textbookBullishReclaimSeries(): Candle[] {
  const candles: Candle[] = [];
  let t = 0;
  const push = (c: Omit<Candle, "time">) => {
    candles.push({ time: t, ...c });
    t += 300;
  };

  // Decline from open ($110) down toward session low (~$100), 10 candles.
  let price = 110;
  for (let i = 0; i < 10; i++) {
    const close = price - 1;
    push({ open: price, close, high: price + 0.2, low: close - 0.2, volume: 1000 });
    price = close;
  }

  // Sweep below the developing low then reclaim it same/next candle.
  push({ open: 100, close: 99.5, high: 100.2, low: 98.8, volume: 1500 }); // sweep below ~99
  push({ open: 99.5, close: 100.6, high: 100.8, low: 99.4, volume: 1800 }); // reclaim above 100

  // 3 consecutive bullish candles with higher highs/lows.
  push({ open: 100.6, close: 101.4, high: 101.6, low: 100.5, volume: 1600 });
  push({ open: 101.4, close: 102.3, high: 102.5, low: 101.3, volume: 1700 });
  push({ open: 102.3, close: 103.3, high: 103.5, low: 102.2, volume: 2000 });

  // Break above the pre-decline swing high to trigger a structure shift
  // and close above a fast-moving EMA.
  push({ open: 103.3, close: 104.5, high: 104.7, low: 103.2, volume: 2500 });
  push({ open: 104.5, close: 105.5, high: 105.7, low: 104.4, volume: 2600 });

  return candles;
}
