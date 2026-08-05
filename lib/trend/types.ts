/**
 * TREND SCANNER — shared types.
 *
 * A persistent setup LIFECYCLE, not a label recomputed from scratch each
 * scan. Current measurements live in `TrendFacts` and change every bar;
 * lifecycle history lives in `TrendLifecycle` and is append-only. A later
 * red candle weakens the facts; it does not erase that Trend Watch
 * happened.
 *
 * Nothing here is a probability, a score, or a prediction. Every field is
 * either a measurement from completed candles or an explicit null meaning
 * "not measurable", never zero or false standing in for unknown.
 */

export type TrendDirection = "bullish" | "bearish";

export type TrendStage =
  | "idle"
  | "basing"
  | "trend_watch"
  | "trend_confirmed"
  | "level_break"
  | "extended"
  | "failed";

export type TrendOriginMode = "held_base" | "momentum_expansion";

/** Forward order for stage progression. `failed` is terminal, off-ramp. */
export const TREND_STAGE_ORDER: Record<TrendStage, number> = {
  idle: 0,
  basing: 1,
  trend_watch: 2,
  trend_confirmed: 3,
  level_break: 4,
  extended: 5,
  failed: -1,
};

export function isLiveStage(stage: TrendStage): boolean {
  return TREND_STAGE_ORDER[stage] >= TREND_STAGE_ORDER.basing;
}

export function isActionableStage(stage: TrendStage): boolean {
  return TREND_STAGE_ORDER[stage] >= TREND_STAGE_ORDER.trend_watch;
}

/**
 * Every timestamp kept separate, because they answer different questions
 * and conflating them is how a Saturday scan of Friday's close ends up
 * looking like a live event.
 */
export interface TrendTimestamps {
  /** Newest COMPLETED 1m bar used, ISO. Null when 1m was unavailable. */
  oneMinuteBarAt: string | null;
  /** Newest COMPLETED 5m bar used, ISO. Null when 5m was unavailable. */
  fiveMinuteBarAt: string | null;
  /** Newest completed daily bar used for higher-timeframe context. */
  dailyBarAt: string | null;
  /** When the detector ran. Never a market timestamp. */
  evaluatedAt: string;
}

/**
 * The locked origin. Once locked it NEVER trails — the whole point is a
 * fixed reference to measure the move from. Only failure/expiry releases
 * it, after which a genuinely new origin may lock.
 */
export interface TrendOrigin {
  mode: TrendOriginMode;
  price: number;
  establishedAt: string;
  /** Completed close beyond this fails the setup. */
  invalidationPrice: number;
  /**
   * The swing extreme price retraced FROM before this base formed — the
   * level the last retracement started at, and the first key level a
   * continuation has to take out. Optional: only Path A knows it, and it
   * stays null rather than being guessed.
   */
  pullbackFrom?: number | null;
}

/** A directional boolean pair: is it true, and could it be measured. */
export type Measured<T> = T | null;

/** Above/below plus slope for a moving average. Null = not computable. */
export interface MovingAverageFact {
  value: Measured<number>;
  /** close > ma. Deliberately independent of any historical cross. */
  above: Measured<boolean>;
  /** ma(now) > ma(3 completed bars ago). Null when history is short. */
  rising: Measured<boolean>;
}

export interface VwapFact {
  value: Measured<number>;
  above: Measured<boolean>;
  /**
   * Most recent CAUSAL reclaim time (ISO): the bar that closed across
   * VWAP from the wrong side. Null when no reclaim is observable.
   */
  reclaimedAt: string | null;
}

/** Relative volume against a SAME-FEED, same-time-of-day baseline. */
export interface RelativeVolumeFact {
  /** Multiple of the time-of-day baseline. Null when not measurable. */
  multiple: Measured<number>;
  /** Same, for dollar volume. */
  dollarMultiple: Measured<number>;
  /** Why it could not be measured, for honest display. */
  unavailableReason: string | null;
  /** Feed the numerator AND baseline both came from. */
  feed: string | null;
  /**
   * True when the feed covers only part of the market (e.g. IEX), so the
   * number must never be described as total-market volume.
   */
  partialMarketCoverage: boolean;
}

/** Close-to-close transitions across the last N+1 completed candles. */
export interface CloseTransitionFact {
  /** How many transitions were examined. */
  transitions: number;
  /** Transitions in the setup's direction. */
  favourable: number;
  /** Null when there were not enough completed candles. */
  measurable: boolean;
}

export interface KeyLevel {
  name: string;
  price: number;
  /** ISO time from which this level was knowable. Null = session start. */
  availableFrom: string | null;
}

export interface TrendFacts {
  price: Measured<number>;
  oneMinuteEma9: MovingAverageFact;
  fiveMinuteEma9: MovingAverageFact;
  fiveMinuteSma20: MovingAverageFact;
  /** Higher-timeframe context ONLY. Never confused with the 5m 20 SMA. */
  dailySma20: MovingAverageFact;
  vwap: VwapFact;
  /** ATR(14) from completed 5m candles. */
  atr5m: Measured<number>;
  levels: KeyLevel[];
  closeTransitions: CloseTransitionFact;
  /** Reported separately from transitions — they are different facts. */
  greenCandles: Measured<number>;
  redCandles: Measured<number>;
  relativeVolume: RelativeVolumeFact;
  /** Percent performance vs QQQ. Null when bar timestamps do not align. */
  relativeToBenchmark: Measured<number>;
  /** Percent vs the configured sector benchmark. */
  relativeToSector: Measured<number>;
  /** Distance from the LOCKED origin. Null until an origin exists. */
  fromOriginDollars: Measured<number>;
  fromOriginPct: Measured<number>;
  fromOriginAtr: Measured<number>;
  /** Nearest relevant key level ahead of price, and how far. */
  nearestLevel: KeyLevel | null;
  distanceToNearestLevelPct: Measured<number>;
  /** ATR distance from the 5m 9 EMA — the extension measure. */
  atrFromFiveMinuteEma: Measured<number>;
  /**
   * Confirmed pivots on the ADVERSE side — swing LOWS for a long.
   *
   * These are the structure the trailing stop walks up. Separate from
   * `levels`, which are entry/continuation targets ahead of price;
   * these sit behind it and are never trade targets.
   */
  adversePivots: KeyLevel[];
}

/** One recorded lifecycle transition. Append-only. */
export interface TrendTransition {
  stage: TrendStage;
  /** Market time of the completed bar that caused it. */
  marketDataAt: string;
  /** Plain-language reason, no jargon, no promise. */
  reason: string;
}

export interface TrendLifecycle {
  /** Stable for the life of one setup. Null until an origin locks. */
  setupKey: string | null;
  stage: TrendStage;
  origin: TrendOrigin | null;
  /** Append-only history. A later red candle never removes an entry. */
  transitions: TrendTransition[];
  /** Percent milestones already fired for this setup key. */
  firedMilestones: number[];
  /**
   * Key levels this setup has already cleared with a TAP 2 break.
   *
   * TAP 2 is a RUNNING confirmation: after it clears one level it
   * re-arms to the next unbroken level ahead, so a move that walks up
   * through several levels reports each one. This ledger is what stops
   * the same level re-firing every bar while still allowing the next.
   */
  clearedLevels: string[];
  /**
   * Market time of the most recent failure, or null.
   *
   * A failed setup RELEASES its origin, and the next origin must have
   * been established strictly after this time. Without it the dead
   * setup's invalidation keeps re-firing against a stale origin and the
   * lifecycle oscillates trend_watch -> failed -> trend_watch forever —
   * observed 14 times in one real GOOGL session.
   */
  failedAt: string | null;
  /**
   * TRAILING STRUCTURE STOP — the most recent confirmed higher low.
   *
   * Starts at the origin base and trails UP only, as each new higher low
   * confirms. A completed close below it is the ONLY structural way a
   * live setup dies. It replaced a two-sided moving-average test that
   * killed GOOGL 2026-08-04 at 11:30 while the trade was +2.50% from
   * origin and had merely paused — that rule never looked at the origin,
   * so a normal pullback scored the same as a setup that never worked.
   */
  structureStop: number | null;
  /** The confirmed higher low that armed the last continuation. */
  lastContinuationLow: number | null;
  /** Continuation confirms fired for this setup, for the spam cap. */
  continuationCount: number;
  /**
   * True while price has pulled back but the structure stop still holds.
   * A HOLDING state, not a failure and not `basing` — the setup keeps
   * its stage and waits for continuation.
   */
  holding: boolean;
  /**
   * Market time of the last CONTINUATION alert — a blue-sky new-high or a
   * pullback reclaim.
   *
   * The blue-sky ladder is structurally guaranteed to re-fire: its
   * reference is the best extreme so far, so every marginally higher
   * close beats it. Gating the next one on a confirmed higher low formed
   * AFTER this time is what turns "a ping per new high" back into "an
   * alert per genuine leg".
   */
  lastContinuationAt: string | null;
  /** Origins locked this session, for the per-direction leg cap. */
  legCount: number;
}

/** Why a stage could not advance — shown to the user, never hidden. */
export interface TrendBlocker {
  requirement: string;
  detail: string;
}

export interface TrendResult {
  symbol: string;
  direction: TrendDirection;
  tradingDate: string;
  lifecycle: TrendLifecycle;
  facts: TrendFacts;
  timestamps: TrendTimestamps;
  /** The single most useful sentence explaining why this is on screen. */
  primaryReason: string;
  /** What would confirm the next stage. */
  nextConfirmation: string | null;
  /** The exact price that ends this setup. Null when no origin. */
  invalidation: { price: number; description: string } | null;
  /** Unmet requirements for the next stage. Never a veto list. */
  blockers: TrendBlocker[];
  /** Facts that could not be measured at all. */
  unavailable: string[];
  /** Freshness/session gating outcome for THIS evaluation. */
  gate: TrendGate;
}

export interface TrendGate {
  /** True when this evaluation may produce alerts. */
  alertable: boolean;
  /** Every reason it may not, for display. */
  reasons: string[];
  session: "pre-market" | "regular" | "after-hours" | "closed";
  oneMinuteAgeSeconds: Measured<number>;
  fiveMinuteAgeSeconds: Measured<number>;
  /** Feed label, e.g. "IEX live — partial-market coverage". */
  feedLabel: string;
}
