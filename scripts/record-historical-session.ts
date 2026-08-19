import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { AlpacaProvider } from "../lib/market-data/providers/alpacaProvider";
import { alpacaCredentials } from "../lib/replay/env";
import { ARCHIVE_SYMBOLS } from "../lib/replay/universe";
import {
  assertHistoricalSipWindow,
  assertSipResponseFeed,
  LIVE_BAR_ADJUSTMENT,
  sha256,
  stableJson,
} from "../lib/replay/archive";
import type { RecordedSession } from "../lib/replay/types";
import { getCurrentTradingDate } from "../lib/risk/tradingDate";

const value = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

async function main(): Promise<void> {
  const tradingDate = value("date");
  if (!tradingDate) throw new Error("Usage: npm run record:session -- --date YYYY-MM-DD [--symbols AAPL,NVDA]");
  const symbols = (value("symbols")?.split(",") ?? [...ARCHIVE_SYMBOLS]).map((s) => s.trim().toUpperCase());
  const day = Date.parse(`${tradingDate}T00:00:00Z`);
  const start = new Date(day - 12 * 60 * 60_000).toISOString();
  const end = new Date(day + 36 * 60 * 60_000).toISOString();
  assertHistoricalSipWindow(end, Date.now());

  const provider = new AlpacaProvider({ ...alpacaCredentials(), feed: "sip", isPaidPlan: false });
  if (!provider.getCandlesMulti) throw new Error("Provider does not support getCandlesMulti.");
  const bars: RecordedSession["bars"] = Object.fromEntries(symbols.map((symbol) => [symbol, {}]));
  for (const timeframe of ["1m", "5m"] as const) {
    const result = await provider.getCandlesMulti({ symbols, timeframe, start, end, adjustment: LIVE_BAR_ADJUSTMENT });
    assertSipResponseFeed(result.requestedFeed, result.responseFeed);
    for (const symbol of symbols) {
      bars[symbol][timeframe] = (result.candlesBySymbol[symbol] ?? []).filter(
        (bar) => getCurrentTradingDate(new Date(bar.time * 1000)) === tradingDate
      );
    }
  }
  const dailyStart = new Date(day - 45 * 86400_000).toISOString();
  const daily = await provider.getCandlesMulti({ symbols, timeframe: "1d", start: dailyStart, end, adjustment: LIVE_BAR_ADJUSTMENT });
  assertSipResponseFeed(daily.requestedFeed, daily.responseFeed);
  for (const symbol of symbols) bars[symbol]["1d"] = daily.candlesBySymbol[symbol] ?? [];

  const session: RecordedSession = {
    schemaVersion: 1,
    tradingDate,
    feed: "sip",
    adjustment: LIVE_BAR_ADJUSTMENT,
    source: "historical_pull",
    recordedAt: new Date().toISOString(),
    bars,
  };
  const encoded = Buffer.from(stableJson(session));
  const compressed = gzipSync(encoded, { level: 9 });
  const outputDir = resolve(value("out") ?? "data/replay/sessions");
  mkdirSync(outputDir, { recursive: true });
  const output = resolve(outputDir, `${tradingDate}.json.gz`);
  writeFileSync(output, compressed);
  writeFileSync(`${output}.sha256`, `${sha256(compressed)}  ${tradingDate}.json.gz\n`);
  console.log(JSON.stringify({ output, symbols: symbols.length, bytes: compressed.length, sha256: sha256(compressed) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
