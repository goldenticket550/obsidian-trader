import type { Candle } from "@/types/candle";
import type { StrategyConfig } from "@/lib/strategies/config";

export type MilestoneState =
  | "not_reached"
  | "reached"
  | "holding"
  | "lost"
  | "reclaimed"
  | "rejected";

export interface MilestoneTierResult {
  /** The configured tier, in percent (e.g. 5 = +5%). */
  tierPct: number;
  /** The price at which this tier is met, derived from the anchor. */
  tierPrice: number;
  state: MilestoneState;
  /** Candle time this tier first entered its current state. */
  firstReachedAt: number | null;
  /** Candle time of the most recent state transition. */
  lastTransitionAt: number | null;
}

export interface MomentumLadderResult {
  passed: boolean;
  insufficientData: boolean;
  anchorPrice: number | null;
  currentMovePct: number | null;
  currentMoveDollars: number | null;
  /** Highest tier ever reached at all, in percent; null if none. */
  highestMilestoneReached: number | null;
  /** Rule B3: highest tier currently `holding` or `reclaimed`. */
  highestHoldingTier: number | null;
  tiers: MilestoneTierResult[];
  detail: string;
}

/**
 * Rules B1-B3 — milestone ladder measured from an IMMUTABLE anchor.
 *
 * The anchor is `session_open` (the first regular-session candle's open),
 * frozen for the life of the day. This is the whole point of the rule: a
 * ladder anchored to a moving value like the running session low makes
 * every earlier "held +3%" reading retroactively meaningless once the
 * anchor shifts. Because the anchor is the first candle of the passed-in
 * regular-hours series, it resets naturally each trading day along with
 * every tier's state — there is no carried-over state to unwind.
 *
 * This does NOT replace detectConsecutiveBullish. That detector still
 * measures short-streak momentum and is untouched; this is an additive,
 * separate reading that survives the small pullbacks a strict streak
 * cannot.
 */
export function detectMomentumLadder(
  sessionCandles: Candle[],
  config: StrategyConfig["momentumLadder"]
): MomentumLadderResult {
  const tiersPct = [...config.tiers].sort((a, b) => a - b);

  // Needs the anchor candle plus at least one candle beyond it.
  if (sessionCandles.length < 2) {
    return {
      passed: false,
      insufficientData: true,
      anchorPrice: null,
      currentMovePct: null,
      currentMoveDollars: null,
      highestMilestoneReached: null,
      highestHoldingTier: null,
      tiers: tiersPct.map((tierPct) => ({
        tierPct,
        tierPrice: 0,
        state: "not_reached" as MilestoneState,
        firstReachedAt: null,
        lastTransitionAt: null,
      })),
      detail: "Not enough candles yet to measure a move from the session open",
    };
  }

  const anchorPrice = sessionCandles[0].open;

  if (anchorPrice <= 0) {
    return {
      passed: false,
      insufficientData: true,
      anchorPrice: null,
      currentMovePct: null,
      currentMoveDollars: null,
      highestMilestoneReached: null,
      highestHoldingTier: null,
      tiers: tiersPct.map((tierPct) => ({
        tierPct,
        tierPrice: 0,
        state: "not_reached" as MilestoneState,
        firstReachedAt: null,
        lastTransitionAt: null,
      })),
      detail: "Session open price unavailable; cannot anchor the ladder",
    };
  }

  const currentPrice = sessionCandles[sessionCandles.length - 1].close;
  const currentMoveDollars = currentPrice - anchorPrice;
  const currentMovePct = (currentMoveDollars / anchorPrice) * 100;

  // Candles after the anchor are what actually move the ladder.
  const walked = sessionCandles.slice(1);

  const tiers = tiersPct.map((tierPct) =>
    walkTier(tierPct, anchorPrice * (1 + tierPct / 100), walked)
  );

  const reachedTiers = tiers.filter((t) => t.state !== "not_reached");
  const highestMilestoneReached =
    reachedTiers.length > 0 ? Math.max(...reachedTiers.map((t) => t.tierPct)) : null;

  const holdingTiers = tiers.filter((t) => t.state === "holding" || t.state === "reclaimed");
  const highestHoldingTier =
    holdingTiers.length > 0 ? Math.max(...holdingTiers.map((t) => t.tierPct)) : null;

  return {
    passed: highestHoldingTier !== null,
    insufficientData: false,
    anchorPrice,
    currentMovePct,
    currentMoveDollars,
    highestMilestoneReached,
    highestHoldingTier,
    tiers,
    detail: buildDetail(anchorPrice, currentPrice, highestHoldingTier, tiers),
  };
}

/**
 * Rule B2 — one tier's independent lifecycle:
 *
 *   not_reached -> reached -> holding -> lost -> reclaimed
 *                     |
 *                     v
 *                  rejected
 *
 * `reached` is an intrabar touch (a wick alone counts). `holding`
 * requires a COMPLETED candle's close at or beyond the tier. `rejected`
 * is a tier touched intrabar whose candle closed back below without ever
 * holding. `lost` and `reclaimed` only exist after `holding`.
 *
 * The transition guards below are the rule's explicitly-invalid moves:
 * `lost` cannot precede `holding`, `reclaimed` cannot precede `lost`, and
 * `rejected` cannot follow `holding` (holding means the tier already
 * passed the rejected/not-rejected fork).
 */
function walkTier(tierPct: number, tierPrice: number, candles: Candle[]): MilestoneTierResult {
  let state: MilestoneState = "not_reached";
  let firstReachedAt: number | null = null;
  let lastTransitionAt: number | null = null;
  let hasHeld = false;

  for (const candle of candles) {
    const touched = candle.high >= tierPrice;
    const closedAtOrAbove = candle.close >= tierPrice;

    // `next` is computed, then assigned directly rather than through a
    // closure — a closure assignment defeats TypeScript's control-flow
    // analysis and makes `state` look permanently narrowed to its
    // initializer inside the loop.
    const previous: MilestoneState = state;
    let next: MilestoneState = previous;

    if (closedAtOrAbove) {
      if (firstReachedAt === null) firstReachedAt = candle.time;
      // A close at/above the tier is `holding` — or `reclaimed` if this
      // tier had previously been lost. Guard: reclaimed requires a prior
      // `lost`, which itself requires a prior `holding`.
      next = previous === "lost" ? "reclaimed" : "holding";
      hasHeld = true;
    } else if (hasHeld) {
      // Only a tier that genuinely held can be lost. Guard: never
      // `rejected` after holding — that fork was already passed.
      next = "lost";
    } else if (touched) {
      if (firstReachedAt === null) firstReachedAt = candle.time;
      // Touched intrabar but closed back below, having never held:
      // the `rejected` branch off `reached`.
      next = "rejected";
    }
    // Never touched and never held: stays not_reached.

    if (next !== previous) {
      state = next;
      lastTransitionAt = candle.time;
    }
  }

  return { tierPct, tierPrice, state, firstReachedAt, lastTransitionAt };
}

function buildDetail(
  anchorPrice: number,
  currentPrice: number,
  highestHoldingTier: number | null,
  tiers: MilestoneTierResult[]
): string {
  const anchorText = `session open $${anchorPrice.toFixed(2)} → current $${currentPrice.toFixed(2)}`;

  if (highestHoldingTier === null) {
    return `No milestone currently holding (${anchorText})`;
  }

  const held = tiers.find((t) => t.tierPct === highestHoldingTier)!;
  const heldDollars = held.tierPrice - anchorPrice;
  const head = `Holding +${held.tierPct}% ($${heldDollars.toFixed(2)}) (${anchorText})`;

  const next = tiers.find((t) => t.tierPct > highestHoldingTier);
  if (!next) return head;

  return `${head}. Next milestone: +${next.tierPct}% ($${next.tierPrice.toFixed(2)})`;
}
