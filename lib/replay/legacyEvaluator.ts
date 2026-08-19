import { getSessionTypeForTimestamp } from "@/lib/market-data/session";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { scoreSetup } from "@/lib/strategies/scorer";
import { getCurrentTradingDate } from "@/lib/risk/tradingDate";
import type { ReplayEvaluator, ReplayRankedRow } from "./deterministic";

let sessionRows = new WeakMap<object, Map<number, ReplayRankedRow[]>>();

/** Clear memoized rows so a subsequent replay independently recomputes them. */
export function resetLegacyReplayCache(): void {
  sessionRows = new WeakMap<object, Map<number, ReplayRankedRow[]>>();
}

export const evaluateLegacySetupAtMinute: ReplayEvaluator = ({ session, at }): ReplayRankedRow[] => {
  // A closed 5-minute history changes only on a 5-minute boundary. Cache the
  // score rows between boundaries so a full-universe minute replay does not
  // recompute the identical legacy setup hundreds of thousands of times.
  const closedFiveMinuteBucket = Math.floor((at + 60) / (5 * 60));
  let byBucket = sessionRows.get(session);
  if (!byBucket) {
    byBucket = new Map();
    sessionRows.set(session, byBucket);
  }
  const cached = byBucket.get(closedFiveMinuteBucket);
  if (cached) return cached;

  const rows: ReplayRankedRow[] = [];
  for (const [symbol, series] of Object.entries(session.bars)) {
    const fiveMinute = (series["5m"] ?? []).filter((bar) => bar.time + 5 * 60 <= at + 60);
    const regular = fiveMinute.filter(
      (bar) => getSessionTypeForTimestamp(new Date(bar.time * 1000)) === "regular"
    );
    if (regular.length === 0) continue;
    const premarket = fiveMinute.filter(
      (bar) => getSessionTypeForTimestamp(new Date(bar.time * 1000)) === "pre-market"
    );
    const daily = series["1d"] ?? [];
    const prior = daily
      .filter((bar) => getCurrentTradingDate(new Date(bar.time * 1000)) < session.tradingDate)
      .at(-1);
    if (!prior) continue;
    const result = scoreSetup({
      symbol,
      timeframe: "5m",
      sessionCandles: regular,
      dailyCandles: daily,
      prevClose: prior.close,
      config: defaultStrategyConfig,
      now: new Date((at + 60) * 1000).toISOString(),
      quality: "realtime",
      premarketCandles: premarket,
    });
    rows.push({
      symbol,
      score: result.score,
      state: result.status,
      episodeId: `legacy:${session.tradingDate}:${symbol}`,
    });
  }
  const ranked = rows.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  byBucket.set(closedFiveMinuteBucket, ranked);
  return ranked;
};
