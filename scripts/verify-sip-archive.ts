import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { AlpacaProvider } from "../lib/market-data/providers/alpacaProvider";
import { alpacaCredentials } from "../lib/replay/env";
import {
  assertArchiveMatchesLive,
  assertEmpiricalFeedRatios,
  assertHistoricalSipWindow,
  assertSipResponseFeed,
  LIVE_BAR_ADJUSTMENT,
  sha256,
  stableJson,
  type ArchiveMetadata,
} from "../lib/replay/archive";
import type { Candle } from "../types/candle";
import { getSessionTypeForTimestamp } from "../lib/market-data/session";
import { getCurrentTradingDate } from "../lib/risk/tradingDate";

const value = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

async function main(): Promise<void> {
  const root = resolve(value("archive") ?? "data/archive/sip-split");
  const requiredSymbols = [...new Set((value("symbols") ?? "").split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  let metadataBytes = readFileSync(resolve(root, "metadata.json"));
  const metadata = JSON.parse(metadataBytes.toString("utf8")) as ArchiveMetadata;
  assertArchiveMatchesLive(metadata);
  if (metadata.feed !== "sip" || !["response_attested", "empirical_volume_ratio"].includes(metadata.feedVerification)) throw new Error("Archive metadata does not attest SIP provenance.");
  const mismatches: string[] = [];
  for (const file of metadata.files) {
    const bytes = readFileSync(resolve(root, file.path));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) mismatches.push(file.path);
  }
  if (mismatches.length > 0) throw new Error(`Checksum mismatch: ${mismatches.join(", ")}`);

  const candidatesBySymbol = new Map<string, { symbol: string; candle: Candle }>();
  const minuteFiles = readdirSync(root).filter((name) => name.startsWith("1m-") && name.endsWith(".json.gz")).sort();
  for (const name of minuteFiles) {
    const payload = JSON.parse(gunzipSync(readFileSync(resolve(root, name))).toString("utf8")) as { bars: Record<string, Candle[]> };
    for (const [symbol, bars] of Object.entries(payload.bars).sort(([a], [b]) => a.localeCompare(b))) {
      if (bars.length === 0 || candidatesBySymbol.has(symbol)) continue;
      if (requiredSymbols.length > 0 && !requiredSymbols.includes(symbol)) continue;
      candidatesBySymbol.set(symbol, { symbol, candle: bars[Math.floor(bars.length / 2)] });
      if (requiredSymbols.length === 0 && candidatesBySymbol.size >= 10) break;
    }
    if ((requiredSymbols.length === 0 && candidatesBySymbol.size >= 10) || (requiredSymbols.length > 0 && requiredSymbols.every((symbol) => candidatesBySymbol.has(symbol)))) break;
  }
  const missingSpotChecks = requiredSymbols.filter((symbol) => !candidatesBySymbol.has(symbol));
  if (missingSpotChecks.length > 0) throw new Error(`Archive has no 1m spot-check candidate for: ${missingSpotChecks.join(", ")}`);
  const candidates = [...candidatesBySymbol.values()].slice(0, requiredSymbols.length > 0 ? requiredSymbols.length : 10);
  if (requiredSymbols.length === 0 && candidates.length < 10) throw new Error(`Archive has only ${candidates.length} spot-check candidates.`);

  const provider = new AlpacaProvider({ ...alpacaCredentials(), feed: "sip", isPaidPlan: false });
  const verified: Array<{ symbol: string; time: number }> = [];
  for (const sample of candidates) {
    const start = new Date(sample.candle.time * 1000).toISOString();
    const end = new Date((sample.candle.time + 60) * 1000).toISOString();
    assertHistoricalSipWindow(end, Date.now());
    const result = await provider.getCandlesMulti!({ symbols: [sample.symbol], timeframe: "1m", start, end, adjustment: LIVE_BAR_ADJUSTMENT });
    assertSipResponseFeed(result.requestedFeed, result.responseFeed);
    const actual = result.candlesBySymbol[sample.symbol]?.find((bar) => bar.time === sample.candle.time);
    const matches = actual !== undefined && actual.time === sample.candle.time && actual.open === sample.candle.open && actual.high === sample.candle.high && actual.low === sample.candle.low && actual.close === sample.candle.close && actual.volume === sample.candle.volume;
    if (!matches) throw new Error(`API spot check failed for ${sample.symbol} at ${start}.`);
    verified.push({ symbol: sample.symbol, time: sample.candle.time });
  }

  const empiricalSymbols = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL"];
  const empiricalDate = "2025-08-18";
  const sipVolumes = Object.fromEntries(empiricalSymbols.map((symbol) => [symbol, 0])) as Record<string, number>;
  for (const name of minuteFiles.filter((file) => file.includes("2025-08-15-2025-09-01"))) {
    const payload = JSON.parse(gunzipSync(readFileSync(resolve(root, name))).toString("utf8")) as { bars: Record<string, Candle[]> };
    for (const symbol of empiricalSymbols) {
      sipVolumes[symbol] += (payload.bars[symbol] ?? []).filter((bar) => getCurrentTradingDate(new Date(bar.time * 1000)) === empiricalDate).filter((bar) => getSessionTypeForTimestamp(new Date(bar.time * 1000)) === "regular").reduce((sum, bar) => sum + bar.volume, 0);
    }
  }
  const iexProvider = new AlpacaProvider({ ...alpacaCredentials(), feed: "iex", isPaidPlan: false });
  const iex = await iexProvider.getCandlesMulti!({ symbols: empiricalSymbols, timeframe: "1m", start: empiricalDate + "T13:30:00.000Z", end: empiricalDate + "T20:00:00.000Z", adjustment: LIVE_BAR_ADJUSTMENT });
  if (iex.requestedFeed !== "iex" || iex.responseFeed !== "iex") throw new Error("IEX comparison response was not feed-attested.");
  const observations = empiricalSymbols.map((symbol) => {
    const iexVolume = (iex.candlesBySymbol[symbol] ?? []).reduce((sum, bar) => sum + bar.volume, 0);
    const sipVolume = sipVolumes[symbol];
    return { symbol, sipVolume, iexVolume, ratio: iexVolume === 0 ? Number.NaN : sipVolume / iexVolume };
  });
  const ratioBand = { min: 8, max: 60 };
  assertEmpiricalFeedRatios(observations, ratioBand.min, ratioBand.max);
  metadata.feedVerification = "empirical_volume_ratio";
  metadata.feedEvidence = { method: "sip_to_iex_regular_volume_ratio", tradingDate: empiricalDate, ratioBand, observations };
  metadataBytes = Buffer.from(stableJson(metadata));
  writeFileSync(resolve(root, "metadata.json"), metadataBytes);
  writeFileSync(resolve(root, "metadata.sha256"), sha256(metadataBytes) + "  metadata.json\n");
  console.log(JSON.stringify({ archive: root, metadataSha256: sha256(metadataBytes), files: metadata.files.length, bytes: metadata.files.reduce((sum, file) => sum + file.bytes, 0), bars: metadata.files.reduce((sum, file) => sum + file.bars, 0), checksumsVerified: metadata.files.length, apiSpotChecksVerified: verified, empiricalFeedEvidence: metadata.feedEvidence }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
