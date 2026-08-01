import type { Candle } from "@/types/candle";
import type { TimeOfDayBar } from "@/lib/market-data/historicalBaseline";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import { REGULAR_START_MINUTES } from "@/lib/market-data/session";
import {
  measureCloseLocation,
  measureDollarVolumeShock,
  measureTrueRangeShock,
  type DollarVolumeConfig,
  type ShockResult,
} from "./dollarVolume";
import type { ExpansionDirection, FreshnessStatus } from "./premarketExpansion";

/**
 * Expansion Monitor Phase 1, section 2 — early detection, kept strictly
 * separate from confirmed setup.
 *
 * Two timeframes, deliberately: completed 1-MINUTE bars drive this
 * heads-up, while every break / acceptance / hold / structure /
 * invalidation decision stays on completed 5-minute bars. An unfinished
 * candle is never used on either.
 *
 * This alert is a Monitor-priority heads-up and always carries
 * "EARLY HEADS-UP · UNCONFIRMED". It is not Review Now, and it is not a
 * confirmation of anything — by construction it fires before the 5m
 * series could possibly have accepted a break.
 */

export type EarlyExpansionAlertType = "early_acceleration";

export const EARLY_ALERT_LABEL = "EARLY HEADS-UP · UNCONFIRMED";
export const EARLY_ALERT_PRIORITY = "monitor" as const;

/** Levels that count as "significant" for an early acceleration. */
export type SignificantLevelName =
  | "frozen_premarket_high"
  | "premarket_reference_high"
  | "prior_day_high"
  | "opening_range_high"
  | "pending_breakout_level"
  | "frozen_premarket_low"
  | "premarket_reference_low"
  | "prior_day_low"
  | "opening_range_low";

export interface SignificantLevel {
  name: SignificantLevelName;
  price: number;
}

export interface LevelProximityConfig {
  /** Approaching when within the GREATER of this percent of the level... */
  significantLevelApproachPercent: number;
  /** ...or this fraction of daily ATR. Centralized rather than inlined. */
  significantLevelApproachAtrFraction: number;
}

export const defaultLevelProximityConfig: LevelProximityConfig = {
  significantLevelApproachPercent: 0.2,
  significantLevelApproachAtrFraction: 0.1,
};

/**
 * Which levels are eligible right now.
 *
 * Before 9:30 the premarket reference high is live and still moving; from
 * 9:30 it is FROZEN, because a level that keeps moving cannot be broken
 * in any meaningful sense — the same immutable-anchor discipline the
 * momentum ladder already follows.
 */
export function eligibleSignificantLevels(
  minuteOfDay: number,
  direction: ExpansionDirection,
  levels: {
    premarketReference: number | null;
    frozenPremarketExtreme: number | null;
    priorDay: number | null;
    openingRange: number | null;
    pendingBreakout: number | null;
  }
): SignificantLevel[] {
  const bullish = direction === "bullish";
  const afterOpen = minuteOfDay >= REGULAR_START_MINUTES;
  const result: SignificantLevel[] = [];

  const push = (name: SignificantLevelName, price: number | null) => {
    if (price !== null && Number.isFinite(price)) result.push({ name, price });
  };

  if (afterOpen) {
    push(bullish ? "frozen_premarket_high" : "frozen_premarket_low", levels.frozenPremarketExtreme);
  } else {
    push(
      bullish ? "premarket_reference_high" : "premarket_reference_low",
      levels.premarketReference
    );
  }
  push(bullish ? "prior_day_high" : "prior_day_low", levels.priorDay);
  if (afterOpen) push(bullish ? "opening_range_high" : "opening_range_low", levels.openingRange);
  push("pending_breakout_level", levels.pendingBreakout);

  return result;
}

export type LevelEngagement = "approaching" | "breaking" | "none";

export interface SignificantLevelResult {
  engagement: LevelEngagement;
  level: SignificantLevel | null;
  distance: number | null;
  tolerance: number | null;
}

/**
 * Is price approaching or breaking one of the significant levels?
 *
 * The nearest engaged level wins. Tolerance is the greater of a percent
 * of the level price and a fraction of daily ATR, so the test means the
 * same thing on a $20 stock and an $850 one.
 */
export function findEngagedLevel(
  price: number,
  levels: SignificantLevel[],
  dailyAtr: number | null,
  direction: ExpansionDirection,
  config: LevelProximityConfig
): SignificantLevelResult {
  let best: SignificantLevelResult = {
    engagement: "none",
    level: null,
    distance: null,
    tolerance: null,
  };

  for (const level of levels) {
    const percentTolerance = (config.significantLevelApproachPercent / 100) * Math.abs(level.price);
    const atrTolerance =
      dailyAtr !== null ? dailyAtr * config.significantLevelApproachAtrFraction : 0;
    const tolerance = Math.max(percentTolerance, atrTolerance);

    const signed = price - level.price;
    const beyond = direction === "bullish" ? signed > 0 : signed < 0;
    const distance = Math.abs(signed);

    const engagement: LevelEngagement = beyond
      ? "breaking"
      : distance <= tolerance
      ? "approaching"
      : "none";
    if (engagement === "none") continue;

    // A break outranks an approach; among equals, the nearest level wins.
    const better =
      best.level === null ||
      (engagement === "breaking" && best.engagement === "approaching") ||
      (engagement === best.engagement && distance < (best.distance ?? Infinity));

    if (better) best = { engagement, level, distance, tolerance };
  }

  return best;
}

// ---------------------------------------------------------------------------
// The early acceleration test
// ---------------------------------------------------------------------------

/** Every gate, reported individually so a near-miss is explainable. */
export interface EarlyAccelerationChecks {
  completedCandle: boolean;
  dollarVolumeShock: ShockResult;
  trueRangeShock: ShockResult;
  closeLocation: number | null;
  closeNearExtreme: boolean;
  level: SignificantLevelResult;
  freshnessPermits: boolean;
}

export interface EarlyAccelerationResult {
  type: EarlyExpansionAlertType;
  fired: boolean;
  direction: ExpansionDirection;
  symbol: string;
  /** Always present on a fired alert. Non-negotiable labelling. */
  label: typeof EARLY_ALERT_LABEL;
  priority: typeof EARLY_ALERT_PRIORITY;
  barTime: number | null;
  checks: EarlyAccelerationChecks;
  /** Human-readable reason the alert did not fire, or null when it did. */
  blockedBy: string | null;
}

export interface EarlyAccelerationInput {
  symbol: string;
  direction: ExpansionDirection;
  /**
   * Today's COMPLETED 1-minute bars. A still-forming bar must be excluded
   * by the caller — the evaluation bar is always the last element here.
   */
  completedOneMinuteBars: Candle[];
  /** Matching time-of-day bars from prior eligible sessions. */
  timeOfDayBaseline: TimeOfDayBar[];
  significantLevels: SignificantLevel[];
  dailyAtr: number | null;
  freshness: FreshnessStatus;
  freshnessPermitsAlerting: boolean;
}

/**
 * A bullish early acceleration requires ALL of: a completed 1-minute
 * candle, a dollar-volume shock, true-range expansion, a close near the
 * candle's high, price approaching or breaking a significant bullish
 * level, and freshness permitting an alert. Bearish mirrors every clause.
 *
 * All six are ANDed on purpose. Any single one of them fires many times a
 * morning on an ordinary symbol; the conjunction is what makes this worth
 * surfacing rather than noise.
 */
export function detectEarlyAcceleration(
  input: EarlyAccelerationInput,
  config: DollarVolumeConfig,
  levelConfig: LevelProximityConfig = defaultLevelProximityConfig
): EarlyAccelerationResult {
  const {
    symbol,
    direction,
    completedOneMinuteBars,
    timeOfDayBaseline,
    significantLevels,
    dailyAtr,
    freshnessPermitsAlerting,
  } = input;

  const evaluationBar =
    completedOneMinuteBars.length > 0
      ? completedOneMinuteBars[completedOneMinuteBars.length - 1]
      : null;
  const previousBar =
    completedOneMinuteBars.length > 1
      ? completedOneMinuteBars[completedOneMinuteBars.length - 2]
      : null;

  const dollarVolumeShock = measureDollarVolumeShock(evaluationBar, timeOfDayBaseline, config);
  const trueRangeShock = measureTrueRangeShock(
    evaluationBar,
    previousBar,
    timeOfDayBaseline,
    config
  );
  const { closeLocation, nearExtreme } = measureCloseLocation(evaluationBar, direction, config);
  const level = evaluationBar
    ? findEngagedLevel(evaluationBar.close, significantLevels, dailyAtr, direction, levelConfig)
    : { engagement: "none" as LevelEngagement, level: null, distance: null, tolerance: null };

  const checks: EarlyAccelerationChecks = {
    completedCandle: evaluationBar !== null,
    dollarVolumeShock,
    trueRangeShock,
    closeLocation,
    closeNearExtreme: nearExtreme,
    level,
    freshnessPermits: freshnessPermitsAlerting,
  };

  const blockedBy = firstBlocker(checks);

  return {
    type: "early_acceleration",
    fired: blockedBy === null,
    direction,
    symbol,
    label: EARLY_ALERT_LABEL,
    priority: EARLY_ALERT_PRIORITY,
    barTime: evaluationBar?.time ?? null,
    checks,
    blockedBy,
  };
}

function firstBlocker(checks: EarlyAccelerationChecks): string | null {
  if (!checks.completedCandle) return "No completed 1-minute candle";
  if (!checks.freshnessPermits) return "Freshness does not permit alerting";
  if (checks.dollarVolumeShock.status === "insufficient_data") {
    return "Dollar-volume baseline unavailable";
  }
  if (!checks.dollarVolumeShock.passed) return "No dollar-volume shock";
  if (checks.trueRangeShock.status === "insufficient_data") {
    return "True-range baseline unavailable";
  }
  if (!checks.trueRangeShock.passed) return "No true-range expansion";
  if (!checks.closeNearExtreme) return "Candle did not close near its extreme";
  if (checks.level.engagement === "none") return "Not near a significant level";
  return null;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export interface EarlyAlertKey {
  userId: string;
  symbol: string;
  direction: ExpansionDirection;
  /** US Eastern trading date — never a UTC calendar date. */
  tradingDate: string;
  /** The significant level (or zone) this attempt is against. */
  level: SignificantLevel;
}

export interface DeduplicationConfig {
  /**
   * How far apart two level prices must be, as a fraction of the level,
   * to count as a genuinely DIFFERENT structural attempt rather than the
   * same one re-tested. Without a zone, floating-point drift in a level
   * recomputed each scan would defeat deduplication entirely.
   */
  distinctLevelFraction: number;
  /** After this long, a fresh attempt at the same level may alert again. */
  resetPeriodSeconds: number;
}

export const defaultDeduplicationConfig: DeduplicationConfig = {
  distinctLevelFraction: 0.002,
  resetPeriodSeconds: 60 * 60,
};

/**
 * A level's identity for deduplication: what KIND of level it is, plus the
 * price zone it sits in.
 *
 * The zone, not the raw price, is what identity turns on. A level
 * recomputed every scan drifts in its last bits, and keying on the float
 * would make every scan a new level. Kind is carried for display and
 * reporting only — two differently-named levels at the same price (a
 * premarket high that coincides with the prior-day high) are structurally
 * ONE level, and alerting twice on it is exactly the duplicate this
 * exists to prevent.
 */
export interface StructuralLevelIdentity {
  kind: SignificantLevelName;
  zoneId: string;
}

/**
 * A stable, reproducible zone id derived from a tolerance-sized bucket of
 * the price — never the raw float, and never a rounded decimal string,
 * which would still split two prices a cent apart.
 *
 * Bucketing alone cannot promise that two prices inside the tolerance land
 * in the same bucket (they can straddle a boundary), so this is used for
 * REPORTING. Membership decisions inside the deduplicator are made against
 * a zone's anchor price, which has no boundary problem.
 */
export function structuralLevelIdentity(
  level: SignificantLevel,
  config: DeduplicationConfig = defaultDeduplicationConfig
): StructuralLevelIdentity {
  const price = Math.abs(level.price);
  const bucket =
    price > 0 && config.distinctLevelFraction > 0
      ? Math.round(Math.log(price) / Math.log(1 + config.distinctLevelFraction))
      : 0;
  return { kind: level.name, zoneId: `z${bucket}` };
}

/**
 * One attempt at one price zone, on one trading date.
 *
 * `anchorPrice` is the price the zone FIRST fired at and never moves.
 * Re-anchoring on each new observation would let a series of
 * within-tolerance drifts walk the zone across an arbitrary distance,
 * so a level that has genuinely moved on would still be treated as the
 * original one.
 */
interface ZoneAttempt {
  anchorPrice: number;
  zoneId: string;
  /** Every level name seen in this zone — a merged zone can have several. */
  kinds: SignificantLevelName[];
  firedAt: number;
  invalidated: boolean;
}

/** Optional signal context: when the current continuous qualifying run began. */
export interface EarlyAlertSignalState {
  /**
   * Epoch ms at which the signal last transitioned from non-qualifying to
   * qualifying. Supplied, the reset period alone can no longer re-alert an
   * unchanged signal; omitted, the reset period behaves as a plain cooldown.
   */
  qualifyingSince?: number | null;
}

/**
 * At most one early-acceleration alert per user + symbol + direction +
 * Eastern trading date + significant level ZONE.
 *
 * Two failure modes are prevented at once, and they pull in opposite
 * directions:
 *
 * 1. Re-firing while price grinds up through level after level. That is
 *    one continuous move, not several independent setups, so a
 *    structurally new level alerts only once the earlier attempt has
 *    invalidated or the reset period has elapsed.
 * 2. Permanently suppressing a legitimate later attempt. Each zone keeps
 *    its OWN record, so an attempt that simply faded rather than
 *    invalidating stops blocking new levels once the reset period passes.
 *
 * Cooldown expiry on its own is not new information: at the same zone, a
 * caller that supplies `qualifyingSince` must also show a fresh
 * non-qualifying → qualifying transition since the last alert.
 *
 * Process-local, matching the existing TtlCache's scope. A multi-instance
 * deployment would need shared storage, exactly as that cache documents.
 */
export class EarlyAlertDeduplicator {
  private attempts = new Map<string, ZoneAttempt[]>();

  constructor(private readonly config: DeduplicationConfig = defaultDeduplicationConfig) {}

  /** Key WITHOUT the level — the zone comparison is done against anchors. */
  private static baseKey(key: Omit<EarlyAlertKey, "level">): string {
    return `${key.userId}:${key.symbol}:${key.direction}:${key.tradingDate}`;
  }

  private isSameZone(a: number, b: number): boolean {
    const reference = Math.max(Math.abs(a), Math.abs(b));
    if (reference === 0) return true;
    return Math.abs(a - b) / reference < this.config.distinctLevelFraction;
  }

  private findZone(key: EarlyAlertKey): ZoneAttempt | undefined {
    return this.attempts
      .get(EarlyAlertDeduplicator.baseKey(key))
      ?.find((a) => this.isSameZone(a.anchorPrice, key.level.price));
  }

  private resetElapsed(attempt: ZoneAttempt, now: number): boolean {
    return (now - attempt.firedAt) / 1000 >= this.config.resetPeriodSeconds;
  }

  shouldFire(
    key: EarlyAlertKey,
    now: number = Date.now(),
    signal: EarlyAlertSignalState = {}
  ): boolean {
    const attempts = this.attempts.get(EarlyAlertDeduplicator.baseKey(key));
    if (!attempts || attempts.length === 0) return true;

    const zone = this.findZone(key);

    if (!zone) {
      // A structurally new level. Allowed once the most recent attempt has
      // invalidated, or once enough time has passed that this is no longer
      // the same continuous move — the second clause is what keeps a
      // faded-but-never-invalidated setup from suppressing the rest of the
      // session.
      const latest = attempts.reduce((a, b) => (b.firedAt >= a.firedAt ? b : a));
      return latest.invalidated || this.resetElapsed(latest, now);
    }

    // This exact zone has already alerted today.
    if (!this.resetElapsed(zone, now)) return false;

    // The reset period has passed. That alone is not a market event: if the
    // caller can tell us when the signal last re-qualified, require that it
    // did so after the previous alert.
    const { qualifyingSince } = signal;
    if (qualifyingSince === undefined || qualifyingSince === null) return true;
    return qualifyingSince > zone.firedAt;
  }

  record(key: EarlyAlertKey, now: number = Date.now()): void {
    const baseKey = EarlyAlertDeduplicator.baseKey(key);
    const attempts = this.attempts.get(baseKey) ?? [];
    const existing = attempts.find((a) => this.isSameZone(a.anchorPrice, key.level.price));

    if (existing) {
      // The anchor deliberately stays where it was; only the alert time and
      // the observed level names move.
      existing.firedAt = now;
      existing.invalidated = false;
      if (!existing.kinds.includes(key.level.name)) existing.kinds.push(key.level.name);
      return;
    }

    attempts.push({
      anchorPrice: key.level.price,
      zoneId: structuralLevelIdentity(key.level, this.config).zoneId,
      kinds: [key.level.name],
      firedAt: now,
      invalidated: false,
    });
    this.attempts.set(baseKey, attempts);
  }

  /** Marks the most recent attempt invalidated, permitting a new structural attempt. */
  markInvalidated(key: Omit<EarlyAlertKey, "level">): void {
    const attempts = this.attempts.get(EarlyAlertDeduplicator.baseKey(key));
    if (!attempts || attempts.length === 0) return;
    attempts.reduce((a, b) => (b.firedAt >= a.firedAt ? b : a)).invalidated = true;
  }

  /** Test/diagnostic visibility: the anchor price of every zone tracked for a key. */
  zoneAnchors(key: Omit<EarlyAlertKey, "level">): number[] {
    return (this.attempts.get(EarlyAlertDeduplicator.baseKey(key)) ?? []).map((a) => a.anchorPrice);
  }

  clear(): void {
    this.attempts.clear();
  }

  size(): number {
    return this.attempts.size;
  }
}

/** The Eastern trading date for a bar, used as part of the dedup key. */
export function tradingDateForBar(timeSeconds: number): string {
  return getEasternTimeParts(new Date(timeSeconds * 1000)).date;
}
