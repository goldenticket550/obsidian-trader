import type { AttentionDataQualityState } from "./dataQuality";
import type { AttentionEpisode } from "./attentionEpisodes";
import type { AttentionFreshnessResult } from "./attentionFreshness";
import type { AttentionHistoryPoint } from "./attentionHistory";
import type { AttentionState, PendingAttentionTransition } from "./attentionState";
import type { AttentionVelocity } from "./attentionVelocity";
import { buildClusterDisplay, type ClusterDisplayResult, type UniverseSymbol } from "./universePolicy";

export interface AttentionListConfig {
  clusterDisplayCap: number;
  globalDisplayCap: number;
}

export const DEFAULT_ATTENTION_LIST_CONFIG: AttentionListConfig = {
  clusterDisplayCap: 3,
  globalDisplayCap: 12,
};

export interface AttentionListRow {
  symbol: string;
  point: AttentionHistoryPoint;
  state: AttentionState;
  statePersistenceMinutes: number;
  pendingTransition: PendingAttentionTransition;
  pendingTransitionMinutes: number;
  stateExplanation: string;
  episode: AttentionEpisode | null;
  freshness: AttentionFreshnessResult | null;
  /** Computed and displayed context. It is not a list trigger. */
  velocity: AttentionVelocity;
  dataQualityState: AttentionDataQualityState;
}

export interface GlobalDisplayOverflow {
  hiddenCount: number;
  hiddenSymbols: string[];
  label: string;
}
export type BoundedClusterDisplayResult<T> = ClusterDisplayResult<T> & {
  globalOverflow: GlobalDisplayOverflow | null;
};

export interface AttentionLists {
  inPlay: AttentionListRow[];
  inPlayDisplay: BoundedClusterDisplayResult<AttentionListRow>;
}

export function capAttentionDisplay<T extends { symbol: string }>(
  display: ClusterDisplayResult<T>,
  maximumVisibleRows: number,
): BoundedClusterDisplayResult<T> {
  if (!Number.isInteger(maximumVisibleRows) || maximumVisibleRows < 1)
    throw new Error("Global attention display cap must be a positive integer.");
  if (display.visibleRows.length <= maximumVisibleRows)
    return { ...display, globalOverflow: null };
  const visibleRows = display.visibleRows.slice(0, maximumVisibleRows);
  const selected = new Set(visibleRows.map((row) => row.symbol));
  const hiddenSymbols = display.visibleRows.filter((row) => !selected.has(row.symbol)).map((row) => row.symbol);
  return {
    ...display,
    visibleRows,
    globalOverflow: {
      hiddenCount: hiddenSymbols.length,
      hiddenSymbols,
      label: `+${hiddenSymbols.length} more across other clusters`,
    },
  };
}

/** I5 now protects only the surviving score-ordered IN PLAY list. */
export function assertAttentionListOrdering(lists: Pick<AttentionLists, "inPlay">): void {
  for (let index = 1; index < lists.inPlay.length; index += 1) {
    if (lists.inPlay[index - 1].point.score < lists.inPlay[index].point.score) {
      throw new Error(`I5 LIST ORDERING violated: IN PLAY is not descending by attention score at ${lists.inPlay[index].symbol}.`);
    }
  }
}

export function buildAttentionLists(
  rows: readonly AttentionListRow[],
  universe: readonly UniverseSymbol[],
  config: AttentionListConfig = DEFAULT_ATTENTION_LIST_CONFIG,
): AttentionLists {
  if (!Number.isInteger(config.clusterDisplayCap) || config.clusterDisplayCap < 1 ||
      !Number.isInteger(config.globalDisplayCap) || config.globalDisplayCap < 1) {
    throw new Error("Attention-list configuration is invalid.");
  }
  const inPlay = [...rows]
    .filter((row) => row.state === "IN_PLAY")
    .sort((a, b) => b.point.score - a.point.score || a.symbol.localeCompare(b.symbol));
  const lists: AttentionLists = {
    inPlay,
    inPlayDisplay: capAttentionDisplay(
      buildClusterDisplay(inPlay, universe, config.clusterDisplayCap),
      config.globalDisplayCap,
    ),
  };
  assertAttentionListOrdering(lists);
  return lists;
}