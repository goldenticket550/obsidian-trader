import { opsFor } from "./direction";
import { PRICE_EPSILON } from "./origin";
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
    structureStop: null,
    lastContinuationLow: null,
    continuationCount: 0,
    holding: false,
    lastContinuationAt: null,
    legCount: 0,
  };
}

/**
 * Has a genuine pullback happened since the last continuation alert?
 *
 * "Genuine" means the same structure a re-entry requires: a CONFIRMED
 * higher low, formed after that alert and inside this setup. The first
 * continuation of a leg needs nothing — there is no earlier alert to
 * have pulled back from.
 */
export function hasPullbackSince(
  facts: TrendFacts,
  lastContinuationAt: string | null,
  origin: TrendOrigin | null
): boolean {
  if (lastContinuationAt === null) return true;
  return facts.adversePivots.some(
    (p) =>
      p.availableFrom !== null &&
      p.availableFrom > lastContinuationAt &&
      (origin === null || p.availableFrom >= origin.establishedAt)
  );
}

/**
 * Which single transition represents this bar.
 *
 * One alert per bar per symbol per direction. Real NVDA 2026-07-22
 * recorded a continuation AND a blue-sky break on the 12:15 bar — two
 * notifications for one event. History still keeps both; only the
 * emitted alert collapses to the most significant.
 */
const ALERT_SIGNIFICANCE: Record<TrendStage, number> = {
  failed: 6,
  level_break: 5,
  trend_confirmed: 4,
  trend_watch: 3,
  extended: 2,
  basing: 1,
  idle: 0,
};

/**
 * Stages that are recorded but never ALERTED.
 *
 * `extended` is a caution state — its own reason says "stretched, not a
 * signal" — so pinging on it tells the reader something they must not
 * act on. The stage, its ordinal position and every downstream
 * behaviour are unchanged; only the notification is suppressed.
 */
const NON_ALERTABLE_STAGES: readonly TrendStage[] = ["extended"];

export function isAlertable(stage: TrendStage): boolean {
  return !NON_ALERTABLE_STAGES.includes(stage);
}

/**
 * Stages EXEMPT from same-bar collapsing.
 *
 * TAP 1 is a distinct heads-up, deliberately separate from the entry it
 * precedes. Collapsing by significance alone silently ate it whenever a
 * bigger event landed on the same bar — real AAPL 2026-07-13 reported a
 * level break as its FIRST alert of the session and never announced TAP
 * 1 at all. An exemption is not a duplicate: it is a different message.
 */
const ALWAYS_ALERT_STAGES: readonly TrendStage[] = ["trend_watch"];

export function mostSignificant(transitions: TrendTransition[]): TrendTransition[] {
  if (transitions.length <= 1) return transitions;

  const exempt = transitions.filter((t) => ALWAYS_ALERT_STAGES.includes(t.stage));
  const rest = transitions.filter((t) => !ALWAYS_ALERT_STAGES.includes(t.stage));

  const collapsed =
    rest.length <= 1
      ? rest
      : [
          rest.reduce((best, t) =>
            ALERT_SIGNIFICANCE[t.stage] > ALERT_SIGNIFICANCE[best.stage] ? t : best
          ),
        ];

  const kept = new Set<TrendTransition>([...exempt, ...collapsed]);
  // Emit in the order they actually happened, so TAP 1 still reads as
  // the heads-up that preceded the entry rather than trailing it.
  return transitions.filter((t) => kept.has(t));
}

/**
 * The trailing structure stop: the highest CONFIRMED higher low since the
 * origin. Trails UP only — a lower low never loosens it, because a stop
 * that walks back down is not a stop.
 *
 * Causal by construction: `adversePivots` are already confirmed pivots
 * (`index + pivotLength`), each carrying the time it became knowable, and
 * anything not yet knowable at this bar is ignored.
 */
export function trailStructureStop(args: {
  facts: TrendFacts;
  origin: TrendOrigin | null;
  current: number | null;
  direction: TrendDirection;
  marketDataAt: string;
}): number | null {
  const { facts, origin, current, direction, marketDataAt } = args;
  if (origin === null) return null;
  const ops = opsFor(direction);

  let stop = current ?? origin.price;
  for (const pivot of facts.adversePivots) {
    if (!Number.isFinite(pivot.price)) continue;
    // Not knowable yet at this bar.
    if (pivot.availableFrom !== null && pivot.availableFrom > marketDataAt) continue;
    // Must be part of THIS setup, not the one before it.
    if (pivot.availableFrom !== null && pivot.availableFrom < origin.establishedAt) continue;
    if (ops.beyond(pivot.price, stop)) stop = pivot.price;
  }
  return stop;
}

export interface ContinuationTrigger {
  reason: string;
  /** The higher low that armed it — becomes the new structure stop. */
  higherLow: number;
  /** The swing high taken out. */
  reclaimedHigh: KeyLevel;
}

/**
 * CONTINUATION AFTER A PULLBACK.
 *
 * Requires BOTH halves of the owner's model, and both from confirmed
 * pivots only:
 *
 *  1. a NEW higher low, strictly better than the one that armed the last
 *     continuation (or the origin), by more than an epsilon AND more than
 *     a fraction of ATR; and
 *  2. a completed close back through the swing high that leg pulled back
 *     from, using the same break buffer as every other level.
 *
 * Requiring the take-out as WELL as the higher low is the anti-spam
 * guard. A base alone must never re-arm — a base alone re-arming is
 * exactly what produced the trend_watch -> failed storm, 14 times in one
 * real GOOGL session.
 */
export function detectContinuation(args: {
  facts: TrendFacts;
  lifecycle: TrendLifecycle;
  direction: TrendDirection;
  config: TrendScannerConfig;
  marketDataAt: string;
}): ContinuationTrigger | null {
  const { facts, lifecycle, direction, config, marketDataAt } = args;
  const ops = opsFor(direction);
  const origin = lifecycle.origin;
  if (origin === null || facts.price === null) return null;
  if (lifecycle.continuationCount >= config.maxContinuationsPerSession) return null;

  const reference = lifecycle.lastContinuationLow ?? origin.price;
  const minGain =
    facts.atr5m === null ? null : facts.atr5m * config.continuationHigherLowAtr;
  if (minGain === null) return null;

  // The best confirmed higher low that is knowable now and genuinely
  // beats the reference.
  let higherLow: KeyLevel | null = null;
  for (const pivot of facts.adversePivots) {
    if (!Number.isFinite(pivot.price)) continue;
    if (pivot.availableFrom === null || pivot.availableFrom > marketDataAt) continue;
    if (pivot.availableFrom < origin.establishedAt) continue;
    if (!ops.beyond(pivot.price, reference)) continue;
    if (Math.abs(pivot.price - reference) <= PRICE_EPSILON) continue;
    if (Math.abs(pivot.price - reference) < minGain) continue;
    if (higherLow === null || ops.beyond(pivot.price, higherLow.price)) higherLow = pivot;
  }
  if (higherLow === null) return null;

  // The swing high THAT leg pulled back from: the most recent confirmed
  // direction-side pivot knowable before the higher low confirmed.
  let reclaimed: KeyLevel | null = null;
  for (const level of facts.levels) {
    if (!level.name.toLowerCase().includes("pivot")) continue;
    if (!Number.isFinite(level.price)) continue;
    if (level.availableFrom === null || level.availableFrom > higherLow.availableFrom!) continue;
    if (reclaimed === null || level.availableFrom > reclaimed.availableFrom!) reclaimed = level;
  }
  if (reclaimed === null) return null;

  const buffer = Math.abs(reclaimed.price) * config.levelBreakBufferPct;
  const threshold =
    direction === "bullish" ? reclaimed.price + buffer : reclaimed.price - buffer;
  if (!ops.beyond(facts.price, threshold)) return null;

  return {
    higherLow: higherLow.price,
    reclaimedHigh: reclaimed,
    reason:
      `Continuation — ${ops.structureLabel} at ${higherLow.price.toFixed(2)} then a completed close ` +
      `back through ${reclaimed.price.toFixed(2)}`,
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
function watchBlockers(
  facts: TrendFacts,
  config: TrendScannerConfig,
  direction: TrendDirection
): TrendBlocker[] {
  const blockers: TrendBlocker[] = [];
  const ops = opsFor(direction);

  if (facts.oneMinuteEma9.above !== true) {
    blockers.push({
      requirement: `${ops.sideLabel} the 1m 9 EMA`,
      detail:
        facts.oneMinuteEma9.above === null
          ? "1-minute EMA not measurable"
          : "price is on the wrong side",
    });
  }
  if (facts.oneMinuteEma9.rising !== true) {
    blockers.push({
      requirement: `1m 9 EMA ${ops.slopeLabel}`,
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
    reason:
      `${ops.newExtremeLabel} continuation — closed beyond every level since ` +
      `the origin (${reference.toFixed(2)})`,
  };
}

/**
 * Failure conditions. Any one ends the setup on a completed candle.
 *
 * STRUCTURE ONLY. The old two-sided moving-average test — wrong side of
 * both the 1m 9 EMA and the 5m 20 SMA — is deliberately gone. It never
 * referenced the origin, so a trend that had already run 2.50% and
 * paused for one bar scored identically to a setup that never worked;
 * on real GOOGL 2026-08-04 it killed the trade at 11:30 and the machine
 * then watched price walk another 4.80 points without it.
 *
 * A pullback to the averages is now a HOLDING state. The setup dies only
 * when price closes below the trailing structure stop, or through the
 * origin's own invalidation.
 */
function failureReason(
  facts: TrendFacts,
  origin: TrendOrigin | null,
  direction: TrendDirection,
  structureStop: number | null
): string | null {
  if (origin === null || facts.price === null) return null;
  const ops = opsFor(direction);

  if (ops.adverse(facts.price, origin.invalidationPrice)) {
    return `Closed through the invalidation at ${origin.invalidationPrice.toFixed(2)}`;
  }
  if (structureStop !== null && ops.adverse(facts.price, structureStop)) {
    return (
      `Structure break — ${ops.structureBreachPhrase} the ${ops.structureLabel} ` +
      `at ${structureStop.toFixed(2)}`
    );
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
    // Trail the stop BEFORE testing it, so a higher low that confirmed on
    // this very bar protects the trade on this very bar.
    const trailed = trailStructureStop({
      facts,
      origin: lifecycle.origin,
      current: previous.structureStop,
      direction,
      marketDataAt,
    });
    if (trailed !== null) lifecycle = { ...lifecycle, structureStop: trailed };

    const reason = failureReason(facts, lifecycle.origin, direction, trailed);
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
        // The stop and the continuation arming belong to the dead setup.
        // `continuationCount` deliberately survives: the cap is per
        // session, so a failed leg cannot buy back its own budget.
        structureStop: null,
        lastContinuationLow: null,
        holding: false,
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
  // `basing` MUST be in this set.
  //
  // It is enterable from `failed` (basing outranks failed in the ordinal
  // order), so leaving it out made it a one-way trap: on GOOGL
  // 2026-08-04 the machine failed at 11:30, recorded `basing` at 11:35,
  // and from 11:40 to the close could never lock another origin — not
  // because no base formed, but because it had disqualified itself. It
  // sat there while price walked another 4.80 points.
  const mayStartNew =
    previous.stage === "idle" || previous.stage === "failed" || previous.stage === "basing";
  // After a failure the replacement must be a GENUINELY new origin —
  // established strictly after the failure. Re-locking the same base
  // immediately is what produced the oscillation.
  const isGenuinelyNew =
    lifecycle.failedAt === null ||
    (input.candidateOrigin !== null && input.candidateOrigin.establishedAt > lifecycle.failedAt);

  // CHOP GUARD. A failure must be followed by a quiet period before the
  // next leg, and a direction only gets so many legs in a day. Real IWM
  // 2026-07-22 failed and re-locked its way to eight exits without these.
  const cooldownElapsed =
    lifecycle.failedAt === null ||
    Date.parse(marketDataAt) - Date.parse(lifecycle.failedAt) >=
      config.newLegCooldownMinutes * 60_000;
  const legsRemaining = lifecycle.legCount < config.maxLegsPerSession;

  if (
    lifecycle.origin === null &&
    input.candidateOrigin !== null &&
    mayStartNew &&
    isGenuinelyNew &&
    cooldownElapsed &&
    legsRemaining
  ) {
    lifecycle = {
      ...lifecycle,
      origin: input.candidateOrigin,
      // A fresh setup identity, and a fresh milestone ledger with it.
      firedMilestones: [],
      // History from the previous setup does not carry into this one.
      transitions: [],
      // The structure stop starts AT the base and only ever trails up.
      structureStop: input.candidateOrigin.price,
      lastContinuationLow: null,
      holding: false,
      // A fresh leg gets a fresh pullback gate, and spends one from the
      // session's budget. `legCount` deliberately never resets.
      lastContinuationAt: null,
      legCount: lifecycle.legCount + 1,
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
      blockers: watchBlockers(facts, config, direction),
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

  const wBlockers = watchBlockers(facts, config, direction);
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

  // ---- continuation after a pullback ----
  //
  // Runs BEFORE TAP 2 and retires the reclaimed pivot into
  // `clearedLevels`, so the same take-out cannot be reported twice — once
  // as a continuation and again as an ordinary level break.
  if (actionable()) {
    const cont = detectContinuation({ facts, lifecycle, direction, config, marketDataAt });
    if (cont !== null) {
      const key = levelKey(cont.reclaimedHigh);
      if (!lifecycle.clearedLevels.includes(key)) {
        lifecycle = {
          ...lifecycle,
          clearedLevels: [...lifecycle.clearedLevels, key],
          lastContinuationLow: cont.higherLow,
          continuationCount: lifecycle.continuationCount + 1,
          structureStop: cont.higherLow,
          holding: false,
          lastContinuationAt: marketDataAt,
        };
        record("level_break", cont.reason);
      }
    }
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
    // A NAMED level take-out still alerts once each — that is the model's
    // entry signal. A BLUE-SKY new high must wait for a genuine pullback
    // since the last continuation, otherwise it pings on every
    // incremental high, which is noise rather than a new leg.
    const gated =
      trigger !== null &&
      trigger.level === null &&
      !hasPullbackSince(facts, lifecycle.lastContinuationAt, lifecycle.origin);

    if (trigger !== null && !gated) {
      // A blue-sky continuation has no level to retire, so it is keyed on
      // the bar instead — otherwise every later bar would re-fire it.
      const key =
        trigger.level === null ? `blue-sky@${marketDataAt}` : levelKey(trigger.level);
      if (!lifecycle.clearedLevels.includes(key)) {
        lifecycle = {
          ...lifecycle,
          clearedLevels: [...lifecycle.clearedLevels, key],
          // Only a blue-sky continuation re-arms the pullback gate; a
          // named level is a one-off take-out, not a running ladder.
          lastContinuationAt:
            trigger.level === null ? marketDataAt : lifecycle.lastContinuationAt,
        };
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

  // ---- holding: pulled back, but the structure stop still holds ----
  //
  // Recorded as a FACT about the live setup, not a stage. The stage keeps
  // whatever it earned; this simply says the trade is in a pullback and
  // waiting for continuation rather than in trouble.
  {
    const dirOps = opsFor(direction);
    let lastSwingHigh: KeyLevel | null = null;
    for (const level of facts.levels) {
      if (!level.name.toLowerCase().includes("pivot")) continue;
      if (level.availableFrom === null || level.availableFrom > marketDataAt) continue;
      if (lastSwingHigh === null || level.availableFrom > lastSwingHigh.availableFrom!) {
        lastSwingHigh = level;
      }
    }
    const pulledBack =
      lastSwingHigh !== null &&
      facts.price !== null &&
      !dirOps.beyond(facts.price, lastSwingHigh.price);
    lifecycle = { ...lifecycle, holding: actionable() && pulledBack };
  }

  const blockers = reached("trend_confirmed") ? [] : actionable() ? cBlockers : wBlockers;
  const nextConfirmation = reached("level_break")
    ? null
    : reached("trend_confirmed")
    ? `A completed close through the ${facts.nearestLevel?.name.toLowerCase() ?? "next level ahead"}`
    : actionable()
    ? "A measured move from the origin with participation"
    : "Trend Watch conditions on a completed candle";

  // ONE alert per bar. History (lifecycle.transitions) keeps everything;
  // only what the alert pipeline consumes is collapsed.
  return {
    lifecycle,
    newTransitions: mostSignificant(newTransitions.filter((t) => isAlertable(t.stage))),
    newMilestones,
    blockers,
    nextConfirmation,
  };
}
