import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { AlpacaProvider } from "../lib/market-data/providers/alpacaProvider";
import { RateLimiter } from "../lib/market-data/rateLimiter";
import { alpacaCredentials } from "../lib/replay/env";
import {
  assertArchiveMatchesLive,
  assertHistoricalSipWindow,
  assertSipResponseFeed,
  LIVE_BAR_ADJUSTMENT,
  sha256,
  stableJson,
  type ArchiveMetadata,
} from "../lib/replay/archive";
import { acquireListingDateResolutions } from "../lib/replay/listingDateHistory";
import { assertAssetIdentity, filterBarsForListingIdentity, mergeArchiveMetadata, type AlpacaAssetIdentity, type ArchiveSymbolPolicy } from "../lib/replay/archiveMerge";
import type { Candle } from "../types/candle";

const REQUESTS_PER_MINUTE = 180;
const REQUEST_SPACING_MS = 350;
const value = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

function parseSymbolMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(raw.split(",").filter(Boolean).map((item) => {
    const separator = item.indexOf(":");
    if (separator < 1) throw new Error(`Expected SYMBOL:value entry, got ${item}.`);
    return [item.slice(0, separator).trim().toUpperCase(), item.slice(separator + 1).trim()];
  }));
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

async function fetchAsset(symbol: string, credentials: { apiKeyId: string; apiSecretKey: string }): Promise<AlpacaAssetIdentity> {
  const response = await fetch(`https://paper-api.alpaca.markets/v2/assets/${encodeURIComponent(symbol)}`, {
    headers: { "APCA-API-KEY-ID": credentials.apiKeyId, "APCA-API-SECRET-KEY": credentials.apiSecretKey },
  });
  if (!response.ok) throw new Error(`Asset identity lookup failed for ${symbol}: ${response.status} ${response.statusText}`);
  return await response.json() as AlpacaAssetIdentity;
}

function verifyExistingMetadata(root: string, metadata: ArchiveMetadata): void {
  assertArchiveMatchesLive(metadata);
  if (metadata.feed !== "sip") throw new Error("Supplement target is not labelled SIP.");
  for (const file of metadata.files) {
    const bytes = readFileSync(resolve(root, file.path));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Existing archive checksum mismatch: ${file.path}`);
  }
}

async function main(): Promise<void> {
  const symbols = [...new Set((value("symbols") ?? "").split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length === 0) throw new Error("Usage: npm run archive:merge -- --symbols SNDK,WDC,... --listed-since SPCX:YYYY-MM-DD");
  const root = resolve(value("archive") ?? "data/archive/sip-split");
  const existing = JSON.parse(readFileSync(resolve(root, "metadata.json"), "utf8")) as ArchiveMetadata;
  verifyExistingMetadata(root, existing);
  const alreadyPresent = symbols.filter((symbol) => existing.symbols.includes(symbol));
  if (alreadyPresent.length > 0) throw new Error(`Archive already contains requested symbols: ${alreadyPresent.join(", ")}`);

  const listedSince = parseSymbolMap(value("listed-since"));
  const expectedNames = parseSymbolMap(value("expected-name"));
  const deriveListing = [...new Set((value("derive-listing") ?? "").split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  const listingInputs: Record<string, string | null> = { ...listedSince, ...Object.fromEntries(deriveListing.map((symbol) => [symbol, listedSince[symbol] ?? null])) };
  if (symbols.includes("SPCX") && !listedSince.SPCX) throw new Error("SPCX requires an explicit listedSince date so the vacated ETF history cannot enter the archive.");
  const policies = Object.fromEntries(symbols.map((symbol) => [symbol, {
    listedSince: listedSince[symbol],
    expectedAssetName: expectedNames[symbol] ?? (symbol === "SPCX" ? "Space Exploration Technologies" : undefined),
  } satisfies ArchiveSymbolPolicy]));

  const credentials = alpacaCredentials();
  const identities: Record<string, AlpacaAssetIdentity> = {};
  for (const symbol of symbols) {
    const asset = await fetchAsset(symbol, credentials);
    assertAssetIdentity(symbol, asset, policies[symbol]);
    identities[symbol] = asset;
  }
  for (const symbol of Object.keys(listingInputs)) {
    if (!symbols.includes(symbol)) throw new Error(`Listing derivation was supplied for unrequested symbol ${symbol}.`);
  }
  const listingDateAcquisition = Object.keys(listingInputs).length > 0
    ? await acquireListingDateResolutions(
      new AlpacaProvider(
        { ...credentials, feed: "sip", isPaidPlan: false },
        new RateLimiter(REQUESTS_PER_MINUTE, 60_000),
        30_000,
        10_000,
        REQUEST_SPACING_MS
      ),
      listingInputs,
      existing.end,
      {
        listingGapDays: Number(value("listing-gap-days") ?? 45),
        listingDateToleranceDays: Number(value("listing-date-tolerance-days") ?? 5),
        whenIssuedProbeSessions: Number(value("when-issued-probe-sessions") ?? 10),
        whenIssuedVolumeRatio: Number(value("when-issued-volume-ratio") ?? 0.20),
        whenIssuedComparisonSessions: Number(value("when-issued-comparison-sessions") ?? 30),
      }
    )
    : { resolutions: [], pagesFetched: 0 };
  for (const resolution of listingDateAcquisition.resolutions) {
    if (listedSince[resolution.symbol]) policies[resolution.symbol].listedSince = resolution.effectiveListedSince;
  }

  const dailyFile = existing.files.find((file) => file.path.startsWith("1d-"));
  if (!dailyFile) throw new Error("Existing archive has no daily chunk from which to recover the 24-month window.");
  const dailyPayload = JSON.parse(gunzipSync(readFileSync(resolve(root, dailyFile.path))).toString("utf8")) as { timeframe: string; start: string; end: string };
  if (dailyPayload.timeframe !== "1d" || dailyPayload.end !== existing.end) throw new Error("Existing daily archive window does not match metadata.");
  const tasks = [
    ...(["1m", "5m"] as const).flatMap((timeframe) => monthWindows(new Date(existing.start), new Date(existing.end)).map((window) => ({ timeframe, ...window }))),
    { timeframe: "1d" as const, start: dailyPayload.start, end: dailyPayload.end },
  ];
  const supplementId = sha256(stableJson({ symbols, start: existing.start, end: existing.end, policies })).slice(0, 12);
  const staging = resolve(root, `.supplement-${supplementId}`);
  mkdirSync(staging, { recursive: true });
  const provider = new AlpacaProvider(
    { ...credentials, feed: "sip", isPaidPlan: false },
    new RateLimiter(REQUESTS_PER_MINUTE, 60_000),
    30_000,
    10_000,
    REQUEST_SPACING_MS
  );
  if (!provider.getCandlesMulti) throw new Error("Provider does not support getCandlesMulti.");

  const supplementFiles: ArchiveMetadata["files"] = [];
  const discardedPreListingBars: Record<string, number> = Object.fromEntries(symbols.map((symbol) => [symbol, 0]));
  for (const task of tasks) {
    assertHistoricalSipWindow(task.end, Date.now());
    const stem = `${task.timeframe}-${task.start.slice(0, 10)}-${task.end.slice(0, 10)}-supplement-${supplementId}.json.gz`;
    const stagedPath = resolve(staging, stem);
    if (!existsSync(stagedPath)) {
      const result = await provider.getCandlesMulti({ symbols, timeframe: task.timeframe, start: task.start, end: task.end, adjustment: LIVE_BAR_ADJUSTMENT });
      assertSipResponseFeed(result.requestedFeed, result.responseFeed);
      const bars: Record<string, Candle[]> = {};
      for (const symbol of symbols) {
        const filtered = filterBarsForListingIdentity(symbol, result.candlesBySymbol[symbol] ?? [], policies[symbol]);
        bars[symbol] = filtered.candles;
        discardedPreListingBars[symbol] += filtered.discardedPreListingBars;
      }
      const payload = stableJson({ feed: "sip", adjustment: LIVE_BAR_ADJUSTMENT, timeframe: task.timeframe, start: task.start, end: task.end, symbols, policies, bars: bars });
      writeFileSync(stagedPath, gzipSync(Buffer.from(payload), { level: 9 }));
      console.log(JSON.stringify({ timeframe: task.timeframe, start: task.start, end: task.end, pages: result.pagination.pagesFetched }));
    }
    const bytes = readFileSync(stagedPath);
    const restored = JSON.parse(gunzipSync(bytes).toString("utf8")) as { feed: string; adjustment: string; timeframe: string; start: string; end: string; bars: Record<string, Candle[]> };
    if (restored.feed !== "sip" || restored.adjustment !== LIVE_BAR_ADJUSTMENT || restored.timeframe !== task.timeframe || restored.start !== task.start || restored.end !== task.end) throw new Error(`Staged supplement metadata mismatch: ${stem}`);
    supplementFiles.push({ path: stem, bytes: bytes.length, bars: Object.values(restored.bars).reduce((sum, bars) => sum + bars.length, 0), sha256: sha256(bytes) });
  }

  const merged = mergeArchiveMetadata(existing, symbols, supplementFiles, new Date().toISOString());
  const metadataWithSupplement = {
    ...merged,
    symbolPolicies: { ...((existing as ArchiveMetadata & { symbolPolicies?: Record<string, ArchiveSymbolPolicy> }).symbolPolicies ?? {}), ...policies },
    listingDateDerivations: {
      ...((existing as ArchiveMetadata & { listingDateDerivations?: Record<string, unknown> }).listingDateDerivations ?? {}),
      ...Object.fromEntries(listingDateAcquisition.resolutions.map((resolution) => [resolution.symbol, resolution])),
    },
    supplements: [
      ...((existing as ArchiveMetadata & { supplements?: unknown[] }).supplements ?? []),
      { id: supplementId, symbols, files: supplementFiles.map((file) => file.path), identities, discardedPreListingBars, listingDateResolutions: listingDateAcquisition.resolutions },
    ],
  };
  assertArchiveMatchesLive(metadataWithSupplement);
  for (const file of supplementFiles) {
    const stagedPath = resolve(staging, file.path);
    const destination = resolve(root, file.path);
    if (dirname(destination) !== root) throw new Error(`Unsafe archive destination: ${destination}`);
    if (existsSync(destination)) throw new Error(`Archive destination already exists: ${basename(destination)}`);
    renameSync(stagedPath, destination);
  }
  rmdirSync(staging);
  const metadataJson = stableJson(metadataWithSupplement);
  writeFileSync(resolve(root, "metadata.json"), metadataJson);
  writeFileSync(resolve(root, "metadata.sha256"), `${sha256(metadataJson)}  metadata.json\n`);
  console.log(JSON.stringify({ root, supplementId, symbols, files: supplementFiles.length, bars: supplementFiles.reduce((sum, file) => sum + file.bars, 0), discardedPreListingBars, listingDateAcquisition, metadataSha256: sha256(metadataJson) }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
