import { defaultStrategyConfig, type StrategyConfig } from "./config";

export type ReclaimContinuationConfig = StrategyConfig["reclaimContinuation"];

/**
 * Normalization and validation for the Reclaim & Continuation
 * configuration block.
 *
 * These are separated deliberately. NORMALIZATION answers "what did the
 * user not say", and fills those gaps from the defaults. VALIDATION
 * answers "is what the user did say usable", and never repairs it — a
 * present-but-invalid value is an error, not an invitation to substitute
 * a default. Silently defaulting a bad threshold is how a scanner ends up
 * running rules nobody chose.
 */

/**
 * The mirror invariant `maxBearishCloseLocation = 1 - minBullishCloseLocation`
 * is compared with a tolerance because both sides are user-supplied
 * decimals: 1 - 0.55 is 0.44999999999999996 in IEEE-754, and an exact
 * comparison would reject the documented defaults.
 */
export const CLOSE_LOCATION_MIRROR_TOLERANCE = 1e-9;

export interface ConfigFieldError {
  /** Dotted path, so an API response can point at the offending field. */
  field: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Fills missing Reclaim keys from the defaults.
 *
 * The repository shallow-merges stored configuration over defaults, which
 * is correct at the top level but leaves a PARTIALLY stored nested block
 * missing whichever keys it does not carry — a config saved before this
 * feature existed has no `reclaimContinuation` at all, and one saved
 * mid-rollout may have only some of it.
 *
 * Never mutates `defaultStrategyConfig`, and never writes back: reading a
 * stored configuration must not migrate it.
 */
export function normalizeReclaimContinuationConfig(
  stored: Partial<ReclaimContinuationConfig> | undefined | null
): ReclaimContinuationConfig {
  return { ...defaultStrategyConfig.reclaimContinuation, ...(stored ?? {}) };
}

/**
 * Applies nested normalization across the whole strategy config after the
 * existing top-level shallow merge has run.
 *
 * Only the Reclaim block is normalized here; every other block keeps
 * exactly the behaviour it had, so this cannot change unrelated saved
 * settings.
 */
export function normalizeStrategyConfig(merged: StrategyConfig): StrategyConfig {
  return {
    ...merged,
    reclaimContinuation: normalizeReclaimContinuationConfig(
      merged.reclaimContinuation as Partial<ReclaimContinuationConfig> | undefined
    ),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The single authoritative validator, used at all three boundaries: after
 * normalizing stored configuration, on the settings PUT, and as a
 * defensive assertion at detector entry.
 *
 * Returns EVERY error found in one pass. Failing on the first would make
 * a settings form a guessing game — the caller can only fix what it has
 * been told about.
 */
export function validateReclaimContinuationConfig(
  config: Partial<ReclaimContinuationConfig> | undefined | null
): ConfigFieldError[] {
  const errors: ConfigFieldError[] = [];
  // An empty field name refers to the block itself — "reclaimContinuation",
  // never "reclaimContinuation." with a dangling separator.
  const at = (field: string, message: string) =>
    errors.push({
      field: field === "" ? "reclaimContinuation" : `reclaimContinuation.${field}`,
      message,
    });

  if (config === undefined || config === null) {
    at("", "configuration block is missing");
    return errors;
  }
  if (typeof config !== "object" || Array.isArray(config)) {
    at("", "must be an object");
    return errors;
  }

  const c = config;

  // --- rollout flags -------------------------------------------------------
  if (typeof c.enabled !== "boolean") at("enabled", "must be a boolean");
  if (typeof c.alertingEnabled !== "boolean") at("alertingEnabled", "must be a boolean");

  // --- bar-count windows ---------------------------------------------------
  if (!isPositiveInteger(c.resetLookbackBars)) {
    at("resetLookbackBars", "must be a positive integer");
  }
  if (!isPositiveInteger(c.newResetMaxAgeBars)) {
    at("newResetMaxAgeBars", "must be a positive integer");
  }
  if (
    isPositiveInteger(c.newResetMaxAgeBars) &&
    isPositiveInteger(c.resetLookbackBars) &&
    c.newResetMaxAgeBars > c.resetLookbackBars
  ) {
    at(
      "newResetMaxAgeBars",
      `must be less than or equal to resetLookbackBars (${c.resetLookbackBars})`
    );
  }
  if (!isPositiveInteger(c.retestWindowBars)) {
    at("retestWindowBars", "must be a positive integer");
  }

  // --- reset depth ladder --------------------------------------------------
  if (!isFiniteNumber(c.minResetAtr) || c.minResetAtr <= 0) {
    at("minResetAtr", "must be a finite number greater than 0");
  }
  if (!isFiniteNumber(c.shallowResetMaxAtr)) {
    at("shallowResetMaxAtr", "must be a finite number");
  } else if (isFiniteNumber(c.minResetAtr) && c.shallowResetMaxAtr <= c.minResetAtr) {
    at("shallowResetMaxAtr", `must be greater than minResetAtr (${c.minResetAtr})`);
  }
  if (!isFiniteNumber(c.standardResetMaxAtr)) {
    at("standardResetMaxAtr", "must be a finite number");
  } else if (
    isFiniteNumber(c.shallowResetMaxAtr) &&
    c.standardResetMaxAtr <= c.shallowResetMaxAtr
  ) {
    at(
      "standardResetMaxAtr",
      `must be greater than shallowResetMaxAtr (${c.shallowResetMaxAtr})`
    );
  }

  // --- recovery ------------------------------------------------------------
  if (!isFiniteNumber(c.minRecoveryAtr) || c.minRecoveryAtr < 0) {
    at("minRecoveryAtr", "must be a finite number greater than or equal to 0");
  } else if (isFiniteNumber(c.minResetAtr) && c.minRecoveryAtr > c.minResetAtr) {
    at("minRecoveryAtr", `must be less than or equal to minResetAtr (${c.minResetAtr})`);
  }
  if (
    !isFiniteNumber(c.minRecoveryFraction) ||
    c.minRecoveryFraction < 0 ||
    c.minRecoveryFraction > 1
  ) {
    at("minRecoveryFraction", "must be a finite number between 0 and 1 inclusive");
  }

  // --- close location, and the bullish/bearish mirror ----------------------
  const bullishOk =
    isFiniteNumber(c.minBullishCloseLocation) &&
    c.minBullishCloseLocation >= 0 &&
    c.minBullishCloseLocation <= 1;
  const bearishOk =
    isFiniteNumber(c.maxBearishCloseLocation) &&
    c.maxBearishCloseLocation >= 0 &&
    c.maxBearishCloseLocation <= 1;

  if (!bullishOk) {
    at("minBullishCloseLocation", "must be a finite number between 0 and 1 inclusive");
  }
  if (!bearishOk) {
    at("maxBearishCloseLocation", "must be a finite number between 0 and 1 inclusive");
  }
  if (bullishOk && bearishOk) {
    const mirror = 1 - (c.minBullishCloseLocation as number);
    if (Math.abs((c.maxBearishCloseLocation as number) - mirror) > CLOSE_LOCATION_MIRROR_TOLERANCE) {
      at(
        "maxBearishCloseLocation",
        `must equal 1 - minBullishCloseLocation (${mirror}) so neither direction is easier than the other`
      );
    }
  }

  // --- levels --------------------------------------------------------------
  if (!isFiniteNumber(c.levelClusterAtr) || c.levelClusterAtr < 0) {
    at("levelClusterAtr", "must be a finite number greater than or equal to 0");
  }
  if (!isFiniteNumber(c.levelTestDistanceAtr)) {
    at("levelTestDistanceAtr", "must be a finite number");
  } else if (isFiniteNumber(c.levelClusterAtr) && c.levelTestDistanceAtr < c.levelClusterAtr) {
    at(
      "levelTestDistanceAtr",
      `must be greater than or equal to levelClusterAtr (${c.levelClusterAtr})`
    );
  }
  if (!isFiniteNumber(c.breakBufferAtr) || c.breakBufferAtr <= 0) {
    at("breakBufferAtr", "must be a finite number greater than 0");
  }
  if (!isFiniteNumber(c.chaseGuardAtr)) {
    at("chaseGuardAtr", "must be a finite number");
  } else if (isFiniteNumber(c.breakBufferAtr) && c.chaseGuardAtr <= c.breakBufferAtr) {
    at("chaseGuardAtr", `must be greater than breakBufferAtr (${c.breakBufferAtr})`);
  }

  // --- volume baseline -----------------------------------------------------
  if (!isPositiveInteger(c.volumeBaselineSessions)) {
    at("volumeBaselineSessions", "must be a positive integer");
  }
  if (!isPositiveInteger(c.minVolumeBaselineSessions)) {
    at("minVolumeBaselineSessions", "must be a positive integer");
  }
  if (
    isPositiveInteger(c.minVolumeBaselineSessions) &&
    isPositiveInteger(c.volumeBaselineSessions) &&
    c.minVolumeBaselineSessions > c.volumeBaselineSessions
  ) {
    at(
      "minVolumeBaselineSessions",
      `must be less than or equal to volumeBaselineSessions (${c.volumeBaselineSessions})`
    );
  }

  return errors;
}

/**
 * Is this request body something we can safely treat as a strategy config?
 *
 * `await request.json()` yields `unknown`, and JSON legitimately parses to
 * `null`, a string, a number, or an array — none of which are a config.
 * Casting straight to `StrategyConfig` would let any of them through and
 * fail much later, somewhere less obvious.
 */
export function isConfigObject(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

/**
 * Normalizes and validates a stored configuration at the READ boundary.
 *
 * Legacy configs missing the block get every default; a config carrying a
 * present-but-invalid value fails here, loudly, rather than travelling on
 * to the detector where it would produce plausible wrong stages.
 */
export function normalizeAndValidateStrategyConfig(merged: StrategyConfig): {
  config: StrategyConfig;
  errors: ConfigFieldError[];
} {
  const config = normalizeStrategyConfig(merged);
  return { config, errors: validateReclaimContinuationConfig(config.reclaimContinuation) };
}

/** True when the block is usable. Convenience over the error list. */
export function isValidReclaimContinuationConfig(
  config: Partial<ReclaimContinuationConfig> | undefined | null
): config is ReclaimContinuationConfig {
  return validateReclaimContinuationConfig(config).length === 0;
}

/**
 * Defensive assertion for direct detector entry — the third validation
 * boundary. Fails loudly rather than letting an invalid threshold produce
 * a plausible, wrong stage.
 */
export function assertValidReclaimContinuationConfig(
  config: Partial<ReclaimContinuationConfig> | undefined | null
): asserts config is ReclaimContinuationConfig {
  const errors = validateReclaimContinuationConfig(config);
  if (errors.length > 0) {
    throw new Error(
      `Invalid reclaimContinuation config: ${errors
        .map((e) => `${e.field} ${e.message}`)
        .join("; ")}`
    );
  }
}
