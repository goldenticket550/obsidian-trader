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

const MOCK_SESSION_END_SECONDS = Math.floor(new Date(MOCK_SCAN_TIME).getTime() / 1000);

/**
 * Shifts a candle series so its most recent candle lands exactly at the
 * deterministic mock "now" (MOCK_SCAN_TIME), preserving the spacing
 * between candles. The fixture generators below all count time from 0,
 * so without this every mock session's latestCandleTime resolved to
 * January 1970 — this anchors it to a realistic date instead.
 */
function anchorToMockNow(candles: Candle[]): Candle[] {
  if (candles.length === 0) return candles;
  const offset = MOCK_SESSION_END_SECONDS - candles[candles.length - 1].time;
  return candles.map((c) => ({ ...c, time: c.time + offset }));
}

function chain(...groups: Candle[][]): Candle[] {
  let t = 0;
  const out: Candle[] = [];
  for (const group of groups) {
    for (const c of group) {
      out.push({ ...c, time: t });
      t += 300;
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
  const decline = fallingSeries(4, 110, 2.5);
  const lastClose = decline[decline.length - 1].close;
  const rally = risingSeries(4, lastClose, 2.5);
  return chain(decline, rally);
}

/**
 * TSLA: decline and a modest recovery, but only one bullish candle (not
 * enough for the default 3-candle consecutive-bullish rule) and no sweep
 * or structure shift yet. Should land as "developing" (yellow).
 */
function tslaSeries5m(): Candle[] {
  const decline = fallingSeries(10, 275, 1.4); // ~5.6% decline
  const lastClose = decline[decline.length - 1].close;
  const smallBounce = risingSeries(2, lastClose, 0.8);
  return chain(decline, smallBounce);
}

function tslaSeries15m(): Candle[] {
  const decline = fallingSeries(4, 275, 3.2);
  const lastClose = decline[decline.length - 1].close;
  const smallBounce = risingSeries(1, lastClose, 1.5);
  return chain(decline, smallBounce);
}

/**
 * AMD: a shallow decline that doesn't clear the significant-decline
 * threshold, and no real recovery. Should stay red.
 */
function amdSeries5m(): Candle[] {
  return fallingSeries(15, 143, 0.15); // well under the 2% decline threshold
}

function amdSeries15m(): Candle[] {
  return fallingSeries(6, 143, 0.3);
}

/** AAPL: a flat, uneventful session. Should stay red. */
function aaplSeries5m(): Candle[] {
  return flatSeries(15, 214.5);
}

function aaplSeries15m(): Candle[] {
  return flatSeries(6, 214.5);
}

function dailyUptrend(startPrice: number): Candle[] {
  return risingSeries(20, startPrice, startPrice * 0.002, 0);
}

export const mockScanInputs: ScanInput[] = [
  {
    symbol: "NVDA",
    exchange: "NASDAQ",
    prevClose: 139.1,
    sessionCandles5m: anchorToMockNow(nvdaSeries5m()),
    sessionCandles15m: anchorToMockNow(nvdaSeries15m()),
    dailyCandles: dailyUptrend(120),
  },
  {
    symbol: "TSLA",
    exchange: "NASDAQ",
    prevClose: 276.6,
    sessionCandles5m: anchorToMockNow(tslaSeries5m()),
    sessionCandles15m: anchorToMockNow(tslaSeries15m()),
    dailyCandles: dailyUptrend(250),
  },
  {
    symbol: "AMD",
    exchange: "NASDAQ",
    prevClose: 142.7,
    sessionCandles5m: anchorToMockNow(amdSeries5m()),
    sessionCandles15m: anchorToMockNow(amdSeries15m()),
    dailyCandles: dailyUptrend(135),
  },
  {
    symbol: "AAPL",
    exchange: "NASDAQ",
    prevClose: 215.4,
    sessionCandles5m: anchorToMockNow(aaplSeries5m()),
    sessionCandles15m: anchorToMockNow(aaplSeries15m()),
    dailyCandles: dailyUptrend(205),
  },
];
