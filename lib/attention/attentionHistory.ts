import type { AttentionDataQualityState } from "./dataQuality";
import type { AttentionFeedMode } from "./attentionScore";
import type { BaselineMode } from "@/lib/replay/baselineModes";
import type { AttentionSubWindow } from "@/lib/replay/attentionThresholdTypes";

export const DEFAULT_ATTENTION_HISTORY_MINUTES = 120;

export interface AttentionHistoryObservation {
  symbol: string;
  at: number;
  score: number;
  core: number;
  feedMode: AttentionFeedMode;
  subWindow: AttentionSubWindow;
  calibrationId: string;
  participationBaselineMode: BaselineMode;
  participationInput: number | null;
  participationInputKind: "z" | "surprise_bits";
  displacementZ: number | null;
  idiosyncrasyZ: number | null;
  price: number;
  atr: number;
  vwap: number | null;
  ema9: number | null;
  consecutiveExpansionBars: number;
  pullbackObserved: boolean;
  priceLostVwap: boolean;
  dataQualityState: AttentionDataQualityState;
  provisional: boolean;
}

export interface AttentionHistoryPoint extends AttentionHistoryObservation {
  /** Display context only. No A3 decision function consumes rank. */
  rank: number;
  percentile: number;
  /** Participation surprise bits are excluded because they are not z. */
  rollingZComposite: number | null;
}

export interface AttentionHistoryState {
  historyMinutes: number;
  bySymbol: Record<string, AttentionHistoryPoint[]>;
}

export interface AttentionHistoryUpdate {
  state: AttentionHistoryState;
  frame: AttentionHistoryPoint[];
}

function finiteOrNull(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

function assertObservation(row: AttentionHistoryObservation): void {
  if (!row.symbol || row.symbol !== row.symbol.toUpperCase()) throw new Error("Attention history requires normalized symbols.");
  if (![row.at, row.score, row.core, row.price, row.atr, row.consecutiveExpansionBars].every(Number.isFinite)) {
    throw new Error(`Attention history contains a non-finite value for ${row.symbol}.`);
  }
  if (row.score < 0 || row.score > 100 || row.core < 0 || row.core > 1 || row.price <= 0 || row.atr <= 0) {
    throw new Error(`Attention history contains an out-of-range value for ${row.symbol}.`);
  }
  if (![row.participationInput, row.displacementZ, row.idiosyncrasyZ, row.vwap, row.ema9].every(finiteOrNull)) {
    throw new Error(`Attention history contains an invalid optional value for ${row.symbol}.`);
  }
}

function zComposite(row: AttentionHistoryObservation): number | null {
  const values = [
    row.participationInputKind === "z" ? row.participationInput : null,
    row.displacementZ,
    row.idiosyncrasyZ,
  ].filter((value): value is number => value !== null);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function updateAttentionHistory(
  previous: AttentionHistoryState | null,
  observations: readonly AttentionHistoryObservation[],
  historyMinutes = DEFAULT_ATTENTION_HISTORY_MINUTES
): AttentionHistoryUpdate {
  if (!Number.isInteger(historyMinutes) || historyMinutes < 5) throw new Error("Attention history must retain at least five minutes.");
  if (observations.length === 0) throw new Error("Attention history requires a non-empty minute frame.");
  const at = observations[0].at;
  const symbols = new Set<string>();
  for (const row of observations) {
    assertObservation(row);
    if (row.at !== at) throw new Error("Every attention history frame must share one timestamp.");
    if (symbols.has(row.symbol)) throw new Error(`Duplicate attention observation for ${row.symbol}.`);
    symbols.add(row.symbol);
    const last = previous?.bySymbol[row.symbol]?.at(-1);
    if (last && row.at <= last.at) throw new Error(`Attention history for ${row.symbol} must be strictly chronological.`);
  }

  const ranked = [...observations].sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  const rankBySymbol = new Map(ranked.map((row, index) => [row.symbol, index + 1]));
  const denominator = Math.max(1, ranked.length - 1);
  const frame = observations.map((row) => {
    const rank = rankBySymbol.get(row.symbol)!;
    return {
      ...row,
      rank,
      percentile: ranked.length === 1 ? 1 : (ranked.length - rank) / denominator,
      rollingZComposite: zComposite(row),
    };
  });
  const cutoff = at - historyMinutes * 60_000;
  const bySymbol: Record<string, AttentionHistoryPoint[]> = {};
  const allSymbols = new Set([...Object.keys(previous?.bySymbol ?? {}), ...frame.map((row) => row.symbol)]);
  for (const symbol of allSymbols) {
    const next = [...(previous?.bySymbol[symbol] ?? []), ...frame.filter((row) => row.symbol === symbol)]
      .filter((row) => row.at >= cutoff);
    if (next.length > 0) bySymbol[symbol] = next;
  }
  return { state: { historyMinutes, bySymbol }, frame };
}
