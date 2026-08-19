import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { AlpacaProvider } from "../lib/market-data/providers/alpacaProvider";
import { RateLimiter } from "../lib/market-data/rateLimiter";
import { alpacaCredentials } from "../lib/replay/env";
import { ARCHIVE_SYMBOLS } from "../lib/replay/universe";
import {
  ARCHIVE_FORMAT_VERSION,
  assertArchiveMatchesLive,
  assertHistoricalSipWindow,
  assertSipResponseFeed,
  LIVE_BAR_ADJUSTMENT,
  sha256,
  stableJson,
  type ArchiveMetadata,
} from "../lib/replay/archive";

const REQUESTS_PER_MINUTE = 180;
const SYMBOL_BATCH_SIZE = 20;
const value = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function monthWindows(start: Date, end: Date): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  let cursor = new Date(start);
  while (cursor < end) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const capped = next < end ? next : end;
    windows.push({ start: cursor.toISOString(), end: capped.toISOString() });
    cursor = capped;
  }
  return windows;
}

async function main(): Promise<void> {
  const archiveEnd = new Date(value("end") ?? `${new Date(Date.now() - 86400_000).toISOString().slice(0, 10)}T23:59:59Z`);
  assertHistoricalSipWindow(archiveEnd.toISOString(), Date.now());
  const intradayStart = new Date(archiveEnd); intradayStart.setUTCFullYear(intradayStart.getUTCFullYear() - 1);
  const dailyStart = new Date(archiveEnd); dailyStart.setUTCFullYear(dailyStart.getUTCFullYear() - 2);
  const symbols = (value("symbols")?.split(",") ?? [...ARCHIVE_SYMBOLS]).map((symbol) => symbol.trim().toUpperCase());
  const outputDir = resolve(value("out") ?? "data/archive/sip-split");
  mkdirSync(outputDir, { recursive: true });
  const provider = new AlpacaProvider(
    { ...alpacaCredentials(), feed: "sip", isPaidPlan: false },
    new RateLimiter(REQUESTS_PER_MINUTE, 60_000),
    30_000,
    10_000,
    350
  );
  if (!provider.getCandlesMulti) throw new Error("Provider does not support getCandlesMulti.");
  const files: ArchiveMetadata["files"] = [];

  const tasks = [
    ...(["1m", "5m"] as const).flatMap((timeframe) => monthWindows(intradayStart, archiveEnd).map((window) => ({ timeframe, ...window }))),
    { timeframe: "1d" as const, start: dailyStart.toISOString(), end: archiveEnd.toISOString() },
  ];
  for (const task of tasks) {
    assertHistoricalSipWindow(task.end, Date.now());
    let batchIndex = 0;
    for (const symbolBatch of chunks(symbols, SYMBOL_BATCH_SIZE)) {
      const stem = `${task.timeframe}-${task.start.slice(0, 10)}-${task.end.slice(0, 10)}-${String(batchIndex).padStart(2, "0")}.json.gz`;
      const destination = resolve(outputDir, stem);
      if (existsSync(destination)) {
        const compressed = readFileSync(destination);
        const restored = JSON.parse(gunzipSync(compressed).toString("utf8")) as {
          feed: string; adjustment: string; timeframe: string; start: string; end: string;
          bars: Record<string, unknown[]>;
        };
        if (restored.feed !== "sip" || restored.adjustment !== LIVE_BAR_ADJUSTMENT ||
            restored.timeframe !== task.timeframe || restored.start !== task.start || restored.end !== task.end) {
          throw new Error(`Existing archive chunk metadata mismatch: ${stem}`);
        }
        files.push({ path: stem, bytes: compressed.length,
          bars: Object.values(restored.bars).reduce((sum, bars) => sum + bars.length, 0),
          sha256: sha256(compressed) });
        batchIndex += 1;
        console.log(JSON.stringify({ timeframe: task.timeframe, start: task.start, batchIndex, resumed: true }));
        continue;
      }
      const result = await provider.getCandlesMulti({
        symbols: symbolBatch,
        timeframe: task.timeframe,
        start: task.start,
        end: task.end,
        adjustment: LIVE_BAR_ADJUSTMENT,
      });
      assertSipResponseFeed(result.requestedFeed, result.responseFeed);
      const payload = stableJson({
        feed: "sip", adjustment: LIVE_BAR_ADJUSTMENT, timeframe: task.timeframe,
        start: task.start, end: task.end, bars: result.candlesBySymbol,
      });
      const compressed = gzipSync(Buffer.from(payload), { level: 9 });
      writeFileSync(destination, compressed);
      files.push({
        path: stem,
        bytes: compressed.length,
        bars: Object.values(result.candlesBySymbol).reduce((sum, bars) => sum + bars.length, 0),
        sha256: sha256(compressed),
      });
      batchIndex += 1;
      console.log(JSON.stringify({ timeframe: task.timeframe, start: task.start, batchIndex, pages: result.pagination.pagesFetched }));
    }
  }
  const metadata: ArchiveMetadata = {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    feed: "sip",
    feedVerification: "response_attested",
    adjustment: LIVE_BAR_ADJUSTMENT,
    start: intradayStart.toISOString(),
    end: archiveEnd.toISOString(),
    symbols,
    timeframes: ["1m", "5m", "1d"],
    files,
  };
  assertArchiveMatchesLive(metadata);
  const metadataJson = `${stableJson(metadata)}\n`;
  writeFileSync(resolve(outputDir, "metadata.json"), metadataJson);
  writeFileSync(resolve(outputDir, "metadata.sha256"), `${sha256(metadataJson)}  metadata.json\n`);
  console.log(JSON.stringify({ outputDir, files: files.length, metadataSha256: sha256(metadataJson) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
