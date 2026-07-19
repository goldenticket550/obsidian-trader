import type { Candle } from "@/types/candle";
import { MOCK_SCAN_TIME } from "@/lib/scanner/scanService";
import {
  flatSeries,
  fallingSeries,
  risingSeries,
  textbookBullishReclaimSeries,
} from "@/lib/fixtures/candles";

export interface ScanInput {
  symbol: string;
  exchange: string;
  prevClose: number;
  sessionCandles5m: Candle[];
  sessionCandles15m: Candle[];
  dailyCandles: Candle[];
}

const FIVE_MIN_SECONDS = 300;
const FIFTEEN_MIN_SECONDS = 900;

const MOCK_SCAN_TIME_SECONDS = Math.floor(new Date(MOCK_SCAN_TIME).getTime() / 1000);

/**
 * Floors a Unix timestamp (seconds) down to the most recent boundary of the
 * given interval — e.g. flooring 14:32:00 to a 300-second (5-minute)
 * interval gives 14:30:00. Unix epoch 0 is itself a UTC midnight, so every
 * multiple of `intervalSeconds` counted from there lines up with real
 * clock boundaries; this holds for whatever MOCK_SCAN_TIME is set to, not
 * just its current value.
 */
export function floorToIntervalBoundary(epochSeconds: number, intervalSeconds: number): number {
  return epochSeconds - (epochSeconds % intervalSeconds);
}

/**
 * Shifts a candle series so its most recent candle lands exactly on the
 * `intervalSeconds` boundary at or before the deterministic mock "now"
 * (MOCK_SCAN_TIME), preserving the spacing between candles. The fixture
 * generators below all count time from 0, so without this every mock
 * session's latestCandleTime resolved to January 1970. Flooring to the
 * candle's own interval — rather than reusing the raw scan time — matters
 * too: a real 5-minute or 15-minute candle can only ever open on its own
 * boundary, never mid-bar.
 */
function anchorToMockNow(candles: Candle[], intervalSeconds: number): Candle[] {
  if (candles.length === 0) return candles;
  const anchor = floorToIntervalBoundary(MOCK_SCAN_TIME_SECONDS, intervalSeconds);
  const offset = anchor - candles[candles.length - 1].time;
  return candles.map((c) => ({ ...c, time: c.time + offset }));
}

function chain(intervalSeconds: number, ...groups: Candle[][]): Candle[] {
  let t = 0;
  const out: Candle[] = [];
  for (const group of groups) {
    for (const c of group) {
      out.push({ ...c, time: t });
      t += intervalSeconds;
    }
  }
  return out;
}

/**
 * NVDA: a full "textbook" bullish reclaim sequence — decline, sweep,
 * consecutive bullish candles, structure break. Should score highest.
 */
function nvdaSeries5m(): Candle[] {
  return textbookBullishReclaimSeries();
}

/**
 * Same overall shape as the 5m series but compressed into fewer, larger
 * candles — roughly what the same session looks like zoomed out to 15m.
 * Deliberately distinct data from the 5m series so the timeframe toggle
 * shows genuinely different results, not the same numbers twice.
 */
function nvdaSeries15m(): Candle[] {
  const decline = fallingSeries(4, 110, 2.5, 0, FIFTEEN_MIN_SECONDS);
  const lastClose = decline[decline.length - 1].close;
  const rally = risingSeries(4, lastClose, 2.5, 0, FIFTEEN_MIN_SECONDS);
  return chain(FIFTEEN_MIN_SECONDS, decline, rally);
}

/**
 * TSLA: decline and a modest recovery, but only one bullish candle (not
 * enough for the default 3-candle consecutive-bullish rule) and no sweep
 * or structure shift yet. Should land as "developing" (yellow).
 */
function tslaSeries5m(): Candle[] {
  const decline = fallingSeries(10, 275, 1.4, 0, FIVE_MIN_SECONDS); // ~5.6% decline
  const lastClose = decline[decline.length - 1].close;
  const smallBounce = risingSeries(2, lastClose, 0.8, 0, FIVE_MIN_SECONDS);
  return chain(FIVE_MIN_SECONDS, decline, smallBounce);
}

function tslaSeries15m(): Candle[] {
  const decline = fallingSeries(4, 275, 3.2, 0, FIFTEEN_MIN_SECONDS);
  const lastClose = decline[decline.length - 1].close;
  const smallBounce = risingSeries(1, lastClose, 1.5, 0, FIFTEEN_MIN_SECONDS);
  return chain(FIFTEEN_MIN_SECONDS, decline, smallBounce);
}

/**
 * AMD: a shallow decline that doesn't clear the significant-decline
 * threshold, and no real recovery. Should stay red.
 */
function amdSeries5m(): Candle[] {
  return fallingSeries(15, 143, 0.15, 0, FIVE_MIN_SECONDS); // well under the 2% decline threshold
}

function amdSeries15m(): Candle[] {
  return fallingSeries(6, 143, 0.3, 0, FIFTEEN_MIN_SECONDS);
}

/** AAPL: a flat, uneventful session. Should stay red. */
function aaplSeries5m(): Candle[] {
  return flatSeries(15, 214.5, 0, FIVE_MIN_SECONDS);
}

function aaplSeries15m(): Candle[] {
  return flatSeries(6, 214.5, 0, FIFTEEN_MIN_SECONDS);
}

function dailyUptrend(startPrice: number): Candle[] {
  return risingSeries(20, startPrice, startPrice * 0.002, 0);
}

export const mockScanInputs: ScanInput[] = [
  {
    symbol: "NVDA",
    exchange: "NASDAQ",
    prevClose: 139.1,
    sessionCandles5m: anchorToMockNow(nvdaSeries5m(), FIVE_MIN_SECONDS),
    sessionCandles15m: anchorToMockNow(nvdaSeries15m(), FIFTEEN_MIN_SECONDS),
    dailyCandles: dailyUptrend(120),
  },
  {
    symbol: "TSLA",
    exchange: "NASDAQ",
    prevClose: 276.6,
    sessionCandles5m: anchorToMockNow(tslaSeries5m(), FIVE_MIN_SECONDS),
    sessionCandles15m: anchorToMockNow(tslaSeries15m(), FIFTEEN_MIN_SECONDS),
    dailyCandles: dailyUptrend(250),
  },
  {
    symbol: "AMD",
    exchange: "NASDAQ",
    prevClose: 142.7,
    sessionCandles5m: anchorToMockNow(amdSeries5m(), FIVE_MIN_SECONDS),
    sessionCandles15m: anchorToMockNow(amdSeries15m(), FIFTEEN_MIN_SECONDS),
    dailyCandles: dailyUptrend(135),
  },
  {
    symbol: "AAPL",
    exchange: "NASDAQ",
    prevClose: 215.4,
    sessionCandles5m: anchorToMockNow(aaplSeries5m(), FIVE_MIN_SECONDS),
    sessionCandles15m: anchorToMockNow(aaplSeries15m(), FIFTEEN_MIN_SECONDS),
    dailyCandles: dailyUptrend(205),
  },
];
