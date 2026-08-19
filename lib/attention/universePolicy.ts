export type UniverseBenchmark = "QQQ" | "SPY" | "IWM";
export type OptionsTier = 1 | 2 | 3;

export interface UniverseSymbol {
  symbol: string;
  benchmark: UniverseBenchmark;
  sectorEtf: string | null;
  cluster: string;
  optionsTier: OptionsTier;
  enabled: boolean;
  referenceOnly: boolean;
  listedSince?: string;
}

export function validateUniverse(universe: readonly UniverseSymbol[]): void {
  const bySymbol = new Map<string, UniverseSymbol>();
  for (const entry of universe) {
    if (entry.symbol !== entry.symbol.trim().toUpperCase() || !/^[A-Z][A-Z0-9.\-]*$/.test(entry.symbol)) throw new Error(`Invalid normalized universe symbol: ${entry.symbol}`);
    if (bySymbol.has(entry.symbol)) throw new Error(`Duplicate universe symbol: ${entry.symbol}`);
    if (!entry.cluster.trim()) throw new Error(`Universe cluster is required for ${entry.symbol}.`);
    if (entry.referenceOnly && entry.enabled) throw new Error(`Reference-only symbol ${entry.symbol} must have enabled:false.`);
    if (entry.listedSince && !/^\d{4}-\d{2}-\d{2}$/.test(entry.listedSince)) throw new Error(`Invalid listedSince for ${entry.symbol}.`);
    bySymbol.set(entry.symbol, entry);
  }
  for (const entry of universe) {
    if (entry.sectorEtf !== null && !bySymbol.has(entry.sectorEtf)) throw new Error(`${entry.symbol} sectorEtf ${entry.sectorEtf} is not fetched by the configured universe.`);
    if (!bySymbol.has(entry.benchmark)) throw new Error(`${entry.symbol} benchmark ${entry.benchmark} is not fetched by the configured universe.`);
  }
}

export function fetchedUniverse(universe: readonly UniverseSymbol[]): UniverseSymbol[] {
  validateUniverse(universe);
  return universe.filter((entry) => entry.enabled || entry.referenceOnly);
}

export function rankableUniverse(universe: readonly UniverseSymbol[]): UniverseSymbol[] {
  validateUniverse(universe);
  return universe.filter((entry) => entry.enabled && !entry.referenceOnly);
}

export function resolveSectorEtf(symbol: string, universe: readonly UniverseSymbol[]): UniverseSymbol | null {
  validateUniverse(universe);
  const bySymbol = new Map(universe.map((entry) => [entry.symbol, entry]));
  const owner = bySymbol.get(symbol);
  if (!owner) throw new Error(`Unknown universe symbol: ${symbol}`);
  return owner.sectorEtf === null ? null : bySymbol.get(owner.sectorEtf) ?? null;
}

export function filterRankedOutputs<T extends { symbol: string }>(rows: readonly T[], universe: readonly UniverseSymbol[]): T[] {
  const rankable = new Set(rankableUniverse(universe).map((entry) => entry.symbol));
  return rows.filter((row) => rankable.has(row.symbol));
}

export interface ClusterDisplayInput {
  symbol: string;
}

export interface ClusterOverflow {
  cluster: string;
  hiddenCount: number;
  hiddenSymbols: string[];
  label: string;
}

export interface ClusterDisplayResult<T> {
  /** Untouched ranked/state/event/logging rows. Display compaction never consumes this collection. */
  engineRows: readonly T[];
  visibleRows: T[];
  overflow: ClusterOverflow[];
}

/** Display-only cluster compaction. Retired WAKING UP overrides are intentionally absent. */
export function buildClusterDisplay<T extends ClusterDisplayInput>(
  rows: readonly T[],
  universe: readonly UniverseSymbol[],
  maximumPerCluster = 3
): ClusterDisplayResult<T> {
  if (!Number.isInteger(maximumPerCluster) || maximumPerCluster < 1) throw new Error("maximumPerCluster must be a positive integer.");
  const rankableBySymbol = new Map(rankableUniverse(universe).map((entry) => [entry.symbol, entry]));
  const eligible = rows.filter((row) => rankableBySymbol.has(row.symbol));
  const visible = new Set<string>();
  const initialCounts = new Map<string, number>();
  for (const row of eligible) {
    const cluster = rankableBySymbol.get(row.symbol)!.cluster;
    const used = initialCounts.get(cluster) ?? 0;
    if (used >= maximumPerCluster) continue;
    initialCounts.set(cluster, used + 1);
    visible.add(row.symbol);
  }

  const hiddenByCluster = new Map<string, string[]>();
  for (const row of eligible) {
    if (visible.has(row.symbol)) continue;
    const cluster = rankableBySymbol.get(row.symbol)!.cluster;
    const hidden = hiddenByCluster.get(cluster) ?? [];
    hidden.push(row.symbol);
    hiddenByCluster.set(cluster, hidden);
  }
  const overflow = [...hiddenByCluster.entries()].map(([cluster, hiddenSymbols]) => ({
    cluster,
    hiddenCount: hiddenSymbols.length,
    hiddenSymbols,
    label: `+${hiddenSymbols.length} more in ${cluster}`,
  }));
  return { engineRows: rows, visibleRows: eligible.filter((row) => visible.has(row.symbol)), overflow };
}

/** Backward-compatible row-only projection for callers that do not need overflow metadata. */
export function compactRankedByCluster<T extends { symbol: string }>(
  rows: readonly T[],
  universe: readonly UniverseSymbol[],
  maximumPerCluster: number
): T[] {
  return buildClusterDisplay(rows, universe, maximumPerCluster).visibleRows;
}

export function assertAuthoredUniverseShape(universe: readonly UniverseSymbol[], tradeable = 61, referenceOnly = 7): void {
  validateUniverse(universe);
  const tradeableCount = rankableUniverse(universe).length;
  const referenceCount = universe.filter((entry) => entry.referenceOnly).length;
  const fetchedCount = fetchedUniverse(universe).length;
  if (tradeableCount !== tradeable || referenceCount !== referenceOnly || fetchedCount !== tradeable + referenceOnly) {
    throw new Error(`Configured universe must contain ${tradeable} tradeable + ${referenceOnly} reference-only symbols; got ${tradeableCount} + ${referenceCount} (${fetchedCount} fetched).`);
  }
}
