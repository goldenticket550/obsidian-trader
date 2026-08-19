import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Candle } from "../types/candle";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { rankableUniverse } from "../lib/attention/universePolicy";
import { calculatePathEfficiency } from "../lib/attention/attentionAxes";
import { buildContinuousSameTimeBaseline } from "../lib/attention/baselines";
import {
  exchangeCalendarDay,
  tradingSessionsSince,
} from "../lib/attention/exchangeCalendar";
import { getEasternTimePartsForCandleTime } from "../lib/market-data/easternTime";
import {
  PRE_STREAM_REPLAY_DISCLOSURE,
  LIVE_BAR_ADJUSTMENT,
  sha256,
  stableJson,
  type ArchiveMetadata,
} from "../lib/replay/archive";
import type { BaselineMode } from "../lib/replay/baselineModes";
import { quantile } from "../lib/replay/populationCalibration";
import type { AttentionFeedMode } from "../lib/attention/attentionScore";
import type { AttentionSubWindow } from "../lib/replay/attentionThresholdTypes";
import { bridgeRegularOpenWindow, buildPriorSessionAtrSeed, priorRegularSessionBars } from "../lib/attention-runtime/iexMetricWarmup";

const SESSION_COUNT = 40;
const TRAIN_COUNT = 28;
const BASELINE_LOOKBACK = 20;
const MIN_BASELINE_SESSIONS = 10;
const SESSION_START = 4 * 60;
const SESSION_END = 20 * 60;
const EARLIEST_REPLAY_DATE = "2025-10-01";

type Regime =
  "trending_up" | "trending_down" | "chopping" | "quiet" | "high_volatility";
type ParticipationKindCode = 0 | 1;
type BaselineModeCode = 0 | 1 | 2;
type DataQualityCode = 0 | 1;

interface ChunkPayload {
  feed: string;
  adjustment: string;
  timeframe: string;
  start: string;
  end: string;
  bars: Record<string, Candle[]>;
}
interface FeedArchiveMetadata {
  createdAt: string;
  feed: "sip" | "iex";
  adjustment: string;
  start: string;
  end: string;
  symbols: string[];
  files: Array<{ path: string; bytes: number; bars: number; sha256: string }>;
}
interface DailyProfile {
  tradingDate: string;
  sessionReturn: number;
  rangePct: number;
  bodyEfficiency: number;
  primaryRegime: Regime;
  tags: Regime[];
  earlyClose: boolean;
  holidayAdjacent: boolean;
}
interface HaltCandidate {
  tradingDate: string;
  symbol: string;
  gapMinutes: number;
  beforeMinute: number;
  afterMinute: number;
  evidence: "inferred_regular_hours_bar_gap";
}
interface ManifestSession extends DailyProfile {
  split: "train" | "holdout";
  haltCandidate: HaltCandidate | null;
}
interface MinuteMetric {
  bar: Candle | null;
  atr: number | null;
  rangeAtr: number | null;
  pathEfficiency: number | null;
  stockReturn: number | null;
  stockVsBenchmarkMagnitude: number | null;
  sectorVsBenchmarkMagnitude: number | null;
  vwap: number | null;
  ema9: number | null;
  consecutiveExpansionBars: number;
  pullbackObserved: boolean;
  priceLostVwap: boolean;
}
type DayMetrics = Map<string, MinuteMetric[]>;
type FeatureTuple = [
  number,
  number,
  number,
  number,
  number,
  ParticipationKindCode,
  BaselineModeCode,
  number,
  number,
  number,
  number,
  number | null,
  number | null,
  number,
  0 | 1,
  0 | 1,
  DataQualityCode,
];
type SaturationTuple = [
  number,
  number,
  number,
  ParticipationKindCode,
  BaselineModeCode,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];
type FeatureRejectionReason =
  | "no_target_bar"
  | "target_metrics_unavailable"
  | "history_short"
  | "participation_baseline_unavailable"
  | "displacement_baseline_unavailable"
  | "benchmark_reference_missing"
  | "reference_baseline_unavailable";
type FeatureResult = {
  feature: FeatureTuple | null;
  reason: FeatureRejectionReason | "scoreable";
};
interface StaticMode {
  mode: BaselineMode;
  pPresent: number;
}
interface AtrState {
  completedTrueRanges: number[];
  previousClose: number | null;
}
interface BaselineModeMapPayload {
  records: Array<{
    symbol: string;
    minuteEt: string;
    mode: BaselineMode;
    pPresent: number;
  }>;
}

const universeSymbols = ATTENTION_UNIVERSE.map((entry) => entry.symbol);
const universeSet = new Set(universeSymbols);
const rankableSymbols = rankableUniverse(ATTENTION_UNIVERSE).map(
  (entry) => entry.symbol,
);
const rankableSet = new Set(rankableSymbols);
const universeBySymbol = new Map(
  ATTENTION_UNIVERSE.map((entry) => [entry.symbol, entry]),
);

function readJsonGzip<T>(path: string): T {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as T;
}
function subWindowAt(minute: number): AttentionSubWindow | null {
  if (minute >= 240 && minute < 420) return "premarket_early";
  if (minute >= 420 && minute < 540) return "premarket_core";
  if (minute >= 540 && minute < 570) return "premarket_final";
  if (minute >= 570 && minute < 960) return "regular";
  if (minute >= 960 && minute < 1080) return "after_hours_core";
  if (minute >= 1080 && minute < 1200) return "after_hours_late";
  return null;
}
function groupIntradayPaths(
  metadata: FeedArchiveMetadata,
): Array<{ key: string; paths: string[] }> {
  const groups = new Map<string, string[]>();
  for (const file of metadata.files.filter((entry) =>
    entry.path.startsWith("1m-"),
  )) {
    const match = /^1m-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})/.exec(file.path);
    if (!match) continue;
    const key = `${match[1]}|${match[2]}`;
    const paths = groups.get(key) ?? [];
    paths.push(file.path);
    groups.set(key, paths);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, paths]) => ({ key, paths: paths.sort() }));
}
function loadMonth(
  root: string,
  paths: readonly string[],
): Map<string, Map<string, Candle[]>> {
  const byDate = new Map<string, Map<string, Candle[]>>();
  for (const path of paths) {
    const chunk = readJsonGzip<ChunkPayload>(resolve(root, path));
    if (chunk.adjustment !== LIVE_BAR_ADJUSTMENT || chunk.timeframe !== "1m")
      throw new Error(`Invalid calibration chunk ${path}.`);
    for (const [symbol, bars] of Object.entries(chunk.bars)) {
      if (!universeSet.has(symbol)) continue;
      for (const bar of bars) {
        const parts = getEasternTimePartsForCandleTime(bar.time);
        if (
          parts.minutesSinceMidnight < SESSION_START ||
          parts.minutesSinceMidnight >= SESSION_END
        )
          continue;
        const symbols = byDate.get(parts.date) ?? new Map<string, Candle[]>();
        const symbolBars = symbols.get(symbol) ?? [];
        symbolBars.push(bar);
        symbols.set(symbol, symbolBars);
        byDate.set(parts.date, symbols);
      }
    }
  }
  for (const symbols of byDate.values())
    for (const bars of symbols.values()) bars.sort((a, b) => a.time - b.time);
  return byDate;
}
function loadDailyProfiles(
  sipRoot: string,
  metadata: ArchiveMetadata,
): DailyProfile[] {
  const bars: Candle[] = [];
  for (const file of metadata.files.filter((entry) =>
    entry.path.startsWith("1d-"),
  )) {
    const payload = readJsonGzip<ChunkPayload>(resolve(sipRoot, file.path));
    bars.push(...(payload.bars.SPY ?? []));
  }
  const unique = new Map<string, Candle>();
  for (const bar of bars)
    unique.set(getEasternTimePartsForCandleTime(bar.time).date, bar);
  const rows = [...unique.entries()]
    .filter(
      ([date]) =>
        date >= EARLIEST_REPLAY_DATE && date <= metadata.end.slice(0, 10),
    )
    .map(([tradingDate, bar]) => ({
      tradingDate,
      sessionReturn: bar.close / bar.open - 1,
      rangePct: (bar.high - bar.low) / bar.open,
      bodyEfficiency:
        bar.high > bar.low
          ? Math.abs(bar.close - bar.open) / (bar.high - bar.low)
          : 0,
    }))
    .sort((a, b) => a.tradingDate.localeCompare(b.tradingDate));
  const returns = rows.map((row) => row.sessionReturn),
    ranges = rows.map((row) => row.rangePct),
    bodies = rows.map((row) => row.bodyEfficiency);
  const q = {
    return30: quantile(returns, 0.3),
    return70: quantile(returns, 0.7),
    range20: quantile(ranges, 0.2),
    range85: quantile(ranges, 0.85),
    body30: quantile(bodies, 0.3),
  };
  const knownDates = new Set(rows.map((row) => row.tradingDate));
  return rows.map((row) => {
    const tags: Regime[] = [];
    if (row.sessionReturn >= q.return70 && row.bodyEfficiency >= q.body30)
      tags.push("trending_up");
    if (row.sessionReturn <= q.return30 && row.bodyEfficiency >= q.body30)
      tags.push("trending_down");
    if (row.bodyEfficiency <= q.body30) tags.push("chopping");
    if (row.rangePct <= q.range20) tags.push("quiet");
    if (row.rangePct >= q.range85) tags.push("high_volatility");
    const primaryRegime: Regime =
      row.rangePct >= q.range85
        ? "high_volatility"
        : row.rangePct <= q.range20
          ? "quiet"
          : row.sessionReturn >= q.return70 && row.bodyEfficiency >= q.body30
            ? "trending_up"
            : row.sessionReturn <= q.return30 && row.bodyEfficiency >= q.body30
              ? "trending_down"
              : "chopping";
    const epoch = Date.parse(`${row.tradingDate}T12:00:00Z`);
    const adjacentDates = [-3, -2, -1, 1, 2, 3].map((offset) =>
      new Date(epoch + offset * 86400_000).toISOString().slice(0, 10),
    );
    const holidayAdjacent = adjacentDates.some(
      (date) =>
        !knownDates.has(date) && exchangeCalendarDay(date).kind === "holiday",
    );
    return {
      ...row,
      primaryRegime,
      tags: tags.length ? tags : [primaryRegime],
      earlyClose: exchangeCalendarDay(row.tradingDate).kind === "early_close",
      holidayAdjacent,
    };
  });
}
function scanHaltCandidates(
  sipRoot: string,
  metadata: FeedArchiveMetadata,
): HaltCandidate[] {
  const candidates: HaltCandidate[] = [];
  for (const group of groupIntradayPaths(metadata)) {
    const month = loadMonth(sipRoot, group.paths);
    for (const [date, symbols] of month) {
      if (
        date < EARLIEST_REPLAY_DATE ||
        !exchangeCalendarDay(date).isTradingDay
      )
        continue;
      for (const [symbol, bars] of symbols) {
        if (!rankableSet.has(symbol)) continue;
        const regular = bars
          .map(
            (bar) =>
              getEasternTimePartsForCandleTime(bar.time).minutesSinceMidnight,
          )
          .filter(
            (minute) =>
              minute >= 570 &&
              minute < (exchangeCalendarDay(date).regularCloseMinutes ?? 960),
          );
        if (regular.length < 200) continue;
        for (let index = 1; index < regular.length; index += 1) {
          const gapMinutes = regular[index] - regular[index - 1] - 1;
          if (gapMinutes >= 5 && gapMinutes <= 120)
            candidates.push({
              tradingDate: date,
              symbol,
              gapMinutes,
              beforeMinute: regular[index - 1],
              afterMinute: regular[index],
              evidence: "inferred_regular_hours_bar_gap",
            });
        }
      }
    }
  }
  return candidates.sort(
    (a, b) =>
      b.gapMinutes - a.gapMinutes ||
      a.tradingDate.localeCompare(b.tradingDate) ||
      a.symbol.localeCompare(b.symbol),
  );
}
function selectSessions(
  profiles: readonly DailyProfile[],
  halts: readonly HaltCandidate[],
): ManifestSession[] {
  const selected = new Map<string, DailyProfile>();
  const add = (profile: DailyProfile | undefined) => {
    if (profile && selected.size < SESSION_COUNT)
      selected.set(profile.tradingDate, profile);
  };
  add(profiles.find((row) => row.earlyClose));
  add(profiles.find((row) => row.holidayAdjacent));
  const halt = halts.find((candidate) =>
    profiles.some((row) => row.tradingDate === candidate.tradingDate),
  );
  add(profiles.find((row) => row.tradingDate === halt?.tradingDate));
  const regimes: Regime[] = [
    "trending_up",
    "trending_down",
    "chopping",
    "quiet",
    "high_volatility",
  ];
  for (const regime of regimes) {
    const candidates = profiles
      .filter((row) => row.tags.includes(regime))
      .sort((a, b) => {
        const strength = (row: DailyProfile) =>
          regime === "trending_up"
            ? row.sessionReturn
            : regime === "trending_down"
              ? -row.sessionReturn
              : regime === "chopping"
                ? 1 - row.bodyEfficiency
                : regime === "quiet"
                  ? -row.rangePct
                  : row.rangePct;
        return (
          strength(b) - strength(a) ||
          a.tradingDate.localeCompare(b.tradingDate)
        );
      });
    const byMonth = new Map<string, DailyProfile[]>();
    for (const candidate of candidates) {
      const month = candidate.tradingDate.slice(0, 7),
        rows = byMonth.get(month) ?? [];
      rows.push(candidate);
      byMonth.set(month, rows);
    }
    let added = 0;
    for (let round = 0; added < 8 && round < 20; round += 1)
      for (const month of [...byMonth.keys()].sort()) {
        const before = selected.size;
        add(byMonth.get(month)?.[round]);
        if (selected.size > before) added += 1;
        if (added >= 8 || selected.size >= SESSION_COUNT) break;
      }
  }
  for (const profile of profiles) add(profile);
  if (selected.size !== SESSION_COUNT)
    throw new Error(
      `Could not construct ${SESSION_COUNT} unique calibration sessions.`,
    );
  const rows = [...selected.values()].sort((a, b) =>
    a.tradingDate.localeCompare(b.tradingDate),
  );
  const holdout = new Set<string>(),
    byRegime = new Map<Regime, DailyProfile[]>();
  for (const row of rows) {
    const group = byRegime.get(row.primaryRegime) ?? [];
    group.push(row);
    byRegime.set(row.primaryRegime, group);
  }
  for (const group of byRegime.values()) {
    const ordered = [...group].sort((a, b) =>
      createHash("sha256")
        .update(`population-v1|${a.tradingDate}`)
        .digest("hex")
        .localeCompare(
          createHash("sha256")
            .update(`population-v1|${b.tradingDate}`)
            .digest("hex"),
        ),
    );
    for (const row of ordered.slice(0, Math.round(group.length * 0.3)))
      holdout.add(row.tradingDate);
  }
  const hashOrder = [...rows].sort((a, b) =>
    createHash("sha256")
      .update(`rebalance-v1|${a.tradingDate}`)
      .digest("hex")
      .localeCompare(
        createHash("sha256")
          .update(`rebalance-v1|${b.tradingDate}`)
          .digest("hex"),
      ),
  );
  for (const row of hashOrder) {
    if (holdout.size >= SESSION_COUNT - TRAIN_COUNT) break;
    holdout.add(row.tradingDate);
  }
  for (const row of [...hashOrder].reverse()) {
    if (holdout.size <= SESSION_COUNT - TRAIN_COUNT) break;
    holdout.delete(row.tradingDate);
  }
  return rows.map((row) => ({
    ...row,
    split: holdout.has(row.tradingDate) ? "holdout" : "train",
    haltCandidate:
      halts.find((candidate) => candidate.tradingDate === row.tradingDate) ??
      null,
  }));
}

function aggregateBar(previous: Candle | null, bar: Candle): Candle {
  return previous
    ? {
        time: previous.time,
        open: previous.open,
        high: Math.max(previous.high, bar.high),
        low: Math.min(previous.low, bar.low),
        close: bar.close,
        volume: previous.volume + bar.volume,
      }
    : { ...bar };
}
function trueRange(bar: Candle, previousClose: number | null): number {
  return previousClose === null
    ? bar.high - bar.low
    : Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - previousClose),
        Math.abs(bar.low - previousClose),
      );
}
function buildSymbolMetrics(
  bars: readonly Candle[],
  priorAtrSeed: AtrState,
  priorSessionBars: readonly Candle[],
): MinuteMetric[] {
  const byMinute = new Map<number, Candle>();
  for (const bar of bars)
    byMinute.set(
      getEasternTimePartsForCandleTime(bar.time).minutesSinceMidnight,
      bar,
    );
  const metrics: MinuteMetric[] = Array.from(
    { length: SESSION_END - SESSION_START },
    () => ({
      bar: null,
      atr: null,
      rangeAtr: null,
      pathEfficiency: null,
      stockReturn: null,
      stockVsBenchmarkMagnitude: null,
      sectorVsBenchmarkMagnitude: null,
      vwap: null,
      ema9: null,
      consecutiveExpansionBars: 0,
      pullbackObserved: false,
      priceLostVwap: false,
    }),
  );
  let bucketStart = -1,
    partialBucket: Candle | null = null,
    cumulativePriceVolume = 0,
    cumulativeVolume = 0,
    ema9: number | null = null;
  let consecutiveExpansion = 0,
    sessionHigh = -Infinity,
    sessionLow = Infinity,
    pullbackObserved = false,
    previousPrice: number | null = null,
    previousVwap: number | null = null;
  const currentAtrState: AtrState = {
    completedTrueRanges: [],
    previousClose: null,
  };
  const fallbackAtrState: AtrState = {
    completedTrueRanges: [...priorAtrSeed.completedTrueRanges],
    previousClose: priorAtrSeed.previousClose,
  };
  const recentBars: Array<{ minute: number; bar: Candle }> = [];
  for (let minute = SESSION_START; minute < SESSION_END; minute += 1) {
    const nextBucketStart = Math.floor(minute / 5) * 5;
    if (nextBucketStart !== bucketStart) {
      if (partialBucket) {
        currentAtrState.completedTrueRanges.push(
          trueRange(partialBucket, currentAtrState.previousClose),
        );
        if (currentAtrState.completedTrueRanges.length > 14)
          currentAtrState.completedTrueRanges.shift();
        currentAtrState.previousClose = partialBucket.close;
        fallbackAtrState.completedTrueRanges.push(
          trueRange(partialBucket, fallbackAtrState.previousClose),
        );
        if (fallbackAtrState.completedTrueRanges.length > 14)
          fallbackAtrState.completedTrueRanges.shift();
        fallbackAtrState.previousClose = partialBucket.close;
      }
      bucketStart = nextBucketStart;
      partialBucket = null;
    }
    while (recentBars.length && recentBars[0].minute < minute - 4)
      recentBars.shift();
    const bar = byMinute.get(minute) ?? null;
    if (!bar) {
      if (recentBars.length)
        metrics[minute - SESSION_START].stockReturn =
          recentBars.at(-1)!.bar.close / recentBars[0].bar.open - 1;
      continue;
    }
    partialBucket = aggregateBar(partialBucket, bar);
    const currentAtrValues = [
      ...currentAtrState.completedTrueRanges.slice(-13),
      trueRange(partialBucket, currentAtrState.previousClose),
    ];
    const fallbackAtrValues = [
      ...fallbackAtrState.completedTrueRanges.slice(-13),
      trueRange(partialBucket, fallbackAtrState.previousClose),
    ];
    const atrValues = currentAtrValues.length >= 14
      ? currentAtrValues
      : fallbackAtrValues;
    const atr =
      atrValues.length >= 14
        ? atrValues.reduce((sum, value) => sum + value, 0) / atrValues.length
        : null;
    recentBars.push({ minute, bar });
    const effectiveRecentBars = bridgeRegularOpenWindow(recentBars.map((row) => row.bar), minute, priorSessionBars);
    const rangeAtr =
      atr && atr > 0 && effectiveRecentBars.length
        ? (Math.max(...effectiveRecentBars.map((row) => row.high)) -
            Math.min(...effectiveRecentBars.map((row) => row.low))) /
          atr
        : null;
    const pathEfficiency =
      atr && atr > 0
        ? calculatePathEfficiency(effectiveRecentBars, atr).value
        : null;
    cumulativePriceVolume +=
      ((bar.high + bar.low + bar.close) / 3) * bar.volume;
    cumulativeVolume += bar.volume;
    const vwap =
      cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null;
    ema9 = ema9 === null ? bar.close : bar.close * 0.2 + ema9 * 0.8;
    sessionHigh = Math.max(sessionHigh, bar.high);
    sessionLow = Math.min(sessionLow, bar.low);
    if (
      atr &&
      (sessionHigh - bar.close >= 0.3 * atr ||
        bar.close - sessionLow >= 0.3 * atr)
    )
      pullbackObserved = true;
    consecutiveExpansion =
      atr && (bar.high - bar.low) / atr >= 0.2 ? consecutiveExpansion + 1 : 0;
    const priceLostVwap =
      previousPrice !== null &&
      previousVwap !== null &&
      previousPrice >= previousVwap &&
      vwap !== null &&
      bar.close < vwap;
    metrics[minute - SESSION_START] = {
      bar,
      atr,
      rangeAtr,
      pathEfficiency,
      stockReturn:
        effectiveRecentBars.length && effectiveRecentBars[0].open > 0
          ? bar.close / effectiveRecentBars[0].open - 1
          : null,
      stockVsBenchmarkMagnitude: null,
      sectorVsBenchmarkMagnitude: null,
      vwap,
      ema9,
      consecutiveExpansionBars: consecutiveExpansion,
      pullbackObserved,
      priceLostVwap,
    };
    previousPrice = bar.close;
    previousVwap = vwap;
  }
  if (partialBucket) {
    currentAtrState.completedTrueRanges.push(
      trueRange(partialBucket, currentAtrState.previousClose),
    );
    if (currentAtrState.completedTrueRanges.length > 14)
      currentAtrState.completedTrueRanges.shift();
    currentAtrState.previousClose = partialBucket.close;
    fallbackAtrState.completedTrueRanges.push(
      trueRange(partialBucket, fallbackAtrState.previousClose),
    );
    if (fallbackAtrState.completedTrueRanges.length > 14)
      fallbackAtrState.completedTrueRanges.shift();
    fallbackAtrState.previousClose = partialBucket.close;
  }
  return metrics;
}
function buildDayMetrics(
  symbolBars: Map<string, Candle[]>,
  priorSessionBars: Map<string, Candle[]> | null,
): DayMetrics {
  const metrics: DayMetrics = new Map();
  for (const symbol of universeSymbols) {
    const state: AtrState = buildPriorSessionAtrSeed(priorSessionBars?.get(symbol) ?? []);
    metrics.set(
      symbol,
      buildSymbolMetrics(symbolBars.get(symbol) ?? [], state, priorSessionBars?.get(symbol) ?? []),
    );
  }
  for (const entry of ATTENTION_UNIVERSE) {
    const stock = metrics.get(entry.symbol)!,
      benchmark = metrics.get(entry.benchmark)!,
      sector = entry.sectorEtf ? metrics.get(entry.sectorEtf)! : null;
    for (let index = 0; index < stock.length; index += 1) {
      const sr = stock[index].stockReturn,
        br = benchmark[index].stockReturn,
        er = sector?.[index].stockReturn ?? null;
      stock[index].stockVsBenchmarkMagnitude =
        sr === null || br === null ? null : Math.abs(sr - br);
      stock[index].sectorVsBenchmarkMagnitude =
        er === null || br === null ? null : Math.abs(er - br);
    }
  }
  return metrics;
}
function staticSipModes(path: string): Map<string, StaticMode> {
  const payload = readJsonGzip<BaselineModeMapPayload>(path);
  return new Map(
    payload.records
      .filter((record) => universeSet.has(record.symbol))
      .map((record) => [
        `${record.symbol}|${record.minuteEt}`,
        { mode: record.mode, pPresent: record.pPresent },
      ]),
  );
}
function deriveIexModes(
  root: string,
  metadata: FeedArchiveMetadata,
  sessionDates: readonly string[],
): Map<string, StaticMode> {
  const counts = new Map<string, number>(),
    dates = new Set(sessionDates);
  for (const group of groupIntradayPaths(metadata)) {
    const month = loadMonth(root, group.paths);
    for (const [date, symbols] of month) {
      if (!dates.has(date)) continue;
      for (const [symbol, bars] of symbols)
        for (const bar of bars) {
          const minute = getEasternTimePartsForCandleTime(
            bar.time,
          ).minutesSinceMidnight;
          const key = `${symbol}|${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
  }
  const total = sessionDates.length,
    result = new Map<string, StaticMode>();
  for (const symbol of universeSymbols)
    for (let minute = SESSION_START; minute < SESSION_END; minute += 1) {
      const minuteEt = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
        key = `${symbol}|${minuteEt}`,
        present = counts.get(key) ?? 0;
      result.set(key, {
        mode:
          present / total >= 0.6 ? "dense" : present > 0 ? "sparse" : "dead",
        pPresent: present / total,
      });
    }
  return result;
}
function modeCode(mode: BaselineMode): BaselineModeCode {
  return mode === "dense" ? 0 : mode === "sparse" ? 1 : 2;
}
function continuousZ(
  history: ReadonlyArray<number | null>,
  current: number,
  axis: "participation" | "displacement" | "idiosyncrasy",
  transform: "linear" | "log1p" = "linear",
): number | null {
  return buildContinuousSameTimeBaseline({
    axis,
    historicalValues: history,
    currentValue: current,
    minSessions: MIN_BASELINE_SESSIONS,
    transform,
    dataQualityState: "ok",
  }).value;
}
function unboundedZ(
  history: ReadonlyArray<number | null>,
  current: number,
  axis: "participation" | "displacement" | "idiosyncrasy",
  transform: (value: number) => number = (value) => value,
): number | null {
  return buildContinuousSameTimeBaseline({
    axis,
    historicalValues: history.map((value) =>
      value === null ? null : transform(value),
    ),
    currentValue: transform(current),
    minSessions: MIN_BASELINE_SESSIONS,
    zClamp: Number.POSITIVE_INFINITY,
    dataQualityState: "ok",
  }).value;
}
function average(values: ReadonlyArray<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : null;
}
function saturationFeatureFor(
  input: {
    dateIndex: number;
    symbolIndex: number;
    symbol: string;
    minute: number;
    current: DayMetrics;
    history: readonly DayMetrics[];
  },
  feature: FeatureTuple,
): SaturationTuple {
  const metric = input.current.get(input.symbol)![input.minute - SESSION_START],
    bar = metric.bar!;
  const historyMetrics = input.history.map(
    (day) => day.get(input.symbol)![input.minute - SESSION_START],
  );
  const participationKind = feature[5],
    baselineMode = feature[6];
  const volumeRaw =
    participationKind === 0
      ? unboundedZ(
          historyMetrics.map((row) => row.bar?.volume ?? null),
          bar.volume,
          "participation",
        )
      : null;
  const dollarRaw =
    participationKind === 0
      ? unboundedZ(
          historyMetrics.map((row) =>
            row.bar ? row.bar.volume * row.bar.close : null,
          ),
          bar.volume * bar.close,
          "participation",
        )
      : null;
  const volumeLog =
    participationKind === 0
      ? unboundedZ(
          historyMetrics.map((row) => row.bar?.volume ?? null),
          bar.volume,
          "participation",
          Math.log1p,
        )
      : null;
  const dollarLog =
    participationKind === 0
      ? unboundedZ(
          historyMetrics.map((row) =>
            row.bar ? row.bar.volume * row.bar.close : null,
          ),
          bar.volume * bar.close,
          "participation",
          Math.log1p,
        )
      : null;
  const participationRaw =
    participationKind === 0
      ? (average([volumeRaw, dollarRaw]) ?? feature[4])
      : feature[4];
  const participationLog =
    participationKind === 0
      ? (average([volumeLog, dollarLog]) ?? feature[4])
      : feature[4];
  const rangeRaw = unboundedZ(
    historyMetrics.map((row) => row.rangeAtr),
    metric.rangeAtr!,
    "displacement",
  );
  const rangeLog = unboundedZ(
    historyMetrics.map((row) => row.rangeAtr),
    metric.rangeAtr!,
    "displacement",
    Math.log1p,
  );
  const pathRaw =
    metric.pathEfficiency === null
      ? null
      : unboundedZ(
          historyMetrics.map((row) => row.pathEfficiency),
          metric.pathEfficiency,
          "displacement",
        );
  const displacementRaw = average([rangeRaw, pathRaw]) ?? feature[7];
  const displacementLog = average([rangeLog, pathRaw]) ?? feature[7];
  const stockRaw =
    metric.stockVsBenchmarkMagnitude === null
      ? null
      : unboundedZ(
          historyMetrics.map((row) => row.stockVsBenchmarkMagnitude),
          metric.stockVsBenchmarkMagnitude,
          "idiosyncrasy",
        );
  const sectorRaw =
    metric.sectorVsBenchmarkMagnitude === null
      ? null
      : unboundedZ(
          historyMetrics.map((row) => row.sectorVsBenchmarkMagnitude),
          metric.sectorVsBenchmarkMagnitude,
          "idiosyncrasy",
        );
  const idiosyncrasyRaw = Math.max(
    ...([stockRaw, sectorRaw].filter((value): value is number => value !== null)
      .length
      ? [stockRaw, sectorRaw].filter((value): value is number => value !== null)
      : [0]),
  );
  return [
    input.dateIndex,
    input.symbolIndex,
    input.minute,
    participationKind,
    baselineMode,
    feature[4],
    participationRaw,
    participationLog,
    feature[7],
    displacementRaw,
    displacementLog,
    feature[8],
    idiosyncrasyRaw,
    volumeRaw,
    dollarRaw,
    volumeLog,
    dollarLog,
    rangeRaw,
    rangeLog,
    pathRaw,
    stockRaw,
    sectorRaw,
  ];
}
function featureFor(input: {
  dateIndex: number;
  symbolIndex: number;
  tradingDate: string;
  symbol: string;
  minute: number;
  current: DayMetrics;
  history: readonly DayMetrics[];
  modes: Map<string, StaticMode>;
  feedMode: AttentionFeedMode;
}): FeatureResult {
  const metric = input.current.get(input.symbol)![input.minute - SESSION_START],
    bar = metric.bar;
  if (!bar) return { feature: null, reason: "no_target_bar" };
  if (metric.atr === null || metric.rangeAtr === null)
    return { feature: null, reason: "target_metrics_unavailable" };
  const minuteEt = `${String(Math.floor(input.minute / 60)).padStart(2, "0")}:${String(input.minute % 60).padStart(2, "0")}`,
    mode = input.modes.get(`${input.symbol}|${minuteEt}`);
  if (!mode)
    throw new Error(`Missing baseline mode for ${input.symbol} ${minuteEt}.`);
  const historyMetrics = input.history.map(
    (day) => day.get(input.symbol)![input.minute - SESSION_START],
  );
  if (historyMetrics.length < MIN_BASELINE_SESSIONS)
    return { feature: null, reason: "history_short" };
  let participationInput: number, participationKind: ParticipationKindCode;
  if (mode.mode === "dense") {
    const volumeZ = continuousZ(
        historyMetrics.map((row) => row.bar?.volume ?? null),
        bar.volume,
        "participation",
        "log1p",
      ),
      dollarZ = continuousZ(
        historyMetrics.map((row) =>
          row.bar ? row.bar.volume * row.bar.close : null,
        ),
        bar.volume * bar.close,
        "participation",
        "log1p",
      );
    const values = [volumeZ, dollarZ].filter(
      (value): value is number => value !== null,
    );
    if (!values.length)
      return { feature: null, reason: "participation_baseline_unavailable" };
    participationInput =
      values.reduce((sum, value) => sum + value, 0) / values.length;
    participationKind = 0;
  } else {
    participationInput =
      mode.mode === "dead" ? 6 : Math.min(6, -Math.log2(mode.pPresent));
    participationKind = 1;
  }
  const rangeZ = continuousZ(
      historyMetrics.map((row) => row.rangeAtr),
      metric.rangeAtr,
      "displacement",
      "log1p",
    ),
    pathZ =
      metric.pathEfficiency === null
        ? null
        : continuousZ(
            historyMetrics.map((row) => row.pathEfficiency),
            metric.pathEfficiency,
            "displacement",
          );
  const displacementValues = [rangeZ, pathZ].filter(
    (value): value is number => value !== null,
  );
  if (!displacementValues.length)
    return { feature: null, reason: "displacement_baseline_unavailable" };
  const displacementZ =
    displacementValues.reduce((sum, value) => sum + value, 0) /
    displacementValues.length;
  const stockZ =
    metric.stockVsBenchmarkMagnitude === null
      ? null
      : continuousZ(
          historyMetrics.map((row) => row.stockVsBenchmarkMagnitude),
          metric.stockVsBenchmarkMagnitude,
          "idiosyncrasy",
        );
  const sectorZ =
    metric.sectorVsBenchmarkMagnitude === null
      ? null
      : continuousZ(
          historyMetrics.map((row) => row.sectorVsBenchmarkMagnitude),
          metric.sectorVsBenchmarkMagnitude,
          "idiosyncrasy",
        );
  const idioValues = [stockZ, sectorZ].filter(
    (value): value is number => value !== null,
  );
  if (input.feedMode === "iex_partial" && !idioValues.length) {
    return {
      feature: null,
      reason:
        metric.stockVsBenchmarkMagnitude === null
          ? "benchmark_reference_missing"
          : "reference_baseline_unavailable",
    };
  }
  const idiosyncrasyZ = idioValues.length ? Math.max(...idioValues) : 0;
  const entry = universeBySymbol.get(input.symbol)!,
    limitedHistory =
      entry.listedSince !== undefined &&
      tradingSessionsSince(entry.listedSince, input.tradingDate) < 120;
  return {
    feature: [
      input.dateIndex,
      input.symbolIndex,
      bar.time * 1000,
      input.minute,
      participationInput,
      participationKind,
      modeCode(mode.mode),
      displacementZ,
      idiosyncrasyZ,
      bar.close,
      metric.atr,
      metric.vwap,
      metric.ema9,
      metric.consecutiveExpansionBars,
      metric.pullbackObserved ? 1 : 0,
      metric.priceLostVwap ? 1 : 0,
      limitedHistory ? 1 : 0,
    ],
    reason: "scoreable",
  };
}

function writeSessionFile(input: {
  outRoot: string;
  feedMode: AttentionFeedMode;
  feed: "sip" | "iex";
  tradingDate: string;
  sourceMetadataSha256: string;
  bars: Map<string, Candle[]>;
  priorSessionBars: Map<string, Candle[]> | null;
}): { path: string; sha256: string; bytes: number; bars: number } {
  const dir = resolve(input.outRoot, "sessions", input.feedMode);
  mkdirSync(dir, { recursive: true });
  const payload = stableJson({
    schemaVersion: 2,
    warmup: { source: "prior_session_regular", completedFiveMinuteBars: 13, overnightGapTreatment: "first_current_bar_true_range_vs_previous_regular_close" },
    tradingDate: input.tradingDate,
    feed: input.feed,
    feedMode: input.feedMode,
    adjustment: LIVE_BAR_ADJUSTMENT,
    source: "checksummed_historical_archive",
    sourceMetadataSha256: input.sourceMetadataSha256,
    bars: Object.fromEntries(
      universeSymbols.map((symbol) => [symbol, input.bars.get(symbol) ?? []]),
    ),
    priorSessionRegularBars: Object.fromEntries(
      universeSymbols.map((symbol) => [symbol, priorRegularSessionBars(input.priorSessionBars?.get(symbol) ?? [])]),
    ),
  });
  const compressed = gzipSync(Buffer.from(payload), { level: 9 }),
    path = resolve(dir, `${input.tradingDate}.json.gz`);
  writeFileSync(path, compressed);
  writeFileSync(`${path}.sha256`, `${sha256(compressed)}  ${basename(path)}\n`);
  return {
    path,
    sha256: sha256(compressed),
    bytes: compressed.length,
    bars: [...input.bars.values()].reduce((sum, rows) => sum + rows.length, 0),
  };
}
function writeSaturationFile(input: {
  outRoot: string;
  feedMode: AttentionFeedMode;
  tradingDate: string;
  rows: SaturationTuple[];
}): { path: string; sha256: string; bytes: number; rows: number } {
  const dir = resolve(input.outRoot, "saturation-features", input.feedMode);
  mkdirSync(dir, { recursive: true });
  const relativePath = `saturation-features/${input.feedMode}/${input.tradingDate}.json.gz`;
  const payload = stableJson({
    schemaVersion: 1,
    tradingDate: input.tradingDate,
    feedMode: input.feedMode,
    rows: input.rows,
  });
  const compressed = gzipSync(Buffer.from(payload), { level: 9 });
  const path = resolve(input.outRoot, relativePath);
  writeFileSync(path, compressed);
  writeFileSync(`${path}.sha256`, `${sha256(compressed)}  ${basename(path)}\n`);
  return {
    path: relativePath,
    sha256: sha256(compressed),
    bytes: compressed.length,
    rows: input.rows.length,
  };
}

function processFeed(input: {
  root: string;
  metadata: FeedArchiveMetadata;
  metadataSha256: string;
  feedMode: AttentionFeedMode;
  feed: "sip" | "iex";
  manifest: readonly ManifestSession[];
  modes: Map<string, StaticMode>;
  outRoot: string;
}) {
  const selected = new Set(input.manifest.map((row) => row.tradingDate)),
    dateIndex = new Map(
      input.manifest.map((row, index) => [row.tradingDate, index]),
    ),
    symbolIndex = new Map(
      rankableSymbols.map((symbol, index) => [symbol, index]),
    );
  let previousTradingBars: Map<string, Candle[]> | null = null;
  const history: DayMetrics[] = [];
  const tuples: FeatureTuple[] = [],
    saturationFiles: ReturnType<typeof writeSaturationFile>[] = [],
    sessionFiles: ReturnType<typeof writeSessionFile>[] = [],
    coverage: Record<string, { evaluated: number; scoreable: number }> = {},
    inputAvailability: Record<
      string,
      Record<string, Record<string, number>>
    > = {};
  for (const group of groupIntradayPaths(input.metadata)) {
    const month = loadMonth(input.root, group.paths);
    for (const [tradingDate, bars] of [...month.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (!exchangeCalendarDay(tradingDate).isTradingDay) continue;
      const current = buildDayMetrics(bars, previousTradingBars);
      if (selected.has(tradingDate)) {
        sessionFiles.push(
          writeSessionFile({
            outRoot: input.outRoot,
            feedMode: input.feedMode,
            feed: input.feed,
            tradingDate,
            sourceMetadataSha256: input.metadataSha256,
            bars,
            priorSessionBars: previousTradingBars,
          }),
        );
        const row = { evaluated: 0, scoreable: 0 };
        const saturationRows: SaturationTuple[] = [];
        for (let minute = SESSION_START; minute < SESSION_END; minute += 1) {
          if (subWindowAt(minute) === null) continue;
          for (const symbol of rankableSymbols) {
            row.evaluated += 1;
            const result = featureFor({
              dateIndex: dateIndex.get(tradingDate)!,
              symbolIndex: symbolIndex.get(symbol)!,
              tradingDate,
              symbol,
              minute,
              current,
              history,
              modes: input.modes,
              feedMode: input.feedMode,
            });
            const window = subWindowAt(minute)!;
            inputAvailability[tradingDate] ??= {};
            inputAvailability[tradingDate][window] ??= {};
            inputAvailability[tradingDate][window][result.reason] =
              (inputAvailability[tradingDate][window][result.reason] ?? 0) + 1;
            if (result.feature) {
              tuples.push(result.feature);
              saturationRows.push(
                saturationFeatureFor(
                  {
                    dateIndex: dateIndex.get(tradingDate)!,
                    symbolIndex: symbolIndex.get(symbol)!,
                    symbol,
                    minute,
                    current,
                    history,
                  },
                  result.feature,
                ),
              );
              row.scoreable += 1;
            }
          }
        }
        saturationFiles.push(
          writeSaturationFile({
            outRoot: input.outRoot,
            feedMode: input.feedMode,
            tradingDate,
            rows: saturationRows,
          }),
        );
        coverage[tradingDate] = row;
      }
      history.push(current);
      if (history.length > BASELINE_LOOKBACK) history.shift();
      previousTradingBars = bars;
    }
  }
  return {
    tuples,
    saturationFiles,
    sessionFiles,
    coverage,
    inputAvailability,
  };
}
function main(): void {
  const sipRoot = resolve("data/archive/sip-split"),
    iexRoot = resolve("data/archive/iex-partial-calibration"),
    outRoot = resolve("data/replay/calibration");
  mkdirSync(outRoot, { recursive: true });
  const sipMetadataBytes = readFileSync(resolve(sipRoot, "metadata.json")),
    iexMetadataBytes = readFileSync(resolve(iexRoot, "metadata.json"));
  const sipMetadata = JSON.parse(
      sipMetadataBytes.toString("utf8"),
    ) as ArchiveMetadata,
    iexMetadata = JSON.parse(
      iexMetadataBytes.toString("utf8"),
    ) as FeedArchiveMetadata;
  if (
    sipMetadata.feed !== "sip" ||
    sipMetadata.adjustment !== LIVE_BAR_ADJUSTMENT
  )
    throw new Error(
      "SIP calibration source is not verified split-adjusted SIP.",
    );
  if (
    iexMetadata.feed !== "iex" ||
    iexMetadata.adjustment !== LIVE_BAR_ADJUSTMENT ||
    iexMetadata.symbols.length !== 68
  )
    throw new Error("IEX calibration source is invalid.");
  const profiles = loadDailyProfiles(sipRoot, sipMetadata),
    manifestPath = resolve(outRoot, "session-manifest.json");
  const previousManifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
        sessions: ManifestSession[];
      })
    : null;
  const halts: HaltCandidate[] = previousManifest
    ? previousManifest.sessions.flatMap((row) =>
        row.haltCandidate ? [row.haltCandidate] : [],
      )
    : scanHaltCandidates(sipRoot, sipMetadata);
  const manifestSessions =
    previousManifest?.sessions ?? selectSessions(profiles, halts);
  const sipModes = staticSipModes(
      resolve("data/replay/reports/baseline-modes.json.gz"),
    ),
    iexModes = deriveIexModes(
      iexRoot,
      iexMetadata,
      profiles.map((row) => row.tradingDate),
    );
  const manifestBase = {
    schemaVersion: 1,
    purpose: "population_calibration_only",
    disclosure: PRE_STREAM_REPLAY_DISCLOSURE,
    groundTruthValidation: "not_in_scope",
    feedSources: {
      sip: { root: sipRoot, metadataSha256: sha256(sipMetadataBytes) },
      iex_partial: { root: iexRoot, metadataSha256: sha256(iexMetadataBytes) },
    },
    universeHash: sha256(stableJson(ATTENTION_UNIVERSE)),
    universe: ATTENTION_UNIVERSE,
    warmup: { source: "prior_session_regular", completedFiveMinuteBars: 13, overnightGapTreatment: "first_current_bar_true_range_vs_previous_regular_close" },
    fetchedSymbols: universeSymbols.length,
    rankedSymbols: rankableSymbols.length,
    referenceOnlySymbols: universeSymbols.length - rankableSymbols.length,
    sessions: manifestSessions,
  };
  const splitHash = sha256(stableJson(manifestBase)),
    manifest = { ...manifestBase, splitHash };
  writeFileSync(
    resolve(outRoot, "session-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const sip = processFeed({
    root: sipRoot,
    metadata: sipMetadata,
    metadataSha256: sha256(sipMetadataBytes),
    feedMode: "sip",
    feed: "sip",
    manifest: manifestSessions,
    modes: sipModes,
    outRoot,
  });
  const iex = processFeed({
    root: iexRoot,
    metadata: iexMetadata,
    metadataSha256: sha256(iexMetadataBytes),
    feedMode: "iex_partial",
    feed: "iex",
    manifest: manifestSessions,
    modes: iexModes,
    outRoot,
  });
  const featurePayload = {
    schemaVersion: 1,
    splitHash,
    dates: manifestSessions.map((row) => row.tradingDate),
    symbols: rankableSymbols,
    tupleSchema: [
      "dateIndex",
      "symbolIndex",
      "at",
      "minuteEt",
      "participationInput",
      "participationKind",
      "baselineMode",
      "displacementZ",
      "idiosyncrasyZ",
      "price",
      "atr",
      "vwap",
      "ema9",
      "consecutiveExpansionBars",
      "pullbackObserved",
      "priceLostVwap",
      "dataQuality",
    ],
    codes: {
      participationKind: { 0: "z", 1: "surprise_bits" },
      baselineMode: { 0: "dense", 1: "sparse", 2: "dead" },
      dataQuality: { 0: "ok", 1: "limited_history" },
    },
    feeds: { sip: sip.tuples, iex_partial: iex.tuples },
  };
  const featureBytes = gzipSync(Buffer.from(stableJson(featurePayload)), {
    level: 9,
  });
  writeFileSync(resolve(outRoot, "raw-features.json.gz"), featureBytes);
  writeFileSync(
    resolve(outRoot, "raw-features.sha256"),
    `${sha256(featureBytes)}  raw-features.json.gz\n`,
  );
  const saturationIndexBase = {
    schemaVersion: 1,
    scope: "experimental_saturation_diagnosis",
    splitHash,
    dates: featurePayload.dates,
    symbols: rankableSymbols,
    tupleSchema: [
      "dateIndex",
      "symbolIndex",
      "minuteEt",
      "participationKind",
      "baselineMode",
      "participationClamped",
      "participationUnclamped",
      "participationLogUnclamped",
      "displacementClamped",
      "displacementUnclamped",
      "displacementRangeLogUnclamped",
      "idiosyncrasyClamped",
      "idiosyncrasyUnclamped",
      "volumeZUnclamped",
      "dollarVolumeZUnclamped",
      "logVolumeZUnclamped",
      "logDollarVolumeZUnclamped",
      "rangeZUnclamped",
      "logRangeZUnclamped",
      "pathEfficiencyZUnclamped",
      "stockVsBenchmarkZUnclamped",
      "sectorVsBenchmarkZUnclamped",
    ],
    files: { sip: sip.saturationFiles, iex_partial: iex.saturationFiles },
  };
  const saturationIndex = {
    ...saturationIndexBase,
    artifactHash: sha256(stableJson(saturationIndexBase)),
  };
  writeFileSync(
    resolve(outRoot, "saturation-features-index.json"),
    `${JSON.stringify(saturationIndex, null, 2)}\n`,
  );
  const corpusIndex = {
    schemaVersion: 2,
    splitHash,
    rawFeaturesSha256: sha256(featureBytes),
    rawFeatureRows: { sip: sip.tuples.length, iex_partial: iex.tuples.length },
    sessionFiles: { sip: sip.sessionFiles, iex_partial: iex.sessionFiles },
    coverage: { sip: sip.coverage, iex_partial: iex.coverage },
    inputAvailability: {
      sip: sip.inputAvailability,
      iex_partial: iex.inputAvailability,
    },
    haltCandidates: halts.slice(0, 20),
  };
  writeFileSync(
    resolve(outRoot, "corpus-index.json"),
    `${JSON.stringify(corpusIndex, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        splitHash,
        sessions: manifestSessions.length,
        train: manifestSessions.filter((row) => row.split === "train").length,
        holdout: manifestSessions.filter((row) => row.split === "holdout")
          .length,
        regimes: Object.fromEntries(
          [
            "trending_up",
            "trending_down",
            "chopping",
            "quiet",
            "high_volatility",
          ].map((regime) => [
            regime,
            manifestSessions.filter((row) =>
              row.tags.includes(regime as Regime),
            ).length,
          ]),
        ),
        earlyClose: manifestSessions
          .filter((row) => row.earlyClose)
          .map((row) => row.tradingDate),
        holidayAdjacent: manifestSessions
          .filter((row) => row.holidayAdjacent)
          .map((row) => row.tradingDate),
        haltCandidateSessions: manifestSessions
          .filter((row) => row.haltCandidate)
          .map((row) => ({ date: row.tradingDate, halt: row.haltCandidate })),
        rawFeatureRows: corpusIndex.rawFeatureRows,
        rawFeaturesSha256: corpusIndex.rawFeaturesSha256,
      },
      null,
      2,
    ),
  );
}
try {
  main();
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
}
