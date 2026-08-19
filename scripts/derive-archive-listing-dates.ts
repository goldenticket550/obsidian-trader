import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { ATTENTION_UNIVERSE_BY_SYMBOL } from "../lib/attention/universe";
import { AlpacaProvider } from "../lib/market-data/providers/alpacaProvider";
import { RateLimiter } from "../lib/market-data/rateLimiter";
import { acquireListingDateResolutions } from "../lib/replay/listingDateHistory";
import { assertArchiveMatchesLive, sha256, stableJson, type ArchiveMetadata } from "../lib/replay/archive";
import { filterBarsForListingIdentity, type ArchiveSymbolPolicy } from "../lib/replay/archiveMerge";
import { alpacaCredentials } from "../lib/replay/env";
import type { ListingDateResolution } from "../lib/replay/listingDates";
import type { Candle } from "../types/candle";

const value = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

interface ExtendedArchiveMetadata extends ArchiveMetadata {
  symbolPolicies?: Record<string, ArchiveSymbolPolicy>;
  listingDateDerivations?: Record<string, ListingDateResolution>;
  supplements?: Array<{
    symbols?: string[];
    files?: string[];
    discardedPreListingBars?: Record<string, number>;
    [key: string]: unknown;
  }>;
}

interface ArchiveChunk {
  policies?: Record<string, ArchiveSymbolPolicy>;
  bars: Record<string, Candle[]>;
  [key: string]: unknown;
}

async function main(): Promise<void> {
  const archiveRoot = resolve(value("archive") ?? "data/archive/sip-split");
  const reportPath = resolve(value("out") ?? "data/replay/reports/listing-date-derivations.json");
  const metadataPath = resolve(archiveRoot, "metadata.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as ExtendedArchiveMetadata;
  assertArchiveMatchesLive(metadata);
  if (metadata.feed !== "sip") throw new Error("Listing-date audit requires an explicit SIP archive.");

  const requested = (value("symbols") ?? "SNDK,NBIS,CRWV").split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
  const authoredDates: Record<string, string> = {};
  for (const symbol of requested) {
    if (!metadata.symbols.includes(symbol)) throw new Error(`Cannot audit ${symbol}: symbol is absent from archive metadata.`);
    const configured = ATTENTION_UNIVERSE_BY_SYMBOL.get(symbol);
    if (!configured?.listedSince) throw new Error(`Cannot audit ${symbol}: authored universe has no listedSince hint.`);
    authoredDates[symbol] = configured.listedSince;
  }

  const provider = new AlpacaProvider(
    { ...alpacaCredentials(), feed: "sip", isPaidPlan: false },
    new RateLimiter(180, 60_000),
    30_000,
    10_000,
    350
  );
  const acquired = await acquireListingDateResolutions(provider, authoredDates, metadata.end, {
    listingGapDays: Number(value("listing-gap-days") ?? 45),
    listingDateToleranceDays: Number(value("listing-date-tolerance-days") ?? 5),
    whenIssuedProbeSessions: Number(value("when-issued-probe-sessions") ?? 10),
    whenIssuedVolumeRatio: Number(value("when-issued-volume-ratio") ?? 0.20),
    whenIssuedComparisonSessions: Number(value("when-issued-comparison-sessions") ?? 30),
  });
  const bySymbol = new Map(acquired.resolutions.map((resolution) => [resolution.symbol, resolution]));
  const affectedPaths = new Set(
    (metadata.supplements ?? [])
      .filter((supplement) => supplement.symbols?.some((symbol) => bySymbol.has(symbol)))
      .flatMap((supplement) => supplement.files ?? [])
  );
  if (affectedPaths.size === 0) throw new Error("No archive supplement files matched the derived listing symbols.");

  const staged = new Map<string, Buffer>();
  const stagedBarCounts = new Map<string, number>();
  const discarded: Record<string, number> = Object.fromEntries(requested.map((symbol) => [symbol, 0]));
  for (const relativePath of affectedPaths) {
    const path = resolve(archiveRoot, relativePath);
    const payload = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as ArchiveChunk;
    let touched = false;
    payload.policies = { ...(payload.policies ?? {}) };
    for (const [symbol, resolution] of bySymbol) {
      if (!(symbol in payload.bars)) continue;
      const policy = { ...(payload.policies[symbol] ?? {}), listedSince: resolution.effectiveListedSince };
      const filtered = filterBarsForListingIdentity(symbol, payload.bars[symbol], policy);
      payload.bars[symbol] = filtered.candles;
      payload.policies[symbol] = policy;
      discarded[symbol] += filtered.discardedPreListingBars;
      touched = true;
    }
    if (touched) {
      staged.set(relativePath, gzipSync(Buffer.from(stableJson(payload)), { level: 9 }));
      stagedBarCounts.set(relativePath, Object.values(payload.bars).reduce((sum, bars) => sum + bars.length, 0));
    }
  }

  const now = new Date().toISOString();
  const files = metadata.files.map((file) => {
    const bytes = staged.get(file.path);
    return bytes
      ? { path: file.path, bytes: bytes.length, bars: stagedBarCounts.get(file.path)!, sha256: sha256(bytes) }
      : file;
  });
  const symbolPolicies = { ...(metadata.symbolPolicies ?? {}) };
  const listingDateDerivations = { ...(metadata.listingDateDerivations ?? {}) };
  for (const resolution of acquired.resolutions) {
    symbolPolicies[resolution.symbol] = { ...(symbolPolicies[resolution.symbol] ?? {}), listedSince: resolution.effectiveListedSince };
    listingDateDerivations[resolution.symbol] = resolution;
  }
  const supplements = (metadata.supplements ?? []).map((supplement) => {
    if (!supplement.symbols?.some((symbol) => bySymbol.has(symbol))) return supplement;
    const nextDiscarded = { ...(supplement.discardedPreListingBars ?? {}) };
    for (const symbol of requested) nextDiscarded[symbol] = (nextDiscarded[symbol] ?? 0) + discarded[symbol];
    return { ...supplement, discardedPreListingBars: nextDiscarded };
  });
  const nextMetadata: ExtendedArchiveMetadata = {
    ...metadata,
    createdAt: now,
    files,
    symbolPolicies,
    listingDateDerivations,
    supplements,
  };
  assertArchiveMatchesLive(nextMetadata);

  for (const [relativePath, bytes] of staged) writeFileSync(resolve(archiveRoot, relativePath), bytes);
  const metadataJson = stableJson(nextMetadata);
  writeFileSync(metadataPath, metadataJson);
  writeFileSync(resolve(archiveRoot, "metadata.sha256"), `${sha256(metadataJson)}  metadata.json\n`);
  mkdirSync(dirname(reportPath), { recursive: true });
  const report = {
    generatedAt: now,
    archive: archiveRoot,
    feed: metadata.feed,
    adjustment: metadata.adjustment,
    fullHistoryStart: "2000-01-01T00:00:00.000Z",
    pagesFetched: acquired.pagesFetched,
    discardedPreListingBars: discarded,
    resolutions: acquired.resolutions,
    metadataSha256: sha256(metadataJson),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
