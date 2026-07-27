import type { WatchlistSymbol } from "@/types/watchlist";

/**
 * The documented ranking rule, stated plainly so the UI can show it
 * verbatim: symbols are ordered by the HIGHER of their existing 5m and
 * 15m scores, descending, with ticker as a stable tiebreak.
 *
 * This is deliberately NOT a new composite/blended metric. It picks one
 * of two numbers the scorer already produced — nothing is averaged,
 * weighted, or otherwise synthesised, so a rank of 1 always means "this
 * symbol has the single highest timeframe score on the board."
 */
export const RANKING_RULE_DESCRIPTION =
  "Ranked by each symbol's highest timeframe score, then by its lower score, then alphabetically. Not a blended score — the 5m and 15m values stay separate.";

/** Primary key: the better of the two timeframes. */
export function rankingScore(symbol: WatchlistSymbol): number {
  return Math.max(symbol.score5m, symbol.score15m);
}

/** Tie-break key: the weaker timeframe. Between two symbols whose best
 * score is identical, the one that is also strong on its other timeframe
 * is the more interesting setup. Still no averaging — this is a second
 * comparison, not a combined number. */
export function rankingTiebreak(symbol: WatchlistSymbol): number {
  return Math.min(symbol.score5m, symbol.score15m);
}

/** Returns a new array; does not mutate the input. Fully deterministic. */
export function rankOpportunities(symbols: WatchlistSymbol[]): WatchlistSymbol[] {
  return [...symbols].sort((a, b) => {
    const byBest = rankingScore(b) - rankingScore(a);
    if (byBest !== 0) return byBest;
    const byWeaker = rankingTiebreak(b) - rankingTiebreak(a);
    if (byWeaker !== 0) return byWeaker;
    return a.ticker.localeCompare(b.ticker);
  });
}
