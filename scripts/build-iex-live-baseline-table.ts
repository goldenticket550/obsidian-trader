import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { exchangeCalendarDay } from "../lib/attention/exchangeCalendar";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { getEasternTimePartsForCandleTime } from "../lib/market-data/easternTime";
import { assertIexBaselineTable, buildIexBaselineTable, type IexBaselineSessionBars, type IexBaselineTable } from "../lib/attention-runtime/iexBaselineTable";
import { sha256 } from "../lib/replay/archive";
import type { Candle } from "../types/candle";

interface ArchiveMetadata {
  feed: "iex";
  adjustment: "split";
  files: Array<{ path: string; sha256: string }>;
}
interface Chunk { feed: "iex"; adjustment: "split"; timeframe: "1m"; bars: Record<string, Candle[]> }
interface Day { tradingDate: string; bars: Record<string, Candle[]> }

const archiveRoot = resolve("data/archive/iex-partial-calibration");
const symbols = ATTENTION_UNIVERSE.map((entry) => entry.symbol);
const bySymbol = new Map(ATTENTION_UNIVERSE.map((entry) => [entry.symbol, entry]));

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function groups(metadata: ArchiveMetadata): string[][] {
  const grouped = new Map<string, string[]>();
  for (const file of metadata.files.filter((entry) => entry.path.startsWith("1m-"))) {
    const match = /^1m-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})/.exec(file.path);
    if (!match) continue;
    const key = `${match[1]}|${match[2]}`;
    grouped.set(key, [...(grouped.get(key) ?? []), file.path]);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, paths]) => paths.sort());
}
function loadLatestConsecutiveSessions(): IexBaselineSessionBars[] {
  const metadata = JSON.parse(readFileSync(resolve(archiveRoot, "metadata.json"), "utf8")) as ArchiveMetadata;
  if (metadata.feed !== "iex" || metadata.adjustment !== "split") throw new Error("IEX baseline archive provenance mismatch.");
  const expected = new Map(metadata.files.map((file) => [file.path, file.sha256]));
  const rolling: Day[] = [];
  for (const paths of groups(metadata)) {
    const byDate = new Map<string, Record<string, Candle[]>>();
    for (const relative of paths) {
      const compressed = readFileSync(resolve(archiveRoot, relative));
      if (sha256(compressed) !== expected.get(relative)) throw new Error(`IEX archive checksum mismatch: ${relative}.`);
      const chunk = JSON.parse(gunzipSync(compressed).toString("utf8")) as Chunk;
      if (chunk.feed !== "iex" || chunk.adjustment !== "split" || chunk.timeframe !== "1m") throw new Error(`IEX archive chunk metadata mismatch: ${relative}.`);
      for (const [symbol, rows] of Object.entries(chunk.bars)) {
        const entry = bySymbol.get(symbol);
        if (!entry) continue;
        for (const bar of rows) {
          const parts = getEasternTimePartsForCandleTime(bar.time);
          if (!exchangeCalendarDay(parts.date).isTradingDay || parts.minutesSinceMidnight < 240 || parts.minutesSinceMidnight >= 1200) continue;
          if (entry.listedSince && parts.date < entry.listedSince) continue;
          const record = byDate.get(parts.date) ?? Object.fromEntries(symbols.map((item) => [item, []]));
          record[symbol].push(bar);
          byDate.set(parts.date, record);
        }
      }
    }
    for (const [tradingDate, bars] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const rows of Object.values(bars)) rows.sort((a, b) => a.time - b.time);
      rolling.push({ tradingDate, bars });
      if (rolling.length > 41) rolling.shift();
    }
  }
  if (rolling.length !== 41) throw new Error(`Expected 41 consecutive IEX sessions including warm-up; got ${rolling.length}.`);
  return rolling.slice(1).map((day, index) => ({
    tradingDate: day.tradingDate,
    bars: day.bars,
    priorSessionRegularBars: rolling[index].bars,
  }));
}

function preserveExistingOk(candidate: IexBaselineTable, previous: IexBaselineTable): IexBaselineTable {
  const changedReferences = new Set(["SPY", "QQQ", "IWM", "SMH", "GLD", "SLV", "IBIT", "DRAM", "SPCX"]);
  for (const [key, bucket] of Object.entries(candidate.buckets)) {
    const old = previous.buckets[key];
    if (!old) continue;
    for (const field of ["volume", "dollarVolume", "rangeAtr", "pathEfficiency"] as const) {
      if (old[field].state === "ok") bucket[field] = old[field];
    }
    if (!changedReferences.has(bucket.symbol)) {
      if (old.stockMagnitude.state === "ok") bucket.stockMagnitude = old.stockMagnitude;
      if (old.sectorMagnitude.state === "ok") bucket.sectorMagnitude = old.sectorMagnitude;
    }
  }
  const { tableId: _discarded, ...candidateUnsigned } = candidate;
  const unsigned = {
    ...candidateUnsigned,
    coverageRepair: {
      historySelection: "latest_40_consecutive_sessions" as const,
      preservedExistingOkFromTableId: previous.tableId,
      preservationRule: "unchanged_reference_and_existing_ok" as const,
    },
  };
  return { ...unsigned, tableId: hash(unsigned) };
}

const startedAt = performance.now();
const candidate = buildIexBaselineTable(loadLatestConsecutiveSessions());
const previous = JSON.parse(readFileSync(resolve("data/replay/calibration/iex-live-baseline-table.pre-open-coverage.json"), "utf8")) as IexBaselineTable;
const table = preserveExistingOk(candidate, previous);
assertIexBaselineTable(table);
const path = resolve("data/replay/calibration/iex-live-baseline-table.json");
writeFileSync(path, `${JSON.stringify(table)}\n`);
console.log(JSON.stringify({ path, tableId: table.tableId, sessions: table.historyTradingDates.length, firstHistoryDate: table.historyTradingDates[0], lastHistoryDate: table.historyTradingDates.at(-1), buckets: Object.keys(table.buckets).length, buildMs: Math.round((performance.now() - startedAt) * 100) / 100 }, null, 2));
