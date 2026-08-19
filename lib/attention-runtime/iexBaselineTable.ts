import { createHash } from "node:crypto";
import { sha256, stableJson } from "@/lib/replay/archive";
import { calculatePathEfficiency } from "@/lib/attention/attentionAxes";
import { buildContinuousSameTimeBaseline, type ContinuousBaselineTransform } from "@/lib/attention/baselines";
import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";
import { rankableUniverse } from "@/lib/attention/universePolicy";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import type { Candle } from "@/types/candle";
import { aggregateCandle, bridgeRegularOpenWindow, buildPriorSessionAtrSeed, candleTrueRange } from "./iexMetricWarmup";

export interface IexBaselineSessionBars { tradingDate: string; bars: Record<string, Candle[]>; priorSessionRegularBars?: Record<string, Candle[]> }

interface HistoricalMetric {
  bar: Candle | null;
  rangeAtr: number | null;
  pathEfficiency: number | null;
  return5m: number | null;
}

export interface StaticContinuousBaseline {
  state: "ok" | "insufficient_baseline" | "unavailable";
  sampleSize: number;
  median: number | null;
  mad: number | null;
  transform: ContinuousBaselineTransform;
  zClamp: number;
}

export interface IexBaselineBucket {
  symbol: string;
  minuteOfDay: number;
  baselineMode: "dense" | "sparse" | "dead";
  pPresent: number;
  volume: StaticContinuousBaseline;
  dollarVolume: StaticContinuousBaseline;
  rangeAtr: StaticContinuousBaseline;
  pathEfficiency: StaticContinuousBaseline;
  stockMagnitude: StaticContinuousBaseline;
  sectorMagnitude: StaticContinuousBaseline;
}

export interface IexBaselineTable {
  schemaVersion: 2;
  feedMode: "iex_partial";
  adjustment: "split";
  firstMinute: 570;
  lastMinuteExclusive: 960;
  minBaselineSessions: number;
  historyTradingDates: string[];
  universeHash: string;
  warmup: {
    source: "prior_session_regular";
    completedFiveMinuteBars: 13;
    overnightGapTreatment: "first_current_bar_true_range_vs_previous_regular_close";
  };
  coverageRepair?: {
    historySelection: "latest_40_consecutive_sessions";
    preservedExistingOkFromTableId: string;
    preservationRule: "unchanged_reference_and_existing_ok";
  };
  buckets: Record<string, IexBaselineBucket>;
  tableId: string;
}

const MIN_BASELINE_SESSIONS = 10;
const Z_CLAMP = 8;
const rankable = rankableUniverse(ATTENTION_UNIVERSE);

export function iexBaselineBucketKey(symbol: string, minuteOfDay: number): string {
  return `${symbol}|${minuteOfDay}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function minute(bar: Candle): number {
  return getEasternTimeParts(new Date(bar.time * 1000)).minutesSinceMidnight;
}

/** Produces the same historical features as the former metricAt path, but once per session. */
export function buildHistoricalMetricSeries(allBars: readonly Candle[], priorSessionRegularBars: readonly Candle[] = []): HistoricalMetric[] {
  const byMinute = new Map<number, Candle>();
  for (const bar of [...allBars].sort((a, b) => a.time - b.time)) byMinute.set(minute(bar), bar);
  const availableMinutes = [...byMinute.keys()];
  const firstMinute = availableMinutes.length ? Math.min(...availableMinutes) : 240;
  const metrics: HistoricalMetric[] = Array.from({ length: 960 }, () => ({ bar: null, rangeAtr: null, pathEfficiency: null, return5m: null }));
  const seed = buildPriorSessionAtrSeed(priorSessionRegularBars);
  const completedTrueRanges: number[] = [];
  const fallbackCompletedTrueRanges: number[] = [...seed.completedTrueRanges];
  const eligibleBars: Candle[] = [];
  const recentBars: Array<{ minute: number; bar: Candle }> = [];
  let bucketStart = -1;
  let partialBucket: Candle | null = null;
  let previousBucketClose: number | null = null;
  let fallbackPreviousBucketClose: number | null = seed.previousClose;

  for (let minuteOfDay = firstMinute; minuteOfDay < 960; minuteOfDay += 1) {
    const nextBucketStart = Math.floor(minuteOfDay / 5) * 5;
    if (nextBucketStart !== bucketStart) {
      if (partialBucket) {
        completedTrueRanges.push(candleTrueRange(partialBucket, previousBucketClose));
        fallbackCompletedTrueRanges.push(candleTrueRange(partialBucket, fallbackPreviousBucketClose));
        previousBucketClose = partialBucket.close;
        fallbackPreviousBucketClose = partialBucket.close;
      }
      bucketStart = nextBucketStart;
      partialBucket = null;
    }
    while (recentBars.length && recentBars[0].minute < minuteOfDay - 4) recentBars.shift();
    const bar = byMinute.get(minuteOfDay) ?? null;
    if (!bar) continue;
    eligibleBars.push(bar);
    recentBars.push({ minute: minuteOfDay, bar });
    partialBucket = aggregateCandle(partialBucket, bar);
    const currentAtrValues = [...completedTrueRanges.slice(-13), candleTrueRange(partialBucket, previousBucketClose)];
    const fallbackAtrValues = [...fallbackCompletedTrueRanges.slice(-13), candleTrueRange(partialBucket, fallbackPreviousBucketClose)];
    const atrValues = currentAtrValues.length >= 14 ? currentAtrValues : fallbackAtrValues;
    const atr = atrValues.length >= 14 ? atrValues.reduce((sum, value) => sum + value, 0) / 14 : null;
    const effectiveRecentBars = bridgeRegularOpenWindow(recentBars.map((row) => row.bar), minuteOfDay, priorSessionRegularBars);
    const rangeAtr = atr && effectiveRecentBars.length
      ? (Math.max(...effectiveRecentBars.map((row) => row.high)) - Math.min(...effectiveRecentBars.map((row) => row.low))) / atr
      : null;
    const pathEfficiency = atr ? calculatePathEfficiency(effectiveRecentBars, atr).value : null;
    metrics[minuteOfDay] = {
      bar,
      rangeAtr,
      pathEfficiency,
      return5m: effectiveRecentBars.length ? effectiveRecentBars.at(-1)!.close / effectiveRecentBars[0].open - 1 : null,
    };
  }
  return metrics;
}

function fit(history: ReadonlyArray<number | null>, axis: "participation" | "displacement" | "idiosyncrasy", transform: ContinuousBaselineTransform = "linear"): StaticContinuousBaseline {
  const result = buildContinuousSameTimeBaseline({ axis, historicalValues: history, currentValue: 0, minSessions: MIN_BASELINE_SESSIONS, transform, dataQualityState: "ok" });
  return { state: result.state, sampleSize: result.sampleSize, median: result.median, mad: result.mad, transform, zClamp: Z_CLAMP };
}

export function evaluateStaticContinuousBaseline(baseline: StaticContinuousBaseline, currentValue: number): number | null {
  if (baseline.state !== "ok" || baseline.median === null || baseline.mad === null || baseline.mad <= 0) return null;
  const transformed = baseline.transform === "log1p" ? Math.log1p(currentValue) : currentValue;
  const value = (transformed - baseline.median) / (1.4826 * baseline.mad);
  return Math.max(-baseline.zClamp, Math.min(baseline.zClamp, value));
}

export function buildIexBaselineTable(history: readonly IexBaselineSessionBars[]): IexBaselineTable {
  if (history.length < MIN_BASELINE_SESSIONS) throw new Error(`IEX baseline table needs at least ${MIN_BASELINE_SESSIONS} sessions.`);
  const sessionMetrics = history.map((session) => {
    const metrics = new Map<string, HistoricalMetric[]>();
    for (const entry of ATTENTION_UNIVERSE) metrics.set(entry.symbol, buildHistoricalMetricSeries(
      session.bars[entry.symbol] ?? [],
      session.priorSessionRegularBars?.[entry.symbol] ?? [],
    ));
    return metrics;
  });
  const buckets: Record<string, IexBaselineBucket> = {};
  for (let minuteOfDay = 570; minuteOfDay < 960; minuteOfDay += 1) {
    for (const entry of rankable) {
      const metrics = sessionMetrics.map((day) => day.get(entry.symbol)![minuteOfDay]);
      const present = metrics.filter((row) => row.bar).length;
      const pPresent = present / history.length;
      const baselineMode = pPresent >= 0.6 ? "dense" : pPresent > 0 ? "sparse" : "dead";
      const benchmark = sessionMetrics.map((day) => day.get(entry.benchmark)![minuteOfDay]);
      const sector = sessionMetrics.map((day) => day.get(entry.sectorEtf ?? entry.benchmark)![minuteOfDay]);
      buckets[iexBaselineBucketKey(entry.symbol, minuteOfDay)] = {
        symbol: entry.symbol,
        minuteOfDay,
        baselineMode,
        pPresent,
        volume: fit(metrics.map((row) => row.bar?.volume ?? null), "participation", "log1p"),
        dollarVolume: fit(metrics.map((row) => row.bar ? row.bar.volume * row.bar.close : null), "participation", "log1p"),
        rangeAtr: fit(metrics.map((row) => row.rangeAtr), "displacement", "log1p"),
        pathEfficiency: fit(metrics.map((row) => row.pathEfficiency), "displacement"),
        stockMagnitude: fit(metrics.map((row, index) => row.return5m === null || benchmark[index].return5m === null ? null : Math.abs(row.return5m - benchmark[index].return5m!)), "idiosyncrasy"),
        sectorMagnitude: fit(sector.map((row, index) => row.return5m === null || benchmark[index].return5m === null ? null : Math.abs(row.return5m - benchmark[index].return5m!)), "idiosyncrasy"),
      };
    }
  }
  const unsigned = {
    schemaVersion: 2 as const,
    feedMode: "iex_partial" as const,
    adjustment: "split" as const,
    firstMinute: 570 as const,
    lastMinuteExclusive: 960 as const,
    minBaselineSessions: MIN_BASELINE_SESSIONS,
    historyTradingDates: history.map((row) => row.tradingDate).sort(),
    universeHash: sha256(stableJson(ATTENTION_UNIVERSE)),
    warmup: {
      source: "prior_session_regular" as const,
      completedFiveMinuteBars: 13 as const,
      overnightGapTreatment: "first_current_bar_true_range_vs_previous_regular_close" as const,
    },
    buckets,
  };
  return { ...unsigned, tableId: hash(unsigned) };
}

export function assertIexBaselineTable(table: IexBaselineTable): void {
  const { tableId, ...unsigned } = table;
  if (table.schemaVersion !== 2 || table.feedMode !== "iex_partial" || table.adjustment !== "split") throw new Error("Invalid IEX baseline-table metadata.");
  if (table.warmup?.source !== "prior_session_regular" || table.warmup.completedFiveMinuteBars !== 13) throw new Error("Invalid IEX baseline-table warm-up metadata.");
  if (hash(unsigned) !== tableId) throw new Error("IEX baseline-table identity mismatch.");
  if (table.universeHash !== sha256(stableJson(ATTENTION_UNIVERSE))) throw new Error("IEX baseline-table universe mismatch.");
  const expectedBuckets = rankable.length * (table.lastMinuteExclusive - table.firstMinute);
  if (Object.keys(table.buckets).length !== expectedBuckets) throw new Error(`IEX baseline-table bucket count mismatch: expected ${expectedBuckets}.`);
}
