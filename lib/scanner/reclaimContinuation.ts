import type { Candle } from "@/types/candle";
import { calculateEma } from "@/lib/indicators/movingAverages";
import { calculateVwap } from "@/lib/indicators/vwap";
import type { FreshnessStatus } from "@/lib/indicators/premarketExpansion";
import {
  assertValidReclaimContinuationConfig,
  type ReclaimContinuationConfig,
} from "@/lib/strategies/reclaimContinuationConfig";

/**
 * Reclaim & Continuation — the pure state machine.
 *
 * THIS IS A CHRONOLOGICAL REPLAY. Completed candles are walked in
 * ascending order and stages are established as they happen. Nothing is
 * computed from the finished series and applied backward: a level the
 * session eventually reached cannot break an earlier candle, a moving
 * average's latest value cannot judge an earlier one, and a pivot cannot
 * exist before its right-hand bar completes.
 *
 * Purity: no provider access, no database, no timers, no alert writes, no
 * module-level mutable state. The input candle array and its candle
 * objects are never mutated. Identical inputs produce identical outputs.
 *
 * Rollout flags (`enabled`, `alertingEnabled`) are deliberately NOT read
 * here. Emission is decided at the boundary.
 *
 * BOTH DIRECTIONS ARE ONE IMPLEMENTATION. Every comparison flows through
 * `DirectionOps`, so bearish is a structural mirror rather than a second
 * copy that can drift or be made easier.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReclaimTimeframe = "five_minute" | "one_minute";
export type ReclaimDirection = "bullish" | "bearish";
export type ResetSeverity = "shallow" | "standard" | "deep";
export type ReclaimStatus = "none" | "forming" | "confirmed";

export type ReclaimStage =
  | "unavailable"
  | "invalidated"
  | "reset"
  | "exhaustion"
  | "reclaim"
  | "level_test"
  | "acceptance"
  | "continuation";

export const RECLAIM_STAGE_ORDER: Record<ReclaimStage, number> = {
  unavailable: -1,
  invalidated: 0,
  reset: 1,
  exhaustion: 2,
  reclaim: 3,
  level_test: 4,
  acceptance: 5,
  continuation: 6,
};

/** Stages a setup can still develop from. Invalidated and unavailable cannot. */
export function isActiveStage(stage: ReclaimStage): boolean {
  return stage !== "unavailable" && stage !== "invalidated";
}

export type ReclaimUnavailableReason =
  | "invalid_atr"
  | "insufficient_candles"
  | "no_qualifying_reset"
  | "freshness_blocked";

/**
 * A tracked level together with the index from which it may legitimately
 * influence a decision. Without this a level the session only established
 * at 11:00 could "break" a 09:45 candle.
 */
export interface AvailableTrackedLevel {
  name: string;
  price: number;
  availableFromIndex: number;
}

export interface LevelCluster {
  sources: string[];
  price: number;
  availableFromIndex: number;
}

/**
 * Structured, directional, time-bound sweep evidence.
 *
 * A bare boolean could not say WHICH direction was swept, WHICH level, or
 * WHEN — so a stale bullish sweep could qualify a fresh bearish reset.
 */
export interface ReclaimSweepEvidence {
  direction: ReclaimDirection;
  sweptLevel: number;
  sweepCandleTime: number;
  reclaimCandleTime: number;
}

export interface ReclaimEvidenceGroup {
  name:
    | "resetDepth"
    | "failedContinuation"
    | "controlReclaim"
    | "participation"
    | "roomToContinue"
    | "dataFreshness";
  state: "pass" | "forming" | "waiting" | "unavailable";
  detail: string;
}

export interface ReclaimMachineInput {
  symbol: string;
  sessionDate: string;
  direction: ReclaimDirection;
  timeframe: ReclaimTimeframe;
  /** Completed candles of the evaluated timeframe, ascending. Never mutated. */
  candles: readonly Candle[];
  /** ATR in dollars, always from completed FIVE-minute candles, for both machines. */
  atr: number;

  /** Prior-day level: available from the first eligible session candle. */
  priorDayLevel: number | null;
  /** Premarket level, and the index from which the premarket range is final. */
  premarketLevel: number | null;
  premarketAvailableFromIndex: number | null;
  /** Opening-range level, available only once its required candles complete. */
  openingRangeLevel: number | null;
  openingRangeAvailableFromIndex: number | null;
  /**
   * Index where the regular session begins. The current-session extreme is
   * derived incrementally from candles STRICTLY BEFORE the candle being
   * evaluated — never the final extreme applied backward.
   */
  regularSessionStartIndex: number | null;

  /** Exact level from the existing structure-shift calculation, or null. */
  structureLevel: number | null;
  /** Directional, time-bound sweep evidence, or null when unavailable. */
  sweepEvidence: ReclaimSweepEvidence | null;

  /**
   * The repository's existing freshness result, resolved OUTSIDE and
   * supplied immutably. Missing is unavailable — never assumed fresh.
   */
  freshness: FreshnessStatus | null;

  volumePace: number | null;
  benchmarkRelativeMove: number | null;
}

export interface ReclaimMachineResult {
  symbol: string;
  sessionDate: string;
  timeframe: ReclaimTimeframe;
  direction: ReclaimDirection;
  stage: ReclaimStage;
  reclaimStatus: ReclaimStatus;
  stageChangedAt: number | null;
  unavailableReason: ReclaimUnavailableReason | null;
  setupKey: string | null;

  resetSeverity: ResetSeverity | null;
  resetDollars: number | null;
  resetPct: number | null;
  resetAtr: number | null;
  resetAnchorPrice: number | null;
  resetAnchorTime: number | null;
  resetExtremePrice: number | null;
  resetExtremeTime: number | null;

  recoveryDollars: number | null;
  recoveryPct: number | null;
  recoveryAtr: number | null;

  ema9: number | null;
  emaReclaimed: boolean;
  vwap: number | null;
  vwapReclaimed: boolean;
  structureLevel: number | null;
  structureReclaimed: boolean;
  /** Epoch second of the FIRST distinct control reclaimed. */
  reclaimFormingAt: number | null;
  /** Epoch second of the SECOND distinct control reclaimed. */
  reclaimConfirmedAt: number | null;

  activeLevelSources: string[];
  activeLevelPrice: number | null;
  nextLevelName: string | null;
  nextLevelPrice: number | null;
  distanceToNextLevelDollars: number | null;
  distanceToNextLevelPct: number | null;
  distanceToNextLevelAtr: number | null;

  acceptedLevelName: string | null;
  acceptedLevelPrice: number | null;
  invalidationName: string | null;
  invalidationPrice: number | null;
  /** Index from which the locked invalidation may judge closes. */
  invalidationActiveFromIndex: number | null;

  volumePace: number | null;
  benchmarkRelativeMove: number | null;
  isExtended: boolean;
  aboveAllTrackedLevels: boolean;
  freshness: FreshnessStatus | null;

  evidence: ReclaimEvidenceGroup[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Direction operations — the single source of the bullish/bearish mirror
// ---------------------------------------------------------------------------

interface DirectionOps {
  anchor(candle: Candle): number;
  extreme(candle: Candle): number;
  beyond(a: number, b: number): boolean;
  atOrBeyond(a: number, b: number): boolean;
  adverse(a: number, b: number): boolean;
  atOrAdverse(a: number, b: number): boolean;
  touchedFrom(candle: Candle, level: number): boolean;
  offset(price: number, distance: number): number;
  gap(a: number, b: number): number;
}

const BULLISH: DirectionOps = {
  anchor: (c) => c.high,
  extreme: (c) => c.low,
  beyond: (a, b) => a > b,
  atOrBeyond: (a, b) => a >= b,
  adverse: (a, b) => a < b,
  atOrAdverse: (a, b) => a <= b,
  touchedFrom: (c, level) => c.low <= level,
  offset: (price, distance) => price + distance,
  gap: (a, b) => a - b,
};

const BEARISH: DirectionOps = {
  anchor: (c) => c.low,
  extreme: (c) => c.high,
  beyond: (a, b) => a < b,
  atOrBeyond: (a, b) => a <= b,
  adverse: (a, b) => a > b,
  atOrAdverse: (a, b) => a >= b,
  touchedFrom: (c, level) => c.high >= level,
  offset: (price, distance) => price - distance,
  gap: (a, b) => b - a,
};

function opsFor(direction: ReclaimDirection): DirectionOps {
  return direction === "bullish" ? BULLISH : BEARISH;
}

export function closeLocation(candle: Candle): number | null {
  const range = candle.high - candle.low;
  if (!(range > 0)) return null;
  return (candle.close - candle.low) / range;
}

export function resetSeverityFor(
  resetAtr: number,
  config: ReclaimContinuationConfig
): ResetSeverity {
  if (resetAtr < config.shallowResetMaxAtr) return "shallow";
  if (resetAtr < config.standardResetMaxAtr) return "standard";
  return "deep";
}

// ---------------------------------------------------------------------------
// Level clustering
// ---------------------------------------------------------------------------

export function clusterLevels(
  levels: readonly AvailableTrackedLevel[],
  atr: number,
  direction: ReclaimDirection,
  config: ReclaimContinuationConfig
): LevelCluster[] {
  const ops = opsFor(direction);
  const tolerance = config.levelClusterAtr * atr;

  // Copy before sorting: the caller's array is never reordered.
  const ordered = [...levels].sort((a, b) => a.price - b.price);
  const clusters: LevelCluster[] = [];

  for (const level of ordered) {
    const open = clusters[clusters.length - 1];
    if (open !== undefined && Math.abs(level.price - open.price) <= tolerance) {
      open.sources.push(level.name);
      // A cluster is usable only once EVERY member is available.
      open.availableFromIndex = Math.max(open.availableFromIndex, level.availableFromIndex);
      if (ops.atOrAdverse(level.price, open.price)) open.price = level.price;
      continue;
    }
    clusters.push({
      sources: [level.name],
      price: level.price,
      availableFromIndex: level.availableFromIndex,
    });
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// The active setup — mutable ONLY inside one replay call
// ---------------------------------------------------------------------------

interface ControlCrossing {
  name: "9 EMA" | "VWAP" | "Structure level";
  index: number;
  /** The level's value AT the crossing candle, locked for invalidation. */
  price: number;
}

interface ActiveSetup {
  anchorIndex: number;
  anchorPrice: number;
  extremeIndex: number;
  extremePrice: number;
  dollars: number;
  pct: number;
  atr: number;

  stage: ReclaimStage;
  stageIndex: number;

  exhaustionIndex: number | null;
  exhaustionViaSweep: boolean;
  /** Distinct controls, in the order they were first reclaimed. */
  crossings: ControlCrossing[];
  levelTestIndex: number | null;
  acceptance: {
    breakIndex: number;
    acceptedIndex: number;
    viaRetest: boolean;
    levelPrice: number;
    levelSources: string[];
  } | null;
  continuationIndex: number | null;
  invalidation: { name: string; price: number; activationIndex: number } | null;
  /** Terminal: the setup can no longer develop and a new one may seed after it. */
  terminal: boolean;
}

/**
 * SETUP LIFECYCLE RULE.
 *
 * `newResetMaxAgeBars` is a SEEDING gate only. It decides whether a reset
 * is recent enough to START a setup; it never expires one that already
 * started. A setup that seeded at bar 4 is still the active setup at bar
 * 40 if it is still progressing — expiring it mid-development is what made
 * continuation unreachable on the default configuration.
 *
 * Identity is immutable once exhaustion is established. Before that, while
 * the flush is still extending, a NEW adverse extreme legitimately deepens
 * the same reset (that is the move continuing, not a new setup). A
 * recovery candle never re-anchors anything.
 *
 * A setup is TERMINAL when it invalidates or reaches continuation. Only
 * then may a genuinely new qualifying reset, occurring afterwards, seed a
 * replacement identity.
 */
function seedFrom(reset: {
  anchorIndex: number;
  anchorPrice: number;
  extremeIndex: number;
  extremePrice: number;
  dollars: number;
  pct: number;
  atr: number;
}): ActiveSetup {
  return {
    ...reset,
    stage: "reset",
    stageIndex: reset.extremeIndex,
    exhaustionIndex: null,
    exhaustionViaSweep: false,
    crossings: [],
    levelTestIndex: null,
    acceptance: null,
    continuationIndex: null,
    invalidation: null,
    terminal: false,
  };
}

/**
 * Finds a reset that may SEED a new setup as of candle `atIndex`, using
 * only candles up to and including it.
 */
function findSeedReset(
  candles: readonly Candle[],
  atIndex: number,
  atr: number,
  ops: DirectionOps,
  config: ReclaimContinuationConfig,
  afterIndex: number
): ActiveSetup | null {
  const windowStart = Math.max(afterIndex, atIndex + 1 - config.resetLookbackBars);
  const freshestStart = Math.max(afterIndex, atIndex + 1 - config.newResetMaxAgeBars);

  let best: ActiveSetup | null = null;

  for (let anchorIndex = windowStart; anchorIndex < atIndex; anchorIndex++) {
    const anchorPrice = ops.anchor(candles[anchorIndex]);
    if (!(anchorPrice > 0)) continue;

    // The extreme is the furthest the move travelled after this anchor,
    // considering only candles that have completed by `atIndex`.
    let extremeIndex = -1;
    let extremePrice = 0;
    for (let j = anchorIndex + 1; j <= atIndex; j++) {
      const value = ops.extreme(candles[j]);
      if (extremeIndex === -1 || ops.adverse(value, extremePrice)) {
        extremeIndex = j;
        extremePrice = value;
      }
    }
    if (extremeIndex === -1) continue;
    // Seeding gate: the reset must be recent AS OF this candle.
    if (extremeIndex < freshestStart) continue;

    const dollars = ops.gap(anchorPrice, extremePrice);
    if (!(dollars > 0)) continue;
    const resetAtr = dollars / atr;
    if (resetAtr < config.minResetAtr) continue;

    const candidate = seedFrom({
      anchorIndex,
      anchorPrice,
      extremeIndex,
      extremePrice,
      dollars,
      pct: (dollars / anchorPrice) * 100,
      atr: resetAtr,
    });

    if (best === null || isBetterReset(candidate, best, ops)) best = candidate;
  }

  return best;
}

function isBetterReset(candidate: ActiveSetup, best: ActiveSetup, ops: DirectionOps): boolean {
  // The furthest the move actually travelled wins; ties on price take the
  // first bar that reached it, so a later retest cannot re-anchor.
  if (candidate.extremePrice !== best.extremePrice) {
    return ops.adverse(candidate.extremePrice, best.extremePrice);
  }
  if (candidate.extremeIndex !== best.extremeIndex) {
    return candidate.extremeIndex < best.extremeIndex;
  }
  if (candidate.atr !== best.atr) return candidate.atr > best.atr;
  return candidate.anchorIndex > best.anchorIndex;
}

// ---------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------

const EMA_PERIOD = 9;

/** Freshness states that may produce a candidate at all. */
function freshnessAllowsEvaluation(freshness: FreshnessStatus | null): boolean {
  return freshness === "real_time" || freshness === "delayed";
}

export function runReclaimMachine(
  input: ReclaimMachineInput,
  config: ReclaimContinuationConfig
): ReclaimMachineResult {
  assertValidReclaimContinuationConfig(config);

  const { candles, atr, direction } = input;
  const ops = opsFor(direction);

  if (!Number.isFinite(atr) || atr <= 0) return unavailableResult(input, "invalid_atr");
  if (candles.length < 2) return unavailableResult(input, "insufficient_candles");
  // Completed data is not automatically fresh. Stale/partial/unavailable —
  // and missing — block a candidate rather than quietly producing one.
  if (!freshnessAllowsEvaluation(input.freshness)) {
    return unavailableResult(input, "freshness_blocked");
  }

  // Both series are causal: EMA at i depends only on candles <= i, and
  // session VWAP is cumulative. Neither introduces lookahead.
  const mutableCandles = candles as Candle[];
  const emaSeries = calculateEma(mutableCandles, EMA_PERIOD);
  const vwapSeries = calculateVwap(mutableCandles);

  let active: ActiveSetup | null = null;
  let lastTerminalIndex = -1;

  for (let i = 0; i < candles.length; i++) {
    if (active === null || active.terminal) {
      if (active?.terminal) lastTerminalIndex = Math.max(lastTerminalIndex, active.stageIndex);
      const seeded = findSeedReset(candles, i, atr, ops, config, lastTerminalIndex + 1);
      if (seeded !== null) active = seeded;
    }

    if (active !== null && !active.terminal) {
      advance(active, i, {
        candles,
        atr,
        ops,
        config,
        input,
        emaSeries,
        vwapSeries,
      });
    }
  }

  if (active === null) return unavailableResult(input, "no_qualifying_reset");

  return buildResult(active, { candles, atr, ops, config, input, emaSeries, vwapSeries });
}

interface ReplayContext {
  candles: readonly Candle[];
  atr: number;
  ops: DirectionOps;
  config: ReclaimContinuationConfig;
  input: ReclaimMachineInput;
  emaSeries: number[];
  vwapSeries: number[];
}

/** Advances one setup by exactly one completed candle. */
function advance(setup: ActiveSetup, i: number, ctx: ReplayContext): void {
  const { candles, ops } = ctx;
  if (i < setup.extremeIndex) return;

  // While the flush is still extending (no exhaustion yet), a new adverse
  // extreme deepens the SAME reset. A recovery candle never re-anchors.
  if (setup.exhaustionIndex === null && i > setup.extremeIndex) {
    const value = ops.extreme(candles[i]);
    if (ops.adverse(value, setup.extremePrice)) {
      setup.extremeIndex = i;
      setup.extremePrice = value;
      setup.dollars = ops.gap(setup.anchorPrice, value);
      setup.pct = (setup.dollars / setup.anchorPrice) * 100;
      setup.atr = setup.dollars / ctx.atr;
      setup.stageIndex = i;
    }
  }

  advanceExhaustion(setup, i, ctx);
  // Deliberately after exhaustion and in the same iteration: one completed
  // candle may legitimately establish exhaustion AND reclaim a control.
  advanceReclaim(setup, i, ctx);
  advanceLevelTest(setup, i, ctx);
  advanceAcceptance(setup, i, ctx);
  advanceContinuation(setup, i, ctx);
  advanceInvalidation(setup, i, ctx);
}

function advanceExhaustion(setup: ActiveSetup, i: number, ctx: ReplayContext): void {
  if (setup.exhaustionIndex !== null) return;
  if (i < setup.extremeIndex) return;

  const { candles, ops, config, input, atr } = ctx;
  const candle = candles[i];

  // Path A: directional, time-bound sweep evidence whose RECLAIM candle is
  // this one, and which belongs to this reset sequence.
  const sweep = input.sweepEvidence;
  if (
    sweep !== null &&
    sweep.direction === input.direction &&
    sweep.reclaimCandleTime === candle.time &&
    sweep.sweepCandleTime >= candles[setup.anchorIndex].time &&
    sweep.reclaimCandleTime >= candles[setup.extremeIndex].time
  ) {
    setup.exhaustionIndex = i;
    setup.exhaustionViaSweep = true;
    promote(setup, "exhaustion", i);
    return;
  }

  // Path B: a measured recovery on a candle that also closed in the
  // favourable part of its own range.
  const minRecoveryDollars = Math.max(
    config.minRecoveryAtr * atr,
    config.minRecoveryFraction * setup.dollars
  );
  const recovery = ops.gap(candle.close, setup.extremePrice);
  if (recovery < minRecoveryDollars) return;

  const location = closeLocation(candle);
  // A zero-range candle has no close location: unavailable, not a pass.
  if (location === null) return;

  const satisfied =
    ops === BULLISH
      ? location >= config.minBullishCloseLocation
      : location <= config.maxBearishCloseLocation;
  if (!satisfied) return;

  setup.exhaustionIndex = i;
  promote(setup, "exhaustion", i);
}

function advanceReclaim(setup: ActiveSetup, i: number, ctx: ReplayContext): void {
  // Reclaim checks begin only once exhaustion exists.
  if (setup.exhaustionIndex === null) return;
  const { candles, ops, input, emaSeries, vwapSeries } = ctx;
  if (i < 1) return;

  const controls: { name: ControlCrossing["name"]; at: (k: number) => number | null }[] = [
    { name: "9 EMA", at: (k) => finiteOrNull(emaSeries[k]) },
    { name: "VWAP", at: (k) => finiteOrNull(vwapSeries[k]) },
    { name: "Structure level", at: () => input.structureLevel },
  ];

  for (const control of controls) {
    if (setup.crossings.some((c) => c.name === control.name)) continue;

    const level = control.at(i);
    const previous = control.at(i - 1);
    if (level === null || previous === null) continue;

    // The control must have been LOST during or after the reset, then
    // crossed on a completed close. Being on the favourable side the whole
    // time is not a reclaim, and a wick across is not a cross.
    const lost = wasLostSince(candles, control.at, setup.anchorIndex, i, ops);
    if (!lost) continue;

    if (ops.atOrAdverse(candles[i - 1].close, previous) && ops.beyond(candles[i].close, level)) {
      setup.crossings.push({ name: control.name, index: i, price: level });
    }
  }

  if (setup.crossings.length >= 1 && RECLAIM_STAGE_ORDER[setup.stage] < RECLAIM_STAGE_ORDER.reclaim) {
    promote(setup, "reclaim", setup.crossings[0].index);
  }
}

/** Did price trade to/through this control between `from` and `to`? */
function wasLostSince(
  candles: readonly Candle[],
  levelAt: (k: number) => number | null,
  from: number,
  to: number,
  ops: DirectionOps
): boolean {
  for (let k = Math.max(0, from); k <= to; k++) {
    const level = levelAt(k);
    if (level === null) continue;
    if (ops.touchedFrom(candles[k], level)) return true;
  }
  return false;
}

function confirmedIndexOf(setup: ActiveSetup): number | null {
  // The SECOND distinct control is what confirms — not the earliest.
  return setup.crossings.length >= 2 ? setup.crossings[1].index : null;
}

/**
 * Tracked levels usable at candle `i`. The current-session extreme is
 * rebuilt from candles strictly BEFORE `i`, so a level the session only
 * reaches later can never judge an earlier candle.
 */
function levelsAt(i: number, ctx: ReplayContext): AvailableTrackedLevel[] {
  const { input, ops, candles } = ctx;
  const bullish = ops === BULLISH;
  const levels: AvailableTrackedLevel[] = [];

  const push = (name: string, price: number | null, from: number | null) => {
    if (price === null || !Number.isFinite(price)) return;
    const availableFromIndex = from ?? 0;
    if (i < availableFromIndex) return;
    levels.push({ name, price, availableFromIndex });
  };

  push(bullish ? "Prior-day high" : "Prior-day low", input.priorDayLevel, 0);
  push(
    bullish ? "Premarket high" : "Premarket low",
    input.premarketLevel,
    input.premarketAvailableFromIndex
  );
  push(
    bullish ? "Opening-range high" : "Opening-range low",
    input.openingRangeLevel,
    input.openingRangeAvailableFromIndex
  );

  const start = input.regularSessionStartIndex;
  if (start !== null && i > start) {
    let extreme: number | null = null;
    for (let k = start; k < i; k++) {
      const value = ops.anchor(candles[k]);
      if (extreme === null || ops.beyond(value, extreme)) extreme = value;
    }
    if (extreme !== null) {
      levels.push({
        name: bullish ? "Session high" : "Session low",
        price: extreme,
        availableFromIndex: start + 1,
      });
    }
  }

  return levels;
}

/** The nearest cluster ahead of price at candle `i`. */
function activeClusterAt(i: number, ctx: ReplayContext): LevelCluster | null {
  const { candles, ops, atr, config, input } = ctx;
  const price = candles[i].close;
  const clusters = clusterLevels(levelsAt(i, ctx), atr, input.direction, config);

  let nearest: LevelCluster | null = null;
  for (const cluster of clusters) {
    if (cluster.availableFromIndex > i) continue;
    // "In the way" means ahead of price right now. A level broken earlier
    // and since lost becomes relevant again by this same test.
    if (!ops.beyond(cluster.price, price)) continue;
    if (nearest === null || ops.gap(cluster.price, price) < ops.gap(nearest.price, price)) {
      nearest = cluster;
    }
  }
  return nearest;
}

function advanceLevelTest(setup: ActiveSetup, i: number, ctx: ReplayContext): void {
  const confirmed = confirmedIndexOf(setup);
  if (confirmed === null || i < confirmed) return;
  if (setup.levelTestIndex !== null) return;
  if (RECLAIM_STAGE_ORDER[setup.stage] >= RECLAIM_STAGE_ORDER.acceptance) return;

  const cluster = activeClusterAt(i, ctx);
  if (cluster === null) return;

  const distance = ctx.ops.gap(cluster.price, ctx.candles[i].close);
  if (distance > ctx.config.levelTestDistanceAtr * ctx.atr) return;

  setup.levelTestIndex = i;
  promote(setup, "level_test", i);
}

function advanceAcceptance(setup: ActiveSetup, i: number, ctx: ReplayContext): void {
  if (setup.acceptance !== null) return;
  const confirmed = confirmedIndexOf(setup);
  // Acceptance requires a CONFIRMED reclaim; it is never discovered by
  // searching back from the reset extreme.
  if (confirmed === null || i <= confirmed) return;

  const { candles, ops, atr, config } = ctx;
  const buffer = config.breakBufferAtr * atr;

  // Consider every cluster that was available in time, using each
  // candle's own contemporaneous level set.
  for (let breakIndex = confirmed; breakIndex <= i; breakIndex++) {
    const clusters = clusterLevels(levelsAt(breakIndex, ctx), atr, ctx.input.direction, config);
    for (const cluster of clusters) {
      // Scanning starts no earlier than BOTH confirmed reclaim and the
      // level's own availability.
      if (breakIndex < Math.max(confirmed, cluster.availableFromIndex)) continue;

      const buffered = ops.offset(cluster.price, buffer);
      // A wick through is not a break: only a completed CLOSE counts.
      if (!ops.atOrBeyond(candles[breakIndex].close, buffered)) continue;

      // (A) two consecutive completed closes beyond the buffered price.
      if (breakIndex + 1 <= i && ops.atOrBeyond(candles[breakIndex + 1].close, buffered)) {
        setup.acceptance = {
          breakIndex,
          acceptedIndex: breakIndex + 1,
          viaRetest: false,
          levelPrice: cluster.price,
          levelSources: cluster.sources,
        };
        promote(setup, "acceptance", breakIndex + 1);
        return;
      }

      // (B) a controlled retest inside the window.
      const windowEnd = Math.min(i, breakIndex + config.retestWindowBars);
      for (let k = breakIndex + 1; k <= windowEnd; k++) {
        if (ops.touchedFrom(candles[k], buffered) && ops.beyond(candles[k].close, cluster.price)) {
          setup.acceptance = {
            breakIndex,
            acceptedIndex: k,
            viaRetest: true,
            levelPrice: cluster.price,
            levelSources: cluster.sources,
          };
          promote(setup, "acceptance", k);
          return;
        }
      }
    }
  }
}

function advanceContinuation(setup: ActiveSetup, i: number, ctx: ReplayContext): void {
  if (setup.continuationIndex !== null) return;
  const acceptance = setup.acceptance;
  if (acceptance === null || i <= acceptance.acceptedIndex) return;

  const { candles, ops } = ctx;

  // A pivot exists only once its right-hand candle is complete, so p+1
  // must be <= i.
  for (let p = acceptance.breakIndex + 1; p + 1 <= i; p++) {
    const centre = ops.extreme(candles[p]);
    if (!ops.beyond(ops.extreme(candles[p - 1]), centre)) continue;
    if (!ops.beyond(ops.extreme(candles[p + 1]), centre)) continue;
    if (!ops.beyond(centre, acceptance.levelPrice)) continue;

    let peak = ops.anchor(candles[acceptance.breakIndex]);
    for (let k = acceptance.breakIndex; k <= p + 1; k++) {
      const value = ops.anchor(candles[k]);
      if (ops.beyond(value, peak)) peak = value;
    }

    for (let k = p + 2; k <= i; k++) {
      if (ops.beyond(candles[k].close, peak)) {
        setup.continuationIndex = k;
        promote(setup, "continuation", k);
        // Continuation is a terminal lifecycle state: a later reset may
        // seed a new identity after it.
        setup.terminal = true;
        return;
      }
    }
  }
}

/**
 * Invalidation, locked from information available when it activates.
 *
 * It becomes active once the setup is live (exhaustion). The chosen source
 * uses its CONTEMPORANEOUS value — a reclaimed VWAP locks the VWAP of the
 * crossing candle, never the latest value in the series. It may only trail
 * FORWARD to a confirmed pivot that is more protective, and only from the
 * candle on which that pivot completed.
 */
function advanceInvalidation(setup: ActiveSetup, i: number, ctx: ReplayContext): void {
  if (setup.exhaustionIndex === null || i < setup.exhaustionIndex) return;
  const { candles, ops } = ctx;

  // A confirmed pivot is available only once its right-hand bar completed.
  const p = i - 1;
  if (p > setup.extremeIndex && p - 1 >= 0) {
    const centre = ops.extreme(candles[p]);
    if (
      ops.beyond(ops.extreme(candles[p - 1]), centre) &&
      ops.beyond(ops.extreme(candles[p + 1] ?? candles[p]), centre) &&
      ops.beyond(centre, setup.extremePrice) &&
      (setup.invalidation === null || ops.beyond(centre, setup.invalidation.price))
    ) {
      setup.invalidation = {
        name: ops === BULLISH ? "Higher low" : "Lower high",
        price: centre,
        activationIndex: i,
      };
    }
  }

  if (setup.invalidation === null) {
    // Structure, then VWAP, then 9 EMA — each at its own locked crossing
    // value — otherwise the reset extreme, which always participated.
    const structure = setup.crossings.find((c) => c.name === "Structure level");
    const vwap = setup.crossings.find((c) => c.name === "VWAP");
    const ema = setup.crossings.find((c) => c.name === "9 EMA");
    const chosen = structure ?? vwap ?? ema;

    setup.invalidation =
      chosen !== undefined
        ? { name: chosen.name, price: chosen.price, activationIndex: chosen.index }
        : {
            name: ops === BULLISH ? "Reset low" : "Reset high",
            price: setup.extremePrice,
            activationIndex: setup.exhaustionIndex,
          };
  }

  // Closes are judged forward only, and a wick alone never invalidates.
  if (i > setup.invalidation.activationIndex && ops.adverse(candles[i].close, setup.invalidation.price)) {
    setup.stage = "invalidated";
    setup.stageIndex = i;
    setup.terminal = true;
  }
}

function promote(setup: ActiveSetup, stage: ReclaimStage, index: number): void {
  if (RECLAIM_STAGE_ORDER[stage] <= RECLAIM_STAGE_ORDER[setup.stage]) return;
  setup.stage = stage;
  setup.stageIndex = index;
}

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Result assembly
// ---------------------------------------------------------------------------

function buildResult(setup: ActiveSetup, ctx: ReplayContext): ReclaimMachineResult {
  const { candles, ops, atr, input } = ctx;
  const lastIndex = candles.length - 1;
  const currentPrice = candles[lastIndex].close;

  const reclaimStatus: ReclaimStatus =
    setup.crossings.length >= 2 ? "confirmed" : setup.crossings.length === 1 ? "forming" : "none";

  const cluster = activeClusterAt(lastIndex, ctx);
  const distance = cluster === null ? null : ops.gap(cluster.price, currentPrice);
  const recovery = ops.gap(currentPrice, setup.extremePrice);

  const acceptedPrice = setup.acceptance?.levelPrice ?? null;
  const isExtended =
    setup.acceptance !== null &&
    !setup.acceptance.viaRetest &&
    acceptedPrice !== null &&
    ops.gap(currentPrice, acceptedPrice) > ctx.config.chaseGuardAtr * atr;

  const crossing = (name: ControlCrossing["name"]) => setup.crossings.find((c) => c.name === name);

  return {
    symbol: input.symbol,
    sessionDate: input.sessionDate,
    timeframe: input.timeframe,
    direction: input.direction,
    stage: setup.stage,
    reclaimStatus,
    stageChangedAt: candles[setup.stageIndex].time,
    unavailableReason: null,
    setupKey: `${input.symbol}:${input.sessionDate}:${input.direction}:${candles[setup.anchorIndex].time}:${candles[setup.extremeIndex].time}`,

    resetSeverity: resetSeverityFor(setup.atr, ctx.config),
    resetDollars: setup.dollars,
    resetPct: setup.pct,
    resetAtr: setup.atr,
    resetAnchorPrice: setup.anchorPrice,
    resetAnchorTime: candles[setup.anchorIndex].time,
    resetExtremePrice: setup.extremePrice,
    resetExtremeTime: candles[setup.extremeIndex].time,

    recoveryDollars: recovery,
    recoveryPct: setup.extremePrice > 0 ? (recovery / setup.extremePrice) * 100 : null,
    recoveryAtr: recovery / atr,

    ema9: finiteOrNull(ctx.emaSeries[lastIndex]),
    emaReclaimed: crossing("9 EMA") !== undefined,
    vwap: finiteOrNull(ctx.vwapSeries[lastIndex]),
    vwapReclaimed: crossing("VWAP") !== undefined,
    structureLevel: input.structureLevel,
    structureReclaimed: crossing("Structure level") !== undefined,
    reclaimFormingAt: setup.crossings[0] ? candles[setup.crossings[0].index].time : null,
    reclaimConfirmedAt: setup.crossings[1] ? candles[setup.crossings[1].index].time : null,

    activeLevelSources: cluster?.sources ?? [],
    activeLevelPrice: cluster?.price ?? null,
    nextLevelName: cluster === null ? null : cluster.sources.join(" / "),
    nextLevelPrice: cluster?.price ?? null,
    distanceToNextLevelDollars: distance,
    distanceToNextLevelPct:
      distance === null || !(currentPrice > 0) ? null : (distance / currentPrice) * 100,
    distanceToNextLevelAtr: distance === null ? null : distance / atr,

    acceptedLevelName: setup.acceptance?.levelSources.join(" / ") ?? null,
    acceptedLevelPrice: acceptedPrice,
    invalidationName: setup.invalidation?.name ?? null,
    invalidationPrice: setup.invalidation?.price ?? null,
    invalidationActiveFromIndex: setup.invalidation?.activationIndex ?? null,

    volumePace: input.volumePace,
    benchmarkRelativeMove: input.benchmarkRelativeMove,
    isExtended,
    aboveAllTrackedLevels: cluster === null && levelsAt(lastIndex, ctx).length > 0,
    freshness: input.freshness,

    evidence: buildEvidence(setup, reclaimStatus, cluster, ctx),
    summary: buildSummary(setup, reclaimStatus, cluster, ctx),
  };
}

function unavailableResult(
  input: ReclaimMachineInput,
  reason: ReclaimUnavailableReason
): ReclaimMachineResult {
  return {
    symbol: input.symbol,
    sessionDate: input.sessionDate,
    timeframe: input.timeframe,
    direction: input.direction,
    stage: "unavailable",
    reclaimStatus: "none",
    stageChangedAt: null,
    unavailableReason: reason,
    setupKey: null,
    resetSeverity: null,
    resetDollars: null,
    resetPct: null,
    resetAtr: null,
    resetAnchorPrice: null,
    resetAnchorTime: null,
    resetExtremePrice: null,
    resetExtremeTime: null,
    recoveryDollars: null,
    recoveryPct: null,
    recoveryAtr: null,
    ema9: null,
    emaReclaimed: false,
    vwap: null,
    vwapReclaimed: false,
    structureLevel: input.structureLevel,
    structureReclaimed: false,
    reclaimFormingAt: null,
    reclaimConfirmedAt: null,
    activeLevelSources: [],
    activeLevelPrice: null,
    nextLevelName: null,
    nextLevelPrice: null,
    distanceToNextLevelDollars: null,
    distanceToNextLevelPct: null,
    distanceToNextLevelAtr: null,
    acceptedLevelName: null,
    acceptedLevelPrice: null,
    invalidationName: null,
    invalidationPrice: null,
    invalidationActiveFromIndex: null,
    volumePace: input.volumePace,
    benchmarkRelativeMove: input.benchmarkRelativeMove,
    isExtended: false,
    aboveAllTrackedLevels: false,
    freshness: input.freshness,
    evidence: [freshnessEvidence(input.freshness)],
    summary: UNAVAILABLE_SUMMARY[reason],
  };
}

const UNAVAILABLE_SUMMARY: Record<ReclaimUnavailableReason, string> = {
  invalid_atr: "ATR unavailable — cannot measure reset depth",
  insufficient_candles: "Not enough completed candles yet",
  no_qualifying_reset: "No qualifying reset in the lookback window",
  freshness_blocked: "Market data is not fresh enough to evaluate a candidate",
};

const FRESHNESS_DETAIL: Record<FreshnessStatus, string> = {
  real_time: "Real-time completed candles",
  delayed: "Known delayed feed",
  stale: "Stale data — no candidate",
  partial: "Partial data — no candidate",
  unavailable: "Freshness unavailable",
};

function freshnessEvidence(freshness: FreshnessStatus | null): ReclaimEvidenceGroup {
  if (freshness === null) {
    return { name: "dataFreshness", state: "unavailable", detail: "Freshness unavailable" };
  }
  return {
    name: "dataFreshness",
    // A delayed feed may calculate, but it is never reported as a pass —
    // the evidence says plainly that the feed is delayed.
    state: freshness === "real_time" ? "pass" : freshness === "delayed" ? "forming" : "unavailable",
    detail: FRESHNESS_DETAIL[freshness],
  };
}

function buildEvidence(
  setup: ActiveSetup,
  reclaimStatus: ReclaimStatus,
  cluster: LevelCluster | null,
  ctx: ReplayContext
): ReclaimEvidenceGroup[] {
  const { input } = ctx;
  return [
    {
      name: "resetDepth",
      state: "pass",
      detail: `${setup.atr.toFixed(2)} ATR reset ($${setup.dollars.toFixed(2)})`,
    },
    {
      name: "failedContinuation",
      state: setup.exhaustionIndex === null ? "waiting" : "pass",
      detail:
        setup.exhaustionIndex === null
          ? "Original pressure still extending"
          : setup.exhaustionViaSweep
          ? "Swept and reclaimed"
          : "Pressure stopped extending",
    },
    {
      name: "controlReclaim",
      state:
        reclaimStatus === "confirmed" ? "pass" : reclaimStatus === "forming" ? "forming" : "waiting",
      detail:
        setup.crossings.length === 0
          ? "No control level reclaimed yet"
          : setup.crossings.map((c) => c.name).join(" + ") + ` reclaimed`,
    },
    {
      name: "participation",
      state: input.volumePace === null ? "unavailable" : "pass",
      detail: input.volumePace === null ? "Unavailable" : `${input.volumePace.toFixed(1)}× normal pace`,
    },
    {
      name: "roomToContinue",
      state: cluster === null ? "unavailable" : "pass",
      detail:
        cluster === null
          ? "No tracked level ahead"
          : `${cluster.sources.join(" / ")}: $${cluster.price.toFixed(2)}`,
    },
    freshnessEvidence(input.freshness),
  ];
}

function buildSummary(
  setup: ActiveSetup,
  reclaimStatus: ReclaimStatus,
  cluster: LevelCluster | null,
  ctx: ReplayContext
): string {
  const word = ctx.input.direction === "bullish" ? "Flushed" : "Squeezed";
  const parts = [`${word} $${setup.dollars.toFixed(2)} (${setup.atr.toFixed(2)} ATR)`];
  if (reclaimStatus !== "none") parts.push(`reclaim ${reclaimStatus}`);
  if (cluster === null) {
    parts.push(
      ctx.input.direction === "bullish"
        ? "already above all tracked resistance"
        : "already below all tracked support"
    );
  } else {
    parts.push(`${cluster.sources.join(" / ")} at $${cluster.price.toFixed(2)}`);
  }
  if (setup.stage === "invalidated") parts.push("invalidated");
  return `${parts.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// Active-candidate selection
// ---------------------------------------------------------------------------

export interface MachineCandidateSelection {
  /** Only an ACTIVE setup may win. */
  winner: ReclaimMachineResult | null;
  /** An invalidated setup, returned separately as historical state. */
  historical: ReclaimMachineResult | null;
  ambiguous: boolean;
  reason: string | null;
}

/**
 * Resolves the single active candidate for ONE machine.
 *
 * An invalidated setup never wins merely because the opposite direction is
 * unavailable — a setup that broke is not the thing to act on. It is
 * returned separately so a caller can still show it as history.
 */
export function selectMachineCandidate(
  bullish: ReclaimMachineResult,
  bearish: ReclaimMachineResult
): MachineCandidateSelection {
  const invalidated = [bullish, bearish].filter((r) => r.stage === "invalidated");
  const historical = invalidated.length > 0 ? invalidated[0] : null;

  const live = [bullish, bearish].filter((r) => isActiveStage(r.stage));
  if (live.length === 0) {
    return { winner: null, historical, ambiguous: false, reason: "No active setup" };
  }
  if (live.length === 1) return { winner: live[0], historical, ambiguous: false, reason: null };

  const [a, b] = live;
  const byStage = RECLAIM_STAGE_ORDER[a.stage] - RECLAIM_STAGE_ORDER[b.stage];
  if (byStage !== 0) {
    return { winner: byStage > 0 ? a : b, historical, ambiguous: false, reason: null };
  }

  const rank: Record<ReclaimStatus, number> = { none: 0, forming: 1, confirmed: 2 };
  const byReclaim = rank[a.reclaimStatus] - rank[b.reclaimStatus];
  if (byReclaim !== 0) {
    return { winner: byReclaim > 0 ? a : b, historical, ambiguous: false, reason: null };
  }

  const aAt = a.stageChangedAt ?? -Infinity;
  const bAt = b.stageChangedAt ?? -Infinity;
  if (aAt !== bAt) return { winner: aAt > bAt ? a : b, historical, ambiguous: false, reason: null };

  const aAtr = a.resetAtr ?? -Infinity;
  const bAtr = b.resetAtr ?? -Infinity;
  if (aAtr !== bAtr) {
    return { winner: aAtr > bAtr ? a : b, historical, ambiguous: false, reason: null };
  }

  return { winner: null, historical, ambiguous: true, reason: "Ambiguous opposing setup" };
}
