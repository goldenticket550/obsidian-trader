import type { ExpansionStage } from "@/lib/indicators/premarketExpansion";

/**
 * Expansion Monitor Phase 1, section 1 — deterministic prioritization
 * WITHOUT a score.
 *
 * There is no Expansion Rank here and no replacement for it. Ordering is
 * lexicographic over observable state: stage first, then a fixed sequence
 * of tie-breakers. Every input is something the data directly shows, and
 * the comparison is total and reproducible — two runs over the same
 * inputs always produce the same order.
 *
 * This is a documented PRESENTATION ORDER. It is not confidence, not
 * probability, and not expected return, and the reason string exists so a
 * reader can see exactly why something sits where it does rather than
 * trusting an opaque number.
 *
 * It does not alter the existing setup score, and the existing Ranked
 * Opportunities ordering is preserved — this is an explicit, separate
 * "Sort: Expansion Stage" option.
 */

export const EXPANSION_STAGE_PRIORITY: Record<ExpansionStage, number> = {
  invalidated: 0,
  inactive: 1,
  context_developing: 2,
  premarket_candidate: 3,
  opening_drive: 4,
  level_break: 5,
  breakout_accepted: 6,
  expansion_active: 7,
  // Deliberately equal to context_developing: a stalled expansion has
  // stopped doing the thing that made it interesting, so it belongs
  // alongside "something might be forming", not above a live candidate.
  stalled: 2,
};

export const EXPANSION_STAGE_LABELS: Record<ExpansionStage, string> = {
  invalidated: "Invalidated",
  inactive: "Inactive",
  context_developing: "Context developing",
  premarket_candidate: "Premarket candidate",
  opening_drive: "Opening drive",
  level_break: "Level break",
  breakout_accepted: "Breakout accepted",
  expansion_active: "Expansion active",
  stalled: "Stalled",
};

export interface ExpansionPriorityItem {
  symbol: string;
  stage: ExpansionStage;
  /**
   * Absolute move expressed in ATR multiples. ATR-normalized so a $2 move
   * on a $20 stock and a $2 move on an $850 one are not treated as equal.
   */
  atrNormalizedMove: number | null;
  /** Time-adjusted dollar volume against this symbol's own baseline. */
  relativeDollarVolume: number | null;
  /** Absolute performance versus the configured benchmark/sector ETF. */
  sectorRelativePerformance: number | null;
  /** Epoch seconds of the most recent CONFIRMED state transition. */
  lastConfirmedTransitionAt: number | null;
}

/**
 * Nulls sort last within their tie-breaker rather than as zero: a symbol
 * whose ATR move could not be measured has not been shown to have a small
 * move, and ordering it as though it had would be the same category of
 * error as scoring missing data as a failure.
 */
function compareDescendingNullsLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/**
 * The full comparator, in the specified order:
 *   1. stage priority (higher first)
 *   2. larger absolute ATR-normalized move
 *   3. higher time-adjusted relative dollar volume
 *   4. [sector-relative performance — SKIPPED, Phase 2; falls through]
 *   5. more recent confirmed state transition
 *   6. ticker alphabetically
 *
 * Step 4 is intentionally absent rather than stubbed with a placeholder
 * value: sector ETFs are Phase 2, and a neutral stand-in would silently
 * become a real tie-breaker the moment anyone supplied it.
 */
export function compareExpansionPriority(
  a: ExpansionPriorityItem,
  b: ExpansionPriorityItem
): number {
  const stageDelta = EXPANSION_STAGE_PRIORITY[b.stage] - EXPANSION_STAGE_PRIORITY[a.stage];
  if (stageDelta !== 0) return stageDelta;

  const atrDelta = compareDescendingNullsLast(
    a.atrNormalizedMove === null ? null : Math.abs(a.atrNormalizedMove),
    b.atrNormalizedMove === null ? null : Math.abs(b.atrNormalizedMove)
  );
  if (atrDelta !== 0) return atrDelta;

  const volumeDelta = compareDescendingNullsLast(a.relativeDollarVolume, b.relativeDollarVolume);
  if (volumeDelta !== 0) return volumeDelta;

  const sectorDelta = compareDescendingNullsLast(
    a.sectorRelativePerformance === null ? null : Math.abs(a.sectorRelativePerformance),
    b.sectorRelativePerformance === null ? null : Math.abs(b.sectorRelativePerformance)
  );
  if (sectorDelta !== 0) return sectorDelta;

  const transitionDelta = compareDescendingNullsLast(
    a.lastConfirmedTransitionAt,
    b.lastConfirmedTransitionAt
  );
  if (transitionDelta !== 0) return transitionDelta;

  return a.symbol.localeCompare(b.symbol);
}

/** Stable, non-mutating sort by the comparator above. */
export function sortByExpansionStage<T extends ExpansionPriorityItem>(items: T[]): T[] {
  return [...items].sort(compareExpansionPriority);
}

/**
 * Why this symbol sits where it does, e.g.
 * "GOOGL moved to the top because: Expansion active · 1.4x ATR move ·
 * 3.2x dollar-volume pace".
 *
 * Only measured values appear. A tie-breaker with no data is omitted
 * rather than rendered as zero.
 */
export function describePriorityReason(item: ExpansionPriorityItem, position: number): string {
  const parts: string[] = [EXPANSION_STAGE_LABELS[item.stage]];

  if (item.atrNormalizedMove !== null) {
    parts.push(`${Math.abs(item.atrNormalizedMove).toFixed(1)}x ATR move`);
  }
  if (item.relativeDollarVolume !== null) {
    parts.push(`${item.relativeDollarVolume.toFixed(1)}x dollar-volume pace`);
  }
  if (item.sectorRelativePerformance !== null) {
    parts.push(`${Math.abs(item.sectorRelativePerformance).toFixed(1)} pp sector-relative`);
  }

  const placement = position === 0 ? "moved to the top" : `is ranked #${position + 1}`;
  return `${item.symbol} ${placement} because: ${parts.join(" · ")}`;
}

/** The sort-option label the UI shows, rather than silently reordering the default list. */
export const EXPANSION_SORT_LABEL = "Sort: Expansion Stage";
