import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { rankableUniverse, type UniverseSymbol } from "../lib/attention/universePolicy";
import { buildHistoricalMetricSeries, evaluateStaticContinuousBaseline, iexBaselineBucketKey, type IexBaselineBucket, type IexBaselineTable } from "../lib/attention-runtime/iexBaselineTable";
import { metricAt, type MinuteMetric } from "../lib/attention-runtime/iexProcessor";
import { scoreRawCalibrationPoint } from "../lib/replay/populationCalibration";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import type { Candle } from "../types/candle";

type SessionPayload = { tradingDate: string; bars: Record<string, Candle[]>; priorSessionRegularBars: Record<string, Candle[]> };
type Metric = Pick<MinuteMetric, "bar" | "rangeAtr" | "pathEfficiency" | "return5m">;

const before = JSON.parse(readFileSync(resolve("data/replay/calibration/iex-live-baseline-table.pre-open-coverage.json"), "utf8")) as IexBaselineTable;
const after = JSON.parse(readFileSync(resolve("data/replay/calibration/iex-live-baseline-table.json"), "utf8")) as IexBaselineTable;
const oldThresholds = JSON.parse(readFileSync(resolve("data/replay/reports/attention-thresholds.pre-open-coverage.json"), "utf8")) as FeedAwareAttentionThresholdStore;
const thresholds = JSON.parse(readFileSync(resolve("data/replay/reports/attention-thresholds.json"), "utf8")) as FeedAwareAttentionThresholdStore;
const rankable = rankableUniverse(ATTENTION_UNIVERSE);
const oldOverrides: Record<string, Pick<UniverseSymbol, "benchmark" | "sectorEtf">> = {
  SPY: { benchmark: "SPY", sectorEtf: null }, QQQ: { benchmark: "QQQ", sectorEtf: null }, IWM: { benchmark: "IWM", sectorEtf: null },
  SMH: { benchmark: "QQQ", sectorEtf: null }, GLD: { benchmark: "SPY", sectorEtf: null }, SLV: { benchmark: "SPY", sectorEtf: null },
  IBIT: { benchmark: "QQQ", sectorEtf: null }, DRAM: { benchmark: "QQQ", sectorEtf: null }, SPCX: { benchmark: "QQQ", sectorEtf: null },
};
const oldUniverse = ATTENTION_UNIVERSE.map((entry) => ({ ...entry, ...(oldOverrides[entry.symbol] ?? {}) }));

function average(values: ReadonlyArray<number | null>): number | null {
  const usable = values.filter((value): value is number => value !== null);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}
function ready(bucket: IexBaselineBucket): boolean {
  const participation = bucket.baselineMode !== "dense" || (bucket.volume.state === "ok" && bucket.dollarVolume.state === "ok");
  return participation && bucket.rangeAtr.state === "ok" && bucket.pathEfficiency.state === "ok"
    && bucket.stockMagnitude.state === "ok" && bucket.sectorMagnitude.state === "ok";
}
function coverage(table: IexBaselineTable): number[] {
  return Array.from({ length: 390 }, (_, offset) => rankable.filter((entry) => ready(table.buckets[iexBaselineBucketKey(entry.symbol, 570 + offset)])).length);
}
function score(entry: UniverseSymbol, metricMap: Map<string, Metric>, bucket: IexBaselineBucket, set: FeedAwareAttentionThresholdStore["sets"]["iex_partial"]["regular"]): number | null {
  const current = metricMap.get(entry.symbol), benchmark = metricMap.get(entry.benchmark), sector = metricMap.get(entry.sectorEtf ?? entry.benchmark);
  if (!current?.bar || current.rangeAtr === null || current.pathEfficiency === null || current.return5m === null || benchmark?.return5m == null || sector?.return5m == null) return null;
  const participationInput = bucket.baselineMode === "dense"
    ? average([evaluateStaticContinuousBaseline(bucket.volume, current.bar.volume), evaluateStaticContinuousBaseline(bucket.dollarVolume, current.bar.volume * current.bar.close)])
    : bucket.baselineMode === "dead" ? 6 : Math.min(6, -Math.log2(bucket.pPresent));
  const displacementZ = average([evaluateStaticContinuousBaseline(bucket.rangeAtr, current.rangeAtr), evaluateStaticContinuousBaseline(bucket.pathEfficiency, current.pathEfficiency)]);
  const stockZ = evaluateStaticContinuousBaseline(bucket.stockMagnitude, Math.abs(current.return5m - benchmark.return5m));
  const sectorZ = evaluateStaticContinuousBaseline(bucket.sectorMagnitude, Math.abs(sector.return5m - benchmark.return5m));
  const idio = [stockZ, sectorZ].filter((value): value is number => value !== null);
  if (participationInput === null || displacementZ === null || !idio.length) return null;
  return scoreRawCalibrationPoint({ tradingDate: "2026-08-14", symbol: entry.symbol, minuteOfDay: bucket.minuteOfDay, feedMode: "iex_partial", subWindow: "regular", participationInput, participationInputKind: bucket.baselineMode === "dense" ? "z" : "surprise_bits", displacementZ, idiosyncrasyZ: Math.max(...idio), limitedHistory: false }, set.normalization).attention;
}
function session(path: string): SessionPayload {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as SessionPayload;
}
function metricsFor(payload: SessionPayload, minute: number, warm: boolean): Map<string, Metric> {
  return new Map(ATTENTION_UNIVERSE.map((entry) => [entry.symbol, metricAt(payload.bars[entry.symbol] ?? [], minute, warm ? payload.priorSessionRegularBars[entry.symbol] ?? [] : [])]));
}
function historicalMetricsFor(payload: SessionPayload, minute: number): Map<string, Metric> {
  return new Map(ATTENTION_UNIVERSE.map((entry) => [entry.symbol, buildHistoricalMetricSeries(payload.bars[entry.symbol] ?? [], payload.priorSessionRegularBars[entry.symbol] ?? [])[minute]]));
}

const beforeCoverage = coverage(before), afterCoverage = coverage(after);
const curveRows = Array.from({ length: 390 }, (_, offset) => ({ minuteOfDay: 570 + offset, minuteEt: `${String(Math.floor((570 + offset) / 60)).padStart(2, "0")}:${String((570 + offset) % 60).padStart(2, "0")}`, before: beforeCoverage[offset], after: afterCoverage[offset] }));
writeFileSync(resolve("data/replay/reports/open-coverage-curve.csv"), `minute_et,before,after\n${curveRows.map((row) => `${row.minuteEt},${row.before},${row.after}`).join("\n")}\n`);

const sessionDirectory = resolve("data/replay/calibration/sessions/iex_partial");
const sessionPaths = readdirSync(sessionDirectory).filter((name) => name.endsWith(".json.gz")).sort().map((name) => resolve(sessionDirectory, name));
const replay = session(sessionPaths.find((path) => path.endsWith("2026-08-14.json.gz")) ?? sessionPaths.at(-1)!);
let maxWarmupOnlyScoreDelta = 0, comparedScoreRows = 0;
for (let minute = 570; minute < 960; minute += 1) {
  const oldMetrics = metricsFor(replay, minute, false), warmedMetrics = metricsFor(replay, minute, true);
  for (const entry of oldUniverse.filter((row) => row.enabled && !row.referenceOnly)) {
    const beforeBucket = before.buckets[iexBaselineBucketKey(entry.symbol, minute)];
    const afterBucket = after.buckets[iexBaselineBucketKey(entry.symbol, minute)];
    if (!ready(beforeBucket)) continue;
    const warmupOnlyBucket = { ...beforeBucket, rangeAtr: afterBucket.rangeAtr, pathEfficiency: afterBucket.pathEfficiency };
    const a = score(entry, oldMetrics, beforeBucket, oldThresholds.sets.iex_partial.regular);
    if (a === null) continue;
    const b = score(entry, warmedMetrics, warmupOnlyBucket, oldThresholds.sets.iex_partial.regular);
    if (b === null) throw new Error(`Warm-up removed an existing score for ${entry.symbol} at ${minute}.`);
    comparedScoreRows += 1;
    maxWarmupOnlyScoreDelta = Math.max(maxWarmupOnlyScoreDelta, Math.abs(a - b));
  }
}

const liveOpen = metricsFor(replay, 570, true), historicalOpen = historicalMetricsFor(replay, 570);
let liveHistorical: { symbol: string; live: number; historical: number; delta: number } | null = null;
for (const entry of rankable) {
  const bucket = after.buckets[iexBaselineBucketKey(entry.symbol, 570)];
  const live = score(entry, liveOpen, bucket, thresholds.sets.iex_partial.regular);
  const historical = score(entry, historicalOpen, bucket, thresholds.sets.iex_partial.regular);
  if (live === null || historical === null) continue;
  liveHistorical = { symbol: entry.symbol, live, historical, delta: Math.abs(live - historical) };
  break;
}
if (!liveHistorical) throw new Error("No 09:30 live/historical score pair was available after repair.");

const neverScoreable = rankable.filter((entry) => !Array.from({ length: 390 }, (_, offset) => after.buckets[iexBaselineBucketKey(entry.symbol, 570 + offset)]).some(ready));
const corpus = JSON.parse(gunzipSync(readFileSync(resolve("data/replay/calibration/raw-features.json.gz"))).toString("utf8")) as { symbols: string[]; feeds: { iex_partial: number[][] } };
const featureCounts = new Map<string, number>();
for (const tuple of corpus.feeds.iex_partial) featureCounts.set(corpus.symbols[tuple[1]], (featureCounts.get(corpus.symbols[tuple[1]]) ?? 0) + 1);
const symbolEvidence = (entry: UniverseSymbol) => {
  const buckets = Array.from({ length: 390 }, (_, offset) => after.buckets[iexBaselineBucketKey(entry.symbol, 570 + offset)]);
  let regularBars = 0;
  for (const path of sessionPaths) regularBars += session(path).bars[entry.symbol]?.filter((bar) => {
    const date = new Date(bar.time * 1000);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const minute = Number(values.hour) * 60 + Number(values.minute);
    return minute >= 570 && minute < 960;
  }).length ?? 0;
  return {
    symbol: entry.symbol,
    scoreableCorpusRows: featureCounts.get(entry.symbol) ?? 0,
    regularIexBarsAcross40Sessions: regularBars,
    unavailableBuckets: Object.fromEntries(["volume", "dollarVolume", "rangeAtr", "pathEfficiency", "stockMagnitude", "sectorMagnitude"].map((field) => [field, buckets.filter((bucket) => (bucket as any)[field].state !== "ok").length])),
    maxPresenceProbability: Math.max(...buckets.map((bucket) => bucket.pPresent)),
  };
};
const neverEvidence = neverScoreable.map(symbolEvidence);
const affectedEvidence = ["SPY", "QQQ", "IWM", "SMH", "GLD", "SLV", "IBIT", "DRAM", "SPCX"]
  .map((symbol) => rankable.find((entry) => entry.symbol === symbol))
  .filter((entry): entry is UniverseSymbol => Boolean(entry))
  .map(symbolEvidence);

const oldSet = oldThresholds.sets.iex_partial.regular, newSet = thresholds.sets.iex_partial.regular;
const numericalCalibrationChanged = JSON.stringify({ n: oldSet.normalization, v: oldSet.values, p: oldSet.provisionalValues }) !== JSON.stringify({ n: newSet.normalization, v: newSet.values, p: newSet.provisionalValues });
const report = {
  generatedAt: new Date().toISOString(),
  before: { tableId: before.tableId, universeHash: before.universeHash, calibrationId: oldSet.calibrationId },
  after: { tableId: after.tableId, universeHash: after.universeHash, calibrationId: newSet.calibrationId, warmup: after.warmup },
  identitiesInvalidated: before.tableId !== after.tableId && before.universeHash !== after.universeHash && oldSet.calibrationId !== newSet.calibrationId,
  numericalCalibrationChanged,
  coverage: { curveRows, beforePeak: Math.max(...beforeCoverage), afterPeak: Math.max(...afterCoverage), beforeAtOpen: beforeCoverage[0], afterAtOpen: afterCoverage[0] },
  warmupOnlyExistingScores: { replaySession: replay.tradingDate, comparedScoreRows, maxAbsoluteAttentionDelta: maxWarmupOnlyScoreDelta },
  liveVsHistoricalAtOpen: { replaySession: replay.tradingDate, minuteEt: "09:30", ...liveHistorical },
  neverScoreable: neverEvidence,
  affectedSymbolEvidence: affectedEvidence,
};
writeFileSync(resolve("data/replay/reports/open-coverage-report.json"), `${JSON.stringify(report, null, 2)}\n`);
const sampleMinutes = [570, 575, 580, 595, 600, 615, 630, 635, 660, 720, 780, 840, 900, 959];
const md = `# Phase OPEN-COVERAGE report\n\n## Scope\n\nData-contract repair only. No score formula, normalization curve, threshold, persistence, or state-transition value changed.\n\n## Warm-up rule found\n\nThe former builder initialized within each one-day artifact:\n\n\`\`\`ts\nconst completedTrueRanges: number[] = [];\nlet previousBucketClose: number | null = null;\nconst atrValues = [...completedTrueRanges.slice(-13), trueRange(partialBucket, previousBucketClose)];\nconst atr = atrValues.length >= 14 ? sum / 14 : null;\n\`\`\`\n\nIt could consume same-day premarket prints, but could not cross the artifact/session boundary. Separately, \`rangeAtr\` and \`pathEfficiency\` consume the rolling current minute plus the prior four one-minute slots; \`pathEfficiency\` stays null when total path is below \`0.1 * ATR\`. The replacement uses 13 completed five-minute true ranges from the prior regular session only as an ATR fallback until 14 same-session ranges exist, and bridges missing 09:26-09:29 rolling-window slots with the final prior-session regular one-minute bars. Current-session prints always win and the bridge expires after 09:34. The first chronological current-session print measures true range against the prior regular close only on the fallback path, so the overnight gap is represented exactly once; no synthetic overnight bar or volume is imputed.\n\n## Identity consequences\n\n- Baseline table: \`${before.tableId}\` -> \`${after.tableId}\`\n- Universe: \`${before.universeHash}\` -> \`${after.universeHash}\`\n- IEX regular calibration: \`${oldSet.calibrationId}\` -> \`${newSet.calibrationId}\`\n- Existing checkpoint: incompatible and intentionally rejected before restart.\n- Numerical curve/threshold change: **${numericalCalibrationChanged ? "YES (DEFECT)" : "no"}**\n\n## Coverage sample\n\n| ET | Before | After |\n|---:|---:|---:|\n${sampleMinutes.map((minute) => { const row = curveRows[minute - 570]; return `| ${row.minuteEt} | ${row.before} | ${row.after} |`; }).join("\n")}\n\nThe complete 390-minute curve is in \`open-coverage-curve.csv\`. Opening coverage is ${afterCoverage[0]}/${rankable.length}; midday peak is ${Math.max(...afterCoverage)}/${rankable.length}.\n\n## Equivalence\n\n- Warm-up-only comparison over ${replay.tradingDate}: ${comparedScoreRows} previously scoreable symbol-minutes; max absolute attention delta **${maxWarmupOnlyScoreDelta}**.\n- Historical/live 09:30 comparison (${liveHistorical.symbol}, ${replay.tradingDate}): live ${liveHistorical.live}, historical ${liveHistorical.historical}, absolute delta **${liveHistorical.delta}**.\n\n## Never-scoreable after both repairs\n\n${neverEvidence.length ? neverEvidence.map((row) => `- **${row.symbol}**: corpus scoreable rows ${row.scoreableCorpusRows}; regular IEX bars across 40 sessions ${row.regularIexBarsAcross40Sessions}; max pPresent ${row.maxPresenceProbability}; unavailable buckets ${JSON.stringify(row.unavailableBuckets)}.`).join("\n") : "None."}\n\n## Affected-symbol evidence\n\n${affectedEvidence.map((row) => `- **${row.symbol}**: corpus scoreable rows ${row.scoreableCorpusRows}; regular IEX bars across 40 sessions ${row.regularIexBarsAcross40Sessions}; max pPresent ${row.maxPresenceProbability}; unavailable buckets ${JSON.stringify(row.unavailableBuckets)}.`).join("\n")}\n`;
writeFileSync(resolve("data/replay/reports/open-coverage-report.md"), md);
console.log(JSON.stringify(report, null, 2));
