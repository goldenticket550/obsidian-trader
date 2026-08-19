import type { Candle } from "@/types/candle";
import { LIVE_BAR_ADJUSTMENT, type ArchiveMetadata } from "./archive";

export interface ArchiveSymbolPolicy {
  listedSince?: string;
  expectedAssetName?: string;
}

export interface AlpacaAssetIdentity {
  symbol: string;
  name: string;
  status: string;
}

export function assertAssetIdentity(symbol: string, asset: AlpacaAssetIdentity, policy: ArchiveSymbolPolicy): void {
  if (asset.symbol.toUpperCase() !== symbol.toUpperCase()) throw new Error(`Asset identity mismatch: requested ${symbol}, received ${asset.symbol}.`);
  if (policy.expectedAssetName && !asset.name.toLowerCase().includes(policy.expectedAssetName.toLowerCase())) {
    throw new Error(`Asset identity mismatch for ${symbol}: expected name containing "${policy.expectedAssetName}", received "${asset.name}".`);
  }
  if (asset.status !== "active") throw new Error(`Asset ${symbol} is not active (status=${asset.status}).`);
}

export function filterBarsForListingIdentity(
  symbol: string,
  candles: readonly Candle[],
  policy: ArchiveSymbolPolicy
): { candles: Candle[]; discardedPreListingBars: number } {
  if (!policy.listedSince) return { candles: [...candles], discardedPreListingBars: 0 };
  const cutoff = Date.parse(`${policy.listedSince}T00:00:00Z`) / 1000;
  if (!Number.isFinite(cutoff)) throw new Error(`Invalid listedSince for ${symbol}: ${policy.listedSince}`);
  const retained = candles.filter((bar) => bar.time >= cutoff);
  return { candles: retained, discardedPreListingBars: candles.length - retained.length };
}

export function mergeArchiveMetadata(
  existing: ArchiveMetadata,
  symbols: readonly string[],
  files: ArchiveMetadata["files"],
  createdAt: string
): ArchiveMetadata {
  if (existing.feed !== "sip" || existing.adjustment !== LIVE_BAR_ADJUSTMENT) throw new Error("Supplement target must be an explicit SIP split-adjusted archive.");
  const duplicates = symbols.filter((symbol) => existing.symbols.includes(symbol));
  if (duplicates.length > 0) throw new Error(`Archive already contains requested symbols: ${duplicates.join(", ")}`);
  const paths = new Set(existing.files.map((file) => file.path));
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`Archive supplement path collision: ${file.path}`);
    paths.add(file.path);
  }
  return {
    ...existing,
    createdAt,
    symbols: [...existing.symbols, ...symbols].sort(),
    files: [...existing.files, ...files].sort((a, b) => a.path.localeCompare(b.path)),
  };
}
