import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { calculateVwap } from "@/lib/indicators/vwap";
import { getEasternTimePartsForCandleTime } from "@/lib/market-data/easternTime";
import type { Candle } from "@/types/candle";

export type LabelChartLevelKind =
  | "hod"
  | "lod"
  | "premarket_high"
  | "premarket_low"
  | "prior_close"
  | "opening_range_high"
  | "opening_range_low";

export interface LabelChartLevel {
  kind: LabelChartLevelKind;
  label: string;
  value: number;
}

export interface ArchiveLabelChartData {
  source: "sip_split_archive";
  feed: "sip";
  adjustment: "split";
  tradingDate: string;
  symbol: string;
  bars: Candle[];
  vwap: Array<{ time: number; value: number }>;
  levels: LabelChartLevel[];
  markerTime: number | null;
  regularSession: { firstBarTime: number | null; lastBarTime: number | null };
}

interface ArchiveMetadataFile { path: string }
interface ArchiveMetadata {
  feed: string;
  adjustment: string;
  files: ArchiveMetadataFile[];
}

interface ArchiveChunk {
  feed: string;
  adjustment: string;
  timeframe: string;
  bars: Record<string, Candle[]>;
}

const symbolFileIndexes = new Map<string, Map<string, string[]>>();
const chartCache = new Map<string, ArchiveLabelChartData>();

function assertDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error("Chart trading date must be YYYY-MM-DD.");
  }
}

function assertSymbol(symbol: string): void {
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error("Chart symbol is invalid.");
}

function archiveChunk(path: string): ArchiveChunk {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as ArchiveChunk;
}

function filenameWindowContains(path: string, tradingDate: string): boolean {
  const match = path.match(/^\w+-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})-/);
  return match !== null && tradingDate >= match[1] && tradingDate <= match[2];
}

function eligibleFiles(metadata: ArchiveMetadata, timeframe: "1m" | "1d", tradingDate: string): string[] {
  return metadata.files
    .map((file) => file.path)
    .filter((path) => path.startsWith(`${timeframe}-`) && (timeframe === "1d" || filenameWindowContains(path, tradingDate)))
    .sort();
}

function symbolFileIndex(archiveRoot: string, paths: readonly string[], indexKey: string): Map<string, string[]> {
  const cached = symbolFileIndexes.get(indexKey);
  if (cached) return cached;
  const index = new Map<string, string[]>();
  for (const relativePath of paths) {
    const chunk = archiveChunk(resolve(archiveRoot, relativePath));
    if (chunk.feed !== "sip" || chunk.adjustment !== "split") {
      throw new Error(`Chart archive chunk ${relativePath} is not verified SIP split-adjusted data.`);
    }
    for (const symbol of Object.keys(chunk.bars)) {
      index.set(symbol, [...(index.get(symbol) ?? []), relativePath]);
    }
  }
  symbolFileIndexes.set(indexKey, index);
  return index;
}

function barsForSymbol(
  archiveRoot: string,
  paths: readonly string[],
  indexKey: string,
  symbol: string,
  tradingDate?: string
): Candle[] {
  const index = symbolFileIndex(archiveRoot, paths, indexKey);
  const byTime = new Map<number, Candle>();
  for (const relativePath of index.get(symbol) ?? []) {
    const chunk = archiveChunk(resolve(archiveRoot, relativePath));
    for (const bar of chunk.bars[symbol] ?? []) {
      if (!tradingDate || getEasternTimePartsForCandleTime(bar.time).date === tradingDate) byTime.set(bar.time, bar);
    }
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function markerForTime(bars: readonly Candle[], becameInteresting: string): number | null {
  const match = becameInteresting.match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  const targetMinute = Number(match[1]) * 60 + Number(match[2]);
  return bars.find((bar) => getEasternTimePartsForCandleTime(bar.time).minutesSinceMidnight >= targetMinute)?.time ?? null;
}

function level(kind: LabelChartLevelKind, label: string, value: number | null): LabelChartLevel[] {
  return value === null || !Number.isFinite(value) ? [] : [{ kind, label, value }];
}

export function buildArchiveLabelChart(input: {
  tradingDate: string;
  symbol: string;
  bars: readonly Candle[];
  priorClose: number | null;
  becameInteresting: string;
}): ArchiveLabelChartData {
  const bars = [...input.bars].sort((a, b) => a.time - b.time);
  if (bars.length === 0) throw new Error(`No archived 1-minute bars for ${input.symbol} on ${input.tradingDate}.`);
  const timed = bars.map((bar) => ({ bar, minute: getEasternTimePartsForCandleTime(bar.time).minutesSinceMidnight }));
  const premarket = timed.filter(({ minute }) => minute >= 4 * 60 && minute < 9 * 60 + 30).map(({ bar }) => bar);
  const regular = timed.filter(({ minute }) => minute >= 9 * 60 + 30 && minute < 16 * 60).map(({ bar }) => bar);
  const opening = timed.filter(({ minute }) => minute >= 9 * 60 + 30 && minute < 9 * 60 + 45).map(({ bar }) => bar);
  const maximum = (values: readonly number[]) => values.length === 0 ? null : Math.max(...values);
  const minimum = (values: readonly number[]) => values.length === 0 ? null : Math.min(...values);
  const levels = [
    ...level("hod", "HOD", maximum(bars.map((bar) => bar.high))),
    ...level("lod", "LOD", minimum(bars.map((bar) => bar.low))),
    ...level("premarket_high", "PMH", maximum(premarket.map((bar) => bar.high))),
    ...level("premarket_low", "PML", minimum(premarket.map((bar) => bar.low))),
    ...level("prior_close", "Prior close", input.priorClose),
    ...level("opening_range_high", "ORH", maximum(opening.map((bar) => bar.high))),
    ...level("opening_range_low", "ORL", minimum(opening.map((bar) => bar.low))),
  ];
  const vwap = calculateVwap(bars).map((value, index) => ({ time: bars[index].time, value }));
  return {
    source: "sip_split_archive",
    feed: "sip",
    adjustment: "split",
    tradingDate: input.tradingDate,
    symbol: input.symbol,
    bars,
    vwap,
    levels,
    markerTime: markerForTime(bars, input.becameInteresting),
    regularSession: {
      firstBarTime: regular[0]?.time ?? null,
      lastBarTime: regular.at(-1)?.time ?? null,
    },
  };
}

export function loadArchiveLabelChart(input: {
  archiveRoot?: string;
  tradingDate: string;
  symbol: string;
  becameInteresting: string;
}): ArchiveLabelChartData {
  assertDate(input.tradingDate);
  const symbol = input.symbol.trim().toUpperCase();
  assertSymbol(symbol);
  const archiveRoot = resolve(input.archiveRoot ?? "data/archive/sip-split");
  const cacheKey = `${archiveRoot}|${input.tradingDate}|${symbol}|${input.becameInteresting}`;
  const cached = chartCache.get(cacheKey);
  if (cached) return cached;
  const metadata = JSON.parse(readFileSync(resolve(archiveRoot, "metadata.json"), "utf8")) as ArchiveMetadata;
  if (metadata.feed !== "sip" || metadata.adjustment !== "split") {
    throw new Error("Label charts require the verified SIP split-adjusted archive.");
  }
  const minutePaths = eligibleFiles(metadata, "1m", input.tradingDate);
  const bars = barsForSymbol(archiveRoot, minutePaths, `${archiveRoot}|1m|${input.tradingDate}`, symbol, input.tradingDate);
  const dailyPaths = eligibleFiles(metadata, "1d", input.tradingDate);
  const daily = barsForSymbol(archiveRoot, dailyPaths, `${archiveRoot}|1d`, symbol);
  const priorClose = daily
    .filter((bar) => getEasternTimePartsForCandleTime(bar.time).date < input.tradingDate)
    .at(-1)?.close ?? null;
  const chart = buildArchiveLabelChart({
    tradingDate: input.tradingDate,
    symbol,
    bars,
    priorClose,
    becameInteresting: input.becameInteresting,
  });
  chartCache.set(cacheKey, chart);
  return chart;
}

export function clearArchiveLabelChartCachesForTest(): void {
  symbolFileIndexes.clear();
  chartCache.clear();
}
