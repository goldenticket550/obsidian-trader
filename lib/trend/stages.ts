import { opsFor } from "./direction";
import type { TrendScannerConfig } from "./config";
import { assertValidTrendScannerConfig } from "./config";
import type {
  KeyLevel,
  TrendBlocker,
  TrendDirection,
  TrendFacts,
  TrendLifecycle,
  TrendOrigin,
  TrendStage,
  TrendTransition,
} from "./types";
import { TREND_STAGE_ORDER, isLiveStage } from "./types";

/**
 * THE STAGE MACHINE.
 *
 * A persistent lifecycle. `advanceLifecycle` takes the PREVIOUS
 * lifecycle and the CURRENT facts and returns the next one. It never
 * recomputes the stage from scratch, which is what allows a later red
 * candle to weaken the facts without erasing the fact that Trend Watch
 * happened.
 *
 * Rules that hold everywhere:
 *  - forward only, except `failed`, which any live stage may enter;
 *  - a stage may JUMP forward when the facts justify it;
 *  - `transitions` is append-only history;
 *  - a new setup may lock only after the previous one failed or expired.
 */

export const MILESTONE_EPSILON = 1e-9;

export interface AdvanceInput {
  previous: TrendLifecycle;
  facts: TrendFacts;
  direction: TrendDirection;
  config: TrendScannerConfig;
  /** Market time of the completed bar driving this evaluation. */
  marketDataAt: string;
  /** A freshly locked origin, when the origin detector found one. */
  candidateOrigin: TrendOrigin | null;
  /** True when a Path A base exists but has not yet earned Trend Watch. */
  hasBasingCandidate: boolean;
  /**
   * Best completed extreme since the origin, EXCLUDING the current bar.
   * The blue-sky reference for TAP 2 when no tracked level is left ahead.
   */
  blueSkyReference: number | null;
  /** Previous completed close, for "was not already beyond" checks. */
  previousClose: number | null;
  /** Whether required data is fresh and the session is allowed. */
  evaluable: boolean;
}

export interface AdvanceOutput {
  lifecycle: TrendLifecycle;
  /** Transitions ADDED by this evaluation, in order. */
  newTransitions: TrendTransition[];
  /** Percent milestones newly crossed by this evaluation. */
  newMilestones: number[];
  blockers: TrendBlocker[];
  nextConfirmation: string | null;
}

export function emptyLifecycle(): TrendLifecycle {
  return {
    setupKey: null,
    stage: "idle",
    origin: null,
    transitions: [],
    firedMilestones: [],
    clearedLevels: [],
    failedAt: null,
  };
}

export function buildSetupKey(
  symbol: string,
  direction: TrendDirection,
  tradingDate: string,
  origin: TrendOrigin
): string {
  return `${symbol}:${direction}:${tradingDate}:${origin.mode}:${origin.establishedAt}`;
}

/** How many of {5m EMA, 5m SMA, VWAP} currently support the direction. */
function broaderSupportCount(facts: TrendFacts): number {
  let n = 0;
  if (facts.fiveMinuteEma9.above === true) n += 1;
  if (facts.fiveMinuteSma20.above === true) n += 1;
  if (facts.vwap.above === true) n += 1;
  return n;
}

/**
 * Trend Watch's broader-position requirement: ANY ONE of four facts.
 *
 * Deliberately not all of them. Requiring EMA and SMA and VWAP and
 * benchmark strength together is what made the old scanner silent on
 * genuinely developing names. Missing facts are reported, not vetoed.
 */
function broaderPositionConfirmed(facts: TrendFacts): boolean {
  return broaderSupportCount(facts) > 0 || facts.nearestLevel !== null;
}

function transitionsOk(facts: TrendFacts, config: TrendScannerConfig): boolean {
  return (
    facts.closeTransitions.measurable &&
    facts.closeTransitions.favourable >= config.minimumHigherCloses
  );
}

/** Trend Watch gate. Returns the unmet requirements rather than a boolean. */
function watchBlockers(facts: TrendFacts, config: TrendScannerConfig): TrendBlocker[] {
  const blockers: TrendBlocker[] = [];

  if (facts.oneMinuteEma9.above !== true) {
    blockers.push({
      requirement: "Above the 1m 9 EMA",
      detail:
        facts.oneMinuteEma9.above === null
          ? "1-minute EMA not measurable"
          : "price is on the wrong side",
    });
  }
  if (facts.oneMinuteEma9.rising !== true) {
    blockers.push({
      requirement: "1m 9 EMA turning up",
      detail: facts.oneMinuteEma9.rising === null ? "not enough history" : "slope is against it",
    });
  }
  if (!transitionsOk(facts, config)) {
    blockers.push({
      requirement: `${config.minimumHigherCloses} of ${config.higherCloseTransitions} closes in trend`,
      detail: facts.closeTransitions.measurable
        ? `${facts.closeTransitions.favourable} of ${facts.closeTransitions.transitions}`
        : "not enough completed candles",
    });
  }
  // Relative volume is DELIBERATELY not a Trend Watch requirement.
  //
  // TAP 1 is a price/structure call. Gating it on participation meant a
  // partial-coverage feed could withhold it indefinitely: on real IEX
  // data for 2026-08-03, relative volume was the ONLY blocker on 28 NVDA
  // bars and delayed TAP 1 from roughly 10:20 to 13:10 ET. Volume is
  // still computed, displayed and used for ranking — it just cannot veto
  // a structurally valid watch.
  if (!broaderPositionConfirmed(facts)) {
    blockers.push({
      requirement: "One broader-position confirmation",
      detail: "not above the 5m 9 EMA, 5m 20 SMA or VWAP, and no key level in play",
    });
  }

  return blockers;
}

function confirmedBlockers(
  facts: TrendFacts,
  config: TrendScannerConfig
): TrendBlocker[] {
  const blockers: TrendBlocker[] = [];

  const required =
    facts.atr5m === null
      ? null
      : Math.max(
          config.trendConfirmedMinimumDollars,
          facts.atr5m * config.trendConfirmedMinimumAtr
        );

  if (required === null) {
    blockers.push({ requirement: "Measurable ATR", detail: "5-minute ATR unavailable" });
  } else if (facts.fromOriginDollars === null) {
    blockers.push({ requirement: "Move from origin", detail: "no locked origin yet" });
  } else if (facts.fromOriginDollars < required) {
    blockers.push({
      requirement: `Move of $${required.toFixed(2)} from origin`,
      detail: `$${facts.fromOriginDollars.toFixed(2)} so far`,
    });
  }

  // Volume contributes to confirmation, but a PARTIAL-COVERAGE feed
  // cannot veto it. IEX prints a slice of consolidated volume, so a
  // sub-threshold ratio there is a feed artefact as much as a
  // participation fact. Under full (SIP) coverage the threshold applies
  // normally; under partial coverage it is informational only.
  if (!facts.relativeVolume.partialMarketCoverage) {
    if (facts.relativeVolume.multiple === null) {
      blockers.push({
        requirement: `Relative volume >= ${config.confirmedRelativeVolume}`,
        detail: facts.relativeVolume.unavailableReason ?? "not measurable",
      });
    } else if (facts.relativeVolume.multiple < config.confirmedRelativeVolume) {
      blockers.push({
        requirement: `Relative volume >= ${config.confirmedRelativeVolume}`,
        detail: `${facts.relativeVolume.multiple.toFixed(2)}x`,
      });
    }
  }

  const support = broaderSupportCount(facts);
  if (support < 2) {
    blockers.push({
      requirement: "Two of: 5m 9 EMA, 5m 20 SMA, VWAP",
      detail: `${support} of 3 currently supporting`,
    });
  }

  return blockers;
}

/** Stable identity for a level, so it is cleared exactly once. */
export function levelKey(level: KeyLevel): string {
  return `${level.name}@${level.price.toFixed(4)}`;
}

export interface Tap2Trigger {
  /** Honest description of what actually triggered it. */
  reason: string;
  /** The level cleared, or null for a blue-sky structural continuation. */
  level: KeyLevel | null;
}

/**
 * TAP 2 — RUNNING continuation confirmation.
 *
 * Fires only after TAP 1, on the first completed close that clears the
 * NEAREST unbroken level still ahead of price, then RE-ARMS to the next
 * one. A move that walks up through the premarket high, then the
 * prior-day high, then a pivot reports each of them rather than only the
 * first.
 *
 * Blue-sky fallback: with no tracked level left ahead, a completed close
 * making a new high beyond everything since the origin is itself the
 * continuation. Without this, the strongest moves — the ones already in
 * clear air — would go unconfirmed forever.
 *
 * Causal throughout: the target is chosen from the PREVIOUS close, and
 * the blue-sky reference excludes the current bar, so the bar that makes
 * the new high is the bar that reports it.
 *
 * Volume follows the same coverage rule as confirmation: informational
 * under partial coverage, thresholded under full coverage.
 */
export function detectTap2(args: {
  facts: TrendFacts;
  direction: TrendDirection;
  config: TrendScannerConfig;
  previousClose: number | null;
  cleared: readonly string[];
  /** Best completed extreme since the origin, EXCLUDING the current bar. */
  blueSkyReference: number | null;
}): Tap2Trigger | null {
  const { facts, direction, config, previousClose, cleared } = args;
  if (facts.price === null || previousClose === null) return null;
  const ops = opsFor(direction);

  // Volume: never a veto under partial coverage.
  if (!facts.relativeVolume.partialMarketCoverage) {
    const rv = facts.relativeVolume.multiple;
    if (rv === null || rv < config.levelBreakRelativeVolume) return null;
  }

  // Nearest UNBROKEN level still ahead of the PREVIOUS close.
  let target: KeyLevel | null = null;
  for (const level of facts.levels) {
    if (!Number.isFinite(level.price)) continue;
    if (cleared.includes(levelKey(level))) continue;
    if (!ops.beyond(level.price, previousClose)) continue;
    if (target === null || ops.beyond(target.price, level.price)) target = level;
  }

  if (target !== null) {
    const buffer = Math.abs(target.price) * config.levelBreakBufferPct;
    const threshold =
      direction === "bullish" ? target.price + buffer : target.price - buffer;
    if (!ops.beyond(facts.price, threshold)) return null;
    return {
      level: target,
      reason: `Completed close through the ${target.name.toLowerCase()} at ${target.price.toFixed(2)}`,
    };
  }

  // Blue sky: nothing tracked is ahead any more.
  const reference = args.blueSkyReference;
  if (reference === null) return null;
  if (!ops.beyond(facts.price, reference)) return null;
  return {
    level: null,
    reason: `New-high continuation — closed beyond every level since the origin (${reference.toFixed(2)})`,
  };
}

/** Failure conditions. Any one ends the setup on a completed candle. */
function failureReason(
  facts: TrendFacts,
  origin: TrendOrigin | null,
  direction: TrendDirection
): string | null {
  if (origin === null || facts.price === null) return null;
  const ops = opsFor(direction);

  if (ops.adverse(facts.price, origin.invalidationPrice)) {
    return `Closed through the invalidation at ${origin.invalidationPrice.toFixed(2)}`;
  }
  // Two-sided breakdown: wrong side of the 1m 9 EMA AND the 5m 20 SMA.
  if (facts.oneMinuteEma9.above === false && facts.fiveMinuteSma20.above === false) {
    return "Lost both the 1m 9 EMA and the 5m 20 SMA";
  }
  return null;
}

/**
 * Percent milestones from the LOCKED origin, fired once per setup key.
 *
 * Percent only — never silently converted into dollar milestones, which
 * would mean something different on a $30 stock than a $300 one.
 */
export function crossedMilestones(
  movePct: number | null,
  fired: readonly number[],
  milestones: readonly number[]
): number[] {
  if (movePct === null) return [];
  return milestones.filter(
    (m) => movePct + MILESTONE_EPSILON >= m && !fired.includes(m)
  );
}

export function advanceLifecycle(input: AdvanceInput): AdvanceOutput {
  assertValidTrendScannerConfig(input.config);

  const { previous, facts, direction, config, marketDataAt } = input;
  const newTransitions: TrendTransition[] = [];
  let lifecycle: TrendLifecycle = {
    ...previous,
    transitions: [...previous.transitions],
    firedMilestones: [...previous.firedMilestones],
  };

  const record = (stage: TrendStage, reason: string) => {
    // History is append-only and ALWAYS records what happened. The
    // headline stage only moves FORWARD (failure aside), so a TAP 2
    // level break arriving after `extended` is still recorded without
    // dragging the displayed stage backwards.
    if (
      stage === "failed" ||
      TREND_STAGE_ORDER[stage] > TREND_STAGE_ORDER[lifecycle.stage]
    ) {
      lifecycle.stage = stage;
    }
    const t: TrendTransition = { stage, marketDataAt, reason };
    lifecycle.transitions.push(t);
    newTransitions.push(t);
  };

  // ---- Failure first: a live setup can fail on any candle. ----
  if (isLiveStage(previous.stage)) {
    const reason = failureReason(facts, lifecycle.origin, direction);
    if (reason !== null) {
      record("failed", reason);
      // RELEASE the origin. History is kept — the fact that this setup
      // reached Trend Watch is not erased — but the dead origin must not
      // keep re-triggering its own invalidation on every later bar.
      lifecycle = {
        ...lifecycle,
        origin: null,
        setupKey: null,
        failedAt: marketDataAt,
      };
      return {
        lifecycle,
        newTransitions,
        newMilestones: [],
        blockers: [],
        nextConfirmation: "A new origin must form before this symbol is tracked again",
      };
    }
  }

  // ---- Lock an origin when there is none and one is available. ----
  // A new setup may start only after the previous one is terminal.
  const mayStartNew = previous.stage === "idle" || previous.stage === "failed";
  // After a failure the replacement must be a GENUINELY new origin —
  // established strictly after the failure. Re-locking the same base
  // immediately is what produced the oscillation.
  const isGenuinelyNew =
    lifecycle.failedAt === null ||
    (input.candidateOrigin !== null && input.candidateOrigin.establishedAt > lifecycle.failedAt);

  if (
    lifecycle.origin === null &&
    input.candidateOrigin !== null &&
    mayStartNew &&
    isGenuinelyNew
  ) {
    lifecycle = {
      ...lifecycle,
      origin: input.candidateOrigin,
      // A fresh setup identity, and a fresh milestone ledger with it.
      firedMilestones: [],
      // History from the previous setup does not carry into this one.
      transitions: [],
    };
    lifecycle.setupKey = null; // assigned by the caller with symbol/date
  }

  const origin = lifecycle.origin;

  // ---- Basing: a candidate exists but Trend Watch is not earned. ----
  if (origin === null) {
    if (input.hasBasingCandidate && previous.stage !== "basing") {
      record("basing", "A higher-low base is forming but has not confirmed");
    }
    return {
      lifecycle,
      newTransitions,
      newMilestones: [],
      blockers: watchBlockers(facts, config),
      nextConfirmation: "A base or momentum origin must lock first",
    };
  }

  // ---- Everything below requires fresh, in-session data. ----
  if (!input.evaluable) {
    return {
      lifecycle,
      newTransitions,
      newMilestones: [],
      blockers: [{ requirement: "Fresh in-session data", detail: "evaluation gated" }],
      nextConfirmation: null,
    };
  }

  const wBlockers = watchBlockers(facts, config);
  const cBlockers = confirmedBlockers(facts, config);

  /**
   * Has this stage been REACHED, per recorded history?
   *
   * Deliberately not an ordinal comparison against the current stage.
   * `extended` sits above `level_break` and `trend_confirmed` in the
   * linear order, so a symbol that stretched away from its EMA early
   * would have had both of those permanently masked — TAP 2 would never
   * fire on a name that ran hard, which is precisely the name it exists
   * for. Observed in replay: price ran 98 -> 108 through a 101 premarket
   * high and recorded no level break at all.
   */
  const reached = (s: TrendStage) => lifecycle.transitions.some((t) => t.stage === s);
  /** Linear progression still uses the ordinal. */
  const at = (s: TrendStage) => TREND_STAGE_ORDER[lifecycle.stage] >= TREND_STAGE_ORDER[s];
  const actionable = () => at("trend_watch") || reached("trend_watch");

  // ---- trend_watch ----
  if (wBlockers.length === 0 && !at("trend_watch")) {
    record("trend_watch", "Fresh trend development on completed candles");
  }

  // ---- trend_confirmed (may jump straight here) ----
  if (wBlockers.length === 0 && cBlockers.length === 0 && !reached("trend_confirmed")) {
    record("trend_confirmed", "Measured move from the locked origin with participation");
  }

  // ---- level_break — TAP 2, RUNNING and re-arming ----
  //
  // Only after TAP 1, and deliberately NOT gated on `reached(...)`: this
  // fires again each time the move clears the next unbroken level. The
  // `clearedLevels` ledger is what prevents the SAME level re-firing.
  if (actionable()) {
    const trigger = detectTap2({
      facts,
      direction,
      config,
      previousClose: input.previousClose,
      cleared: lifecycle.clearedLevels,
      blueSkyReference: input.blueSkyReference,
    });
    if (trigger !== null) {
      // A blue-sky continuation has no level to retire, so it is keyed on
      // the bar instead — otherwise every later bar would re-fire it.
      const key =
        trigger.level === null ? `blue-sky@${marketDataAt}` : levelKey(trigger.level);
      if (!lifecycle.clearedLevels.includes(key)) {
        lifecycle = { ...lifecycle, clearedLevels: [...lifecycle.clearedLevels, key] };
        record("level_break", trigger.reason);
      }
    }
  }

  // ---- extended — a caution state, never an instruction ----
  if (
    actionable() &&
    facts.atrFromFiveMinuteEma !== null &&
    facts.atrFromFiveMinuteEma > config.extendedAtrFromFiveMinuteEma &&
    !reached("extended")
  ) {
    record(
      "extended",
      `${facts.atrFromFiveMinuteEma.toFixed(1)} ATR from the 5m 9 EMA — stretched, not a signal`
    );
  }

  // ---- milestones, once per setup, percent from the locked origin ----
  const newMilestones = actionable()
    ? crossedMilestones(facts.fromOriginPct, lifecycle.firedMilestones, config.percentMilestones)
    : [];
  if (newMilestones.length > 0) {
    lifecycle.firedMilestones = [...lifecycle.firedMilestones, ...newMilestones];
  }

  const blockers = reached("trend_confirmed") ? [] : actionable() ? cBlockers : wBlockers;
  const nextConfirmation = reached("level_break")
    ? null
    : reached("trend_confirmed")
    ? `A completed close through the ${facts.nearestLevel?.name.toLowerCase() ?? "next level ahead"}`
    : actionable()
    ? "A measured move from the origin with participation"
    : "Trend Watch conditions on a completed candle";

  return { lifecycle, newTransitions, newMilestones, blockers, nextConfirmation };
}
