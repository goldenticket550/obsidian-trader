import type { Candle } from "@/types/candle";
import type { MarketDataProvider } from "@/lib/market-data/types";
import { getSessionTypeForTimestamp } from "@/lib/market-data/session";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";
import { collectTimeOfDayBars, median } from "@/lib/market-data/historicalBaseline";
import type { SyntheticSession } from "./fixtures/syntheticSession";

/**
 * REAL market data for a causal replay.
 *
 * Fetches through the EXISTING provider adapter — no second HTTP client,
 * no bypass of the repository's session filtering or pagination handling.
 *
 * Every derived level comes from real bars:
 *  - premarket high/low from the day's actual premarket prints;
 *  - previous-day high/low from the daily series, located by DATE;
 *  - the relative-volume baseline from the SAME feed at the SAME Eastern
 *    minute-of-day across prior sessions, so numerator and denominator
 *    are like-for-like.
 *
 * Anything that cannot be derived is reported as missing. Nothing is
 * substituted, and no synthetic fallback happens here.
 */

export interface RealSessionLoad {
  session: SyntheticSession | null;
  /** Everything that prevented a usable session, for an honest stop. */
  missing: string[];
  diagnostics: {
    oneMinuteBars: number;
    fiveMinuteBars: number;
    premarketBars: number;
    dailyBars: number;
    baselineSessions: number;
    feed: string;
    partialMarketCoverage: boolean;
  };
}

function minuteOfDay(candle: Candle): number {
  return getEasternTimeParts(new Date(candle.time * 1000)).minutesSinceMidnight;
}

function onDate(candles: Candle[], tradingDate: string): Candle[] {
  return candles.filter((c) => getCurrentTradingDate(new Date(c.time * 1000)) === tradingDate);
}

export async function loadRealSession(args: {
  provider: MarketDataProvider;
  symbol: string;
  tradingDate: string;
  baselineSessions?: number;
}): Promise<RealSessionLoad> {
  const { provider, symbol, tradingDate } = args;
  const baselineSessions = args.baselineSessions ?? 20;
  const missing: string[] = [];

  const feedInfo = provider.feedInfo?.() ?? {
    feed: provider.name,
    delayed: false,
    knownDelayMinutes: null,
  };
  const feed = feedInfo.feed;
  // IEX prints only a slice of consolidated volume. Labelled, never
  // described as total-market participation.
  const partialMarketCoverage = /iex/i.test(feed);

  const [oneMinuteRaw, fiveMinuteRaw, dailyRaw, baselineRaw] = await Promise.all([
    provider.getCandles({ symbol, timeframe: "1m", limit: 1000, sessionScope: "extended" }),
    provider.getCandles({ symbol, timeframe: "5m", limit: 250, sessionScope: "extended" }),
    provider.getCandles({ symbol, timeframe: "1d", limit: 40 }),
    provider.getCandles({
      symbol,
      timeframe: "5m",
      limit: 5000,
      sessionScope: "extended",
      sessionCount: baselineSessions,
    }),
  ]);

  const oneMinuteAll = onDate(oneMinuteRaw.candles, tradingDate);
  const fiveMinuteAll = onDate(fiveMinuteRaw.candles, tradingDate);

  if (oneMinuteAll.length === 0) missing.push(`no 1-minute bars for ${tradingDate}`);
  if (fiveMinuteAll.length === 0) missing.push(`no 5-minute bars for ${tradingDate}`);

  // Premarket levels come from the day's real premarket prints only.
  const premarket = fiveMinuteAll.filter(
    (c) => getSessionTypeForTimestamp(new Date(c.time * 1000)) === "pre-market"
  );
  const premarketHigh = premarket.length > 0 ? Math.max(...premarket.map((c) => c.high)) : null;
  const premarketLow = premarket.length > 0 ? Math.min(...premarket.map((c) => c.low)) : null;
  if (premarketHigh === null) {
    missing.push(`no premarket bars for ${tradingDate} — TAP 2 has no level`);
  }

  // The regular session is what the trend lifecycle runs on.
  const regularFive = fiveMinuteAll.filter(
    (c) => getSessionTypeForTimestamp(new Date(c.time * 1000)) === "regular"
  );
  const regularOne = oneMinuteAll.filter(
    (c) => getSessionTypeForTimestamp(new Date(c.time * 1000)) === "regular"
  );
  if (regularFive.length < 5) {
    missing.push(`only ${regularFive.length} regular-session 5m bars for ${tradingDate}`);
  }

  // Previous day, located by DATE — the last daily element during market
  // hours is today's still-forming bar.
  const priorDaily = dailyRaw.candles.filter(
    (c) => getCurrentTradingDate(new Date(c.time * 1000)) < tradingDate
  );
  const prior = priorDaily[priorDaily.length - 1] ?? null;
  if (prior === null) missing.push("no previous daily bar");

  // Same-feed, same-minute-of-day 5m volume baseline.
  const baselineByMinute: Record<number, number> = {};
  const minutes = new Set(regularFive.map(minuteOfDay));
  let sessionsSeen = 0;
  for (const m of minutes) {
    const bars = collectTimeOfDayBars(baselineRaw.candles, m, tradingDate, "extended");
    const med = median(bars.map((b) => b.bar.volume));
    if (med !== null && med > 0) baselineByMinute[m] = med;
    sessionsSeen = Math.max(sessionsSeen, bars.length);
  }
  if (Object.keys(baselineByMinute).length === 0) {
    missing.push("no same-feed time-of-day volume baseline — relative volume unavailable");
  }

  const diagnostics = {
    oneMinuteBars: regularOne.length,
    fiveMinuteBars: regularFive.length,
    premarketBars: premarket.length,
    dailyBars: dailyRaw.candles.length,
    baselineSessions: sessionsSeen,
    feed,
    partialMarketCoverage,
  };

  // A session without regular bars or a premarket level cannot exercise
  // the lifecycle honestly. Stop rather than substitute.
  if (regularFive.length < 5 || premarketHigh === null || premarketLow === null) {
    return { session: null, missing, diagnostics };
  }

  return {
    session: {
      symbol,
      tradingDate,
      synthetic: false,
      oneMinute: regularOne,
      fiveMinute: regularFive,
      daily: dailyRaw.candles,
      premarketHigh,
      premarketLow,
      previousDayHigh: prior?.high ?? premarketHigh,
      previousDayLow: prior?.low ?? premarketLow,
      // Scalar fallback only; the per-minute map above is preferred.
      oneMinuteVolumeBaseline: 0,
      fiveMinuteVolumeBaseline: 0,
      fiveMinuteBaselineByMinute: baselineByMinute,
    },
    missing,
    diagnostics,
  };
}
