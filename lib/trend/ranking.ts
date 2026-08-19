import type { TrendResult } from "./types";
import { TREND_STAGE_ORDER } from "./types";

/**
 * DETERMINISTIC ORDERING — no composite score.
 *
 * Each criterion is applied in turn and the first difference decides.
 * Nothing is blended into a single number, because a blended number
 * invites being read as a quality rating, which none of this is.
 *
 * Order, highest priority first:
 *   1. stage priority
 *   2. fresh before stale
 *   3. premarket-level interaction
 *   4. relative volume
 *   5. move from origin in ATR
 *   6. relative strength
 *   7. symbol (final tie-breaker, so ordering is total and stable)
 */
export const TREND_RANKING_RULE =
  "Stage, then freshness, premarket-level interaction, relative volume, " +
  "move from origin in ATR, relative strength, then symbol. No composite score.";

/** Nulls sort AFTER real values — unmeasured never outranks measured. */
function compareNullableDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Is this result interacting with its premarket level? */
function premarketInteraction(result: TrendResult): number {
  if (TREND_STAGE_ORDER[result.lifecycle.stage] >= TREND_STAGE_ORDER.level_break) return 2;
  const near = result.facts.nearestLevel;
  if (near !== null && /premarket/i.test(near.name)) return 1;
  return 0;
}

export function compareTrendResults(a: TrendResult, b: TrendResult): number {
  // 1. Stage priority.
  const byStage = TREND_STAGE_ORDER[b.lifecycle.stage] - TREND_STAGE_ORDER[a.lifecycle.stage];
  if (byStage !== 0) return byStage;

  // 2. Fresh before stale.
  const byFresh = Number(b.gate.alertable) - Number(a.gate.alertable);
  if (byFresh !== 0) return byFresh;

  // 3. Premarket-level interaction.
  const byLevel = premarketInteraction(b) - premarketInteraction(a);
  if (byLevel !== 0) return byLevel;

  // 4. Relative volume.
  const byVolume = compareNullableDesc(
    a.facts.relativeVolume.multiple,
    b.facts.relativeVolume.multiple
  );
  if (byVolume !== 0) return byVolume;

  // 5. Move from origin, in ATR.
  const byMove = compareNullableDesc(a.facts.fromOriginAtr, b.facts.fromOriginAtr);
  if (byMove !== 0) return byMove;

  // 6. Relative strength.
  const byStrength = compareNullableDesc(
    a.facts.relativeToBenchmark,
    b.facts.relativeToBenchmark
  );
  if (byStrength !== 0) return byStrength;

  // 7. Symbol, so the order is total and stable across scans.
  return a.symbol.localeCompare(b.symbol);
}

export function rankTrendResults(results: readonly TrendResult[]): TrendResult[] {
  return [...results].sort(compareTrendResults);
}

/** Top longs and shorts, each already ranked. */
export function splitByDirection(results: readonly TrendResult[]): {
  longs: TrendResult[];
  shorts: TrendResult[];
} {
  return {
    longs: rankTrendResults(results.filter((r) => r.direction === "bullish")),
    shorts: rankTrendResults(results.filter((r) => r.direction === "bearish")),
  };
}
