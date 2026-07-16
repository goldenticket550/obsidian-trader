import type { JournalEntry } from "@/types/journal";

export interface JournalStatistics {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  breakEvenCount: number;
  winRate: number; // 0-1, of trades with a nonzero P&L
  totalPnl: number;
  averagePnl: number;
  planFollowingRate: number; // 0-1
  mistakeCounts: Record<string, number>;
}

/**
 * Computes basic journal statistics. Pure function, no I/O — takes
 * whatever entries you give it and summarizes them. Per the spec:
 * "Do not add advanced AI analysis until enough journal data exists" —
 * this is the plain-arithmetic layer that comes first; AI-generated
 * pattern analysis is explicitly Phase 7, not this.
 */
export function computeJournalStatistics(entries: JournalEntry[]): JournalStatistics {
  const totalTrades = entries.length;

  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      winCount: 0,
      lossCount: 0,
      breakEvenCount: 0,
      winRate: 0,
      totalPnl: 0,
      averagePnl: 0,
      planFollowingRate: 0,
      mistakeCounts: {},
    };
  }

  let winCount = 0;
  let lossCount = 0;
  let breakEvenCount = 0;
  let totalPnl = 0;
  let followedPlanCount = 0;
  const mistakeCounts: Record<string, number> = {};

  for (const entry of entries) {
    totalPnl += entry.profitLoss;

    if (entry.profitLoss > 0) winCount++;
    else if (entry.profitLoss < 0) lossCount++;
    else breakEvenCount++;

    if (entry.followedPlan) followedPlanCount++;

    if (entry.mistakeCategory) {
      mistakeCounts[entry.mistakeCategory] = (mistakeCounts[entry.mistakeCategory] ?? 0) + 1;
    }
  }

  const decisiveTrades = winCount + lossCount;

  return {
    totalTrades,
    winCount,
    lossCount,
    breakEvenCount,
    winRate: decisiveTrades === 0 ? 0 : winCount / decisiveTrades,
    totalPnl,
    averagePnl: totalPnl / totalTrades,
    planFollowingRate: followedPlanCount / totalTrades,
    mistakeCounts,
  };
}
