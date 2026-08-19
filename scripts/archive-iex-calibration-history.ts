import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { AlpacaProvider } from "../lib/market-data/providers/alpacaProvider";
import { RateLimiter } from "../lib/market-data/rateLimiter";
import { HISTORICAL_SIP_DELAY_MS, LIVE_BAR_ADJUSTMENT, sha256, stableJson } from "../lib/replay/archive";
import { alpacaCredentials } from "../lib/replay/env";

const REQUESTS_PER_MINUTE = 175;
const REQUEST_SPACING_MS = 360;
const SYMBOL_BATCH_SIZE = 20;

interface IexCalibrationArchiveMetadata {
  formatVersion: 1;
  purpose: "attention_population_calibration";
  createdAt: string;
  feed: "iex";
  feedMode: "iex_partial";
  adjustment: typeof LIVE_BAR_ADJUSTMENT;
  start: string;
  end: string;
  symbols: string[];
  timeframes: ["1m"];
  files: Array<{ path: string; bytes: number; bars: number; sha256: string }>;
}

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

function assertHistoricalWindow(end: string): void {
  const endMs = Date.parse(end);
  if (!Number.isFinite(endMs) || endMs > Date.now() - HISTORICAL_SIP_DELAY_MS) {
    throw new Error("Historical IEX calibration end must be at least 15 minutes old; request was not issued.");
  }
}

async function main(): Promise<void> {
  const end = new Date(value("end") ?? "2026-08-15T23:59:59.000Z");
  assertHistoricalWindow(end.toISOString());
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const outputDir = resolve(value("out") ?? "data/archive/iex-partial-calibration");
  mkdirSync(outputDir, { recursive: true });
  const symbols = ATTENTION_UNIVERSE.map((entry) => entry.symbol);
  const provider = new AlpacaProvider(
    { ...alpacaCredentials(), feed: "iex", isPaidPlan: false },
    new RateLimiter(REQUESTS_PER_MINUTE, 60_000),
    30_000,
    10_000,
    REQUEST_SPACING_MS
  );
  if (!provider.getCandlesMulti) throw new Error("Provider does not support getCandlesMulti.");
  const files: IexCalibrationArchiveMetadata["files"] = [];

  for (const window of monthWindows(start, end)) {
    assertHistoricalWindow(window.end);
    let batchIndex = 0;
    for (const symbolBatch of chunks(symbols, SYMBOL_BATCH_SIZE)) {
      const stem = `1m-${window.start.slice(0, 10)}-${window.end.slice(0, 10)}-${String(batchIndex).padStart(2, "0")}.json.gz`;
      const destination = resolve(outputDir, stem);
      if (existsSync(destination)) {
        const compressed = readFileSync(destination);
        const restored = JSON.parse(gunzipSync(compressed).toString("utf8")) as {
          feed: string; adjustment: string; timeframe: string; start: string; end: string; bars: Record<string, unknown[]>;
        };
        if (restored.feed !== "iex" || restored.adjustment !== LIVE_BAR_ADJUSTMENT || restored.timeframe !== "1m"
          || restored.start !== window.start || restored.end !== window.end) {
          throw new Error(`Existing IEX calibration chunk metadata mismatch: ${stem}`);
        }
        files.push({ path: stem, bytes: compressed.length, bars: Object.values(restored.bars).reduce((sum, bars) => sum + bars.length, 0), sha256: sha256(compressed) });
        console.log(JSON.stringify({ window: window.start.slice(0, 10), batch: batchIndex, resumed: true }));
        batchIndex += 1;
        continue;
      }
      const result = await provider.getCandlesMulti({
        symbols: symbolBatch,
        timeframe: "1m",
        start: window.start,
        end: window.end,
        adjustment: LIVE_BAR_ADJUSTMENT,
      });
      if (result.requestedFeed !== "iex" || result.responseFeed !== "iex") {
        throw new Error(`IEX calibration response feed is ${result.responseFeed ?? "unverifiable"}; refusing to write ${stem}.`);
      }
      const compressed = gzipSync(Buffer.from(stableJson({
        feed: "iex", adjustment: LIVE_BAR_ADJUSTMENT, timeframe: "1m", start: window.start, end: window.end,
        bars: result.candlesBySymbol,
      })), { level: 9 });
      writeFileSync(destination, compressed);
      files.push({ path: stem, bytes: compressed.length, bars: Object.values(result.candlesBySymbol).reduce((sum, bars) => sum + bars.length, 0), sha256: sha256(compressed) });
      console.log(JSON.stringify({ window: window.start.slice(0, 10), batch: batchIndex, pages: result.pagination.pagesFetched }));
      batchIndex += 1;
    }
  }

  const metadata: IexCalibrationArchiveMetadata = {
    formatVersion: 1,
    purpose: "attention_population_calibration",
    createdAt: new Date().toISOString(),
    feed: "iex",
    feedMode: "iex_partial",
    adjustment: LIVE_BAR_ADJUSTMENT,
    start: start.toISOString(),
    end: end.toISOString(),
    symbols,
    timeframes: ["1m"],
    files,
  };
  const metadataJson = `${stableJson(metadata)}\n`;
  writeFileSync(resolve(outputDir, "metadata.json"), metadataJson);
  writeFileSync(resolve(outputDir, "metadata.sha256"), `${sha256(metadataJson)}  metadata.json\n`);
  console.log(JSON.stringify({ outputDir, symbols: symbols.length, files: files.length, metadataSha256: sha256(metadataJson) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
