import type { SessionType } from "@/lib/market-data/types";

/**
 * TREND SCANNER — configuration.
 *
 * Every threshold lives here so there is one place to tune and one place
 * to validate. NONE of these values has been validated against live
 * market data. They are UNVALIDATED STARTING PARAMETERS chosen to be
 * plausible, not probabilities, edges, or win rates. Treat early output
 * as data for tuning, not as signal.
 */

export interface TrendScannerConfig {
  enabled: boolean;
  /** Legacy FVG/Reclaim/score alerts. OFF by default at emission. */
  legacyAlertsEnabled: boolean;

  /** How many completed 1m bars the base search may look back over. */
  baseLookbackOneMinuteBars: number;
  /** Completed 1m bars a candidate low must survive before it locks. */
  baseHoldBars: number;
  /** Minimum pullback from a causal high, in ATR, for a valid base. */
  minimumPullbackAtr: number;
  /** Buffer beyond the origin, in ATR, before a close fails it. */
  originInvalidationAtr: number;

  /** Close-to-close transitions examined (needs this + 1 candles). */
  higherCloseTransitions: number;
  /** Favourable transitions required out of the above. */
  minimumHigherCloses: number;

  watchRelativeVolume: number;
  confirmedRelativeVolume: number;
  levelBreakRelativeVolume: number;

  trendConfirmedMinimumDollars: number;
  trendConfirmedMinimumAtr: number;

  /** Close must exceed the level by this fraction to count as a break. */
  levelBreakBufferPct: number;

  /**
   * CONTINUATION AFTER A PULLBACK.
   *
   * How much a new higher low must beat the previous one by, in ATR,
   * before it counts as genuine structure rather than noise. This is the
   * guard that stops the old trend_watch -> failed oscillation from
   * returning as a continuation storm. UNVALIDATED starting parameter.
   */
  continuationHigherLowAtr: number;
  /** Continuation confirms allowed per direction per session. */
  maxContinuationsPerSession: number;

  /**
   * CHOP GUARD. Minutes that must pass after a failure before a new
   * origin may lock, and how many legs a direction gets per session.
   *
   * Real IWM 2026-07-22 recorded EIGHT exits in one session: failure,
   * re-lock, failure, re-lock. These two values bound that churn without
   * touching the ride. UNVALIDATED starting parameters, chosen
   * conservatively rather than fitted to a target count.
   */
  newLegCooldownMinutes: number;
  maxLegsPerSession: number;
  /**
   * Opening-range window, in minutes from the regular open. Defines the
   * opening-range high/low used as the TAP 2 level on a gap day, when the
   * premarket level is no longer overhead.
   */
  openingRangeMinutes: number;
  /** ATR distance from the 5m 9 EMA that counts as extended. */
  extendedAtrFromFiveMinuteEma: number;

  oneMinuteFreshnessSeconds: number;
  fiveMinuteFreshnessSeconds: number;
  setupExpiryMinutes: number;

  /** Percent moves from the LOCKED origin that fire once per setup. */
  percentMilestones: number[];
  allowedSessions: SessionType[];
}

export const defaultTrendScannerConfig: TrendScannerConfig = {
  enabled: true,
  // Legacy alerting stays off unless explicitly turned on, including for
  // configs saved before this field existed.
  legacyAlertsEnabled: false,

  baseLookbackOneMinuteBars: 30,
  baseHoldBars: 3,
  minimumPullbackAtr: 0.5,
  originInvalidationAtr: 0.25,

  // Three transitions, which requires FOUR completed candles.
  higherCloseTransitions: 3,
  minimumHigherCloses: 2,

  watchRelativeVolume: 1.2,
  confirmedRelativeVolume: 1.5,
  levelBreakRelativeVolume: 1.5,

  trendConfirmedMinimumDollars: 0.15,
  trendConfirmedMinimumAtr: 0.75,

  levelBreakBufferPct: 0.0005,
  continuationHigherLowAtr: 0.1,
  maxContinuationsPerSession: 3,
  newLegCooldownMinutes: 15,
  maxLegsPerSession: 3,
  openingRangeMinutes: 15,
  extendedAtrFromFiveMinuteEma: 2.0,

  oneMinuteFreshnessSeconds: 180,
  fiveMinuteFreshnessSeconds: 600,
  setupExpiryMinutes: 90,

  percentMilestones: [3, 5, 7, 10, 15],
  allowedSessions: ["regular"],
};

export interface TrendConfigError {
  field: string;
  message: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isPositive(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0;
}
function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v > 0;
}

/**
 * Fills ABSENT fields from the defaults. A present-but-invalid value is
 * returned unchanged so validation can see and reject it — normalization
 * never launders bad input into a plausible number.
 */
export function normalizeTrendScannerConfig(
  value: Partial<TrendScannerConfig> | undefined | null
): TrendScannerConfig {
  if (value === undefined || value === null) {
    return { ...defaultTrendScannerConfig, percentMilestones: [...defaultTrendScannerConfig.percentMilestones], allowedSessions: [...defaultTrendScannerConfig.allowedSessions] };
  }
  return {
    ...defaultTrendScannerConfig,
    ...value,
    // Arrays are replaced wholesale when present, copied when absent.
    percentMilestones: value.percentMilestones ?? [...defaultTrendScannerConfig.percentMilestones],
    allowedSessions: value.allowedSessions ?? [...defaultTrendScannerConfig.allowedSessions],
  };
}

/** Returns EVERY problem, so the UI can show a complete list. */
export function validateTrendScannerConfig(
  config: Partial<TrendScannerConfig> | undefined | null
): TrendConfigError[] {
  const errors: TrendConfigError[] = [];
  const at = (field: string, message: string) => errors.push({ field, message });

  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    at("trendScanner", "must be an object");
    return errors;
  }
  const c = config as Partial<TrendScannerConfig>;

  if (typeof c.enabled !== "boolean") at("trendScanner.enabled", "must be a boolean");
  if (typeof c.legacyAlertsEnabled !== "boolean") {
    at("trendScanner.legacyAlertsEnabled", "must be a boolean");
  }

  const positiveIntegers: (keyof TrendScannerConfig)[] = [
    "baseLookbackOneMinuteBars",
    "baseHoldBars",
    "higherCloseTransitions",
    "minimumHigherCloses",
    "oneMinuteFreshnessSeconds",
    "fiveMinuteFreshnessSeconds",
    "setupExpiryMinutes",
    "openingRangeMinutes",
    "maxContinuationsPerSession",
    "newLegCooldownMinutes",
    "maxLegsPerSession",
  ];
  for (const key of positiveIntegers) {
    if (!isPositiveInteger(c[key])) at(`trendScanner.${key}`, "must be a positive integer");
  }

  const positiveNumbers: (keyof TrendScannerConfig)[] = [
    "minimumPullbackAtr",
    "originInvalidationAtr",
    "watchRelativeVolume",
    "confirmedRelativeVolume",
    "levelBreakRelativeVolume",
    "trendConfirmedMinimumDollars",
    "trendConfirmedMinimumAtr",
    "levelBreakBufferPct",
    "extendedAtrFromFiveMinuteEma",
    "continuationHigherLowAtr",
  ];
  for (const key of positiveNumbers) {
    if (!isPositive(c[key])) at(`trendScanner.${key}`, "must be a positive number");
  }

  if (
    isPositiveInteger(c.minimumHigherCloses) &&
    isPositiveInteger(c.higherCloseTransitions) &&
    c.minimumHigherCloses > c.higherCloseTransitions
  ) {
    at(
      "trendScanner.minimumHigherCloses",
      "cannot exceed higherCloseTransitions — it would be unreachable"
    );
  }

  if (!Array.isArray(c.percentMilestones)) {
    at("trendScanner.percentMilestones", "must be an array of positive numbers");
  } else {
    c.percentMilestones.forEach((m, i) => {
      if (!isPositive(m)) at(`trendScanner.percentMilestones[${i}]`, "must be a positive number");
    });
    const ascending = c.percentMilestones.every(
      (m, i) => i === 0 || (isFiniteNumber(m) && m > c.percentMilestones![i - 1])
    );
    if (!ascending) {
      at("trendScanner.percentMilestones", "must be strictly ascending");
    }
  }

  if (!Array.isArray(c.allowedSessions) || c.allowedSessions.length === 0) {
    at("trendScanner.allowedSessions", "must list at least one session");
  } else {
    const valid: SessionType[] = ["pre-market", "regular", "after-hours"];
    c.allowedSessions.forEach((s, i) => {
      if (!valid.includes(s)) {
        at(`trendScanner.allowedSessions[${i}]`, "must be pre-market, regular or after-hours");
      }
    });
  }

  return errors;
}

/** Defensive gate for direct detector entry. Fails loudly, never guesses. */
export function assertValidTrendScannerConfig(
  config: Partial<TrendScannerConfig> | undefined | null
): asserts config is TrendScannerConfig {
  const errors = validateTrendScannerConfig(config);
  if (errors.length > 0) {
    throw new Error(
      `Invalid trendScanner config: ${errors.map((e) => `${e.field} ${e.message}`).join("; ")}`
    );
  }
}
