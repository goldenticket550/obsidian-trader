import { describe, it, expect } from "vitest";
import { defaultStrategyConfig, type StrategyConfig } from "@/lib/strategies/config";
import {
  normalizeReclaimContinuationConfig,
  normalizeStrategyConfig,
  validateReclaimContinuationConfig,
  assertValidReclaimContinuationConfig,
  isValidReclaimContinuationConfig,
  CLOSE_LOCATION_MIRROR_TOLERANCE,
  type ReclaimContinuationConfig,
} from "@/lib/strategies/reclaimContinuationConfig";

/**
 * Configuration for Reclaim & Continuation.
 *
 * Two rules run through everything here: a MISSING value takes the
 * default, and a PRESENT INVALID value is an error rather than something
 * quietly replaced by the default.
 */

const DEFAULTS = defaultStrategyConfig.reclaimContinuation;

function valid(overrides: Partial<ReclaimContinuationConfig> = {}): ReclaimContinuationConfig {
  return { ...DEFAULTS, ...overrides };
}

/** The field names of every error, for concise assertions. */
function fields(config: Partial<ReclaimContinuationConfig>): string[] {
  return validateReclaimContinuationConfig(config).map((e) => e.field);
}

// ---------------------------------------------------------------------------
// The shipped defaults
// ---------------------------------------------------------------------------

describe("shipped defaults", () => {
  it("ships the documented evaluation-mode block", () => {
    expect(DEFAULTS).toEqual({
      enabled: true,
      alertingEnabled: false,
      resetLookbackBars: 20,
      newResetMaxAgeBars: 8,
      minResetAtr: 0.35,
      shallowResetMaxAtr: 0.6,
      standardResetMaxAtr: 1.0,
      minRecoveryAtr: 0.2,
      minRecoveryFraction: 0.25,
      minBullishCloseLocation: 0.55,
      maxBearishCloseLocation: 0.45,
      levelClusterAtr: 0.05,
      levelTestDistanceAtr: 0.25,
      breakBufferAtr: 0.05,
      retestWindowBars: 3,
      chaseGuardAtr: 0.75,
      volumeBaselineSessions: 20,
      minVolumeBaselineSessions: 10,
    });
  });

  it("ships enabled with alerting OFF — the safe first pass", () => {
    expect(DEFAULTS.enabled).toBe(true);
    expect(DEFAULTS.alertingEnabled).toBe(false);
  });

  it("validates its own defaults", () => {
    expect(validateReclaimContinuationConfig(DEFAULTS)).toEqual([]);
    expect(isValidReclaimContinuationConfig(DEFAULTS)).toBe(true);
  });

  it("names the bearish threshold for the direction of its comparison", () => {
    // Bearish exhaustion requires closeLocation <= this, so `max` is the
    // accurate name; `min` would invert the rule for a reader.
    expect(Object.keys(DEFAULTS)).toContain("maxBearishCloseLocation");
    expect(Object.keys(DEFAULTS)).not.toContain("minBearishCloseLocation");
  });
});

// ---------------------------------------------------------------------------
// Normalization (spec tests 59, 60)
// ---------------------------------------------------------------------------

describe("normalization", () => {
  it("gives a configuration saved before this feature every new default", () => {
    expect(normalizeReclaimContinuationConfig(undefined)).toEqual(DEFAULTS);
    expect(normalizeReclaimContinuationConfig(null)).toEqual(DEFAULTS);
  });

  it("fills only the missing keys of a partially saved block", () => {
    const partial = { enabled: false, minResetAtr: 0.5 };
    const normalized = normalizeReclaimContinuationConfig(partial);

    // Supplied values survive...
    expect(normalized.enabled).toBe(false);
    expect(normalized.minResetAtr).toBe(0.5);
    // ...and every key the user never mentioned arrives from the defaults.
    expect(normalized.retestWindowBars).toBe(DEFAULTS.retestWindowBars);
    expect(normalized.chaseGuardAtr).toBe(DEFAULTS.chaseGuardAtr);
    expect(Object.keys(normalized).sort()).toEqual(Object.keys(DEFAULTS).sort());
  });

  it("does not mutate defaultStrategyConfig", () => {
    const before = JSON.stringify(defaultStrategyConfig.reclaimContinuation);
    const normalized = normalizeReclaimContinuationConfig({ enabled: false });
    normalized.minResetAtr = 99;
    expect(JSON.stringify(defaultStrategyConfig.reclaimContinuation)).toBe(before);
    expect(defaultStrategyConfig.reclaimContinuation.minResetAtr).toBe(0.35);
  });

  it("leaves every unrelated strategy block untouched", () => {
    const merged: StrategyConfig = {
      ...defaultStrategyConfig,
      premarketExpansion: { ...defaultStrategyConfig.premarketExpansion, enabled: false },
      momentumLadder: { tiers: [1, 2, 3] },
    };
    const normalized = normalizeStrategyConfig(merged);

    expect(normalized.premarketExpansion).toEqual(merged.premarketExpansion);
    expect(normalized.momentumLadder).toEqual({ tiers: [1, 2, 3] });
    expect(normalized.intradayDecline).toEqual(defaultStrategyConfig.intradayDecline);
    expect(normalized.reclaimContinuation).toEqual(DEFAULTS);
  });

  it("normalizes a nested block the top-level shallow merge would leave short", () => {
    // Exactly what the repository's existing merge produces for a stored
    // config carrying only part of the Reclaim block.
    const shallowMerged = {
      ...defaultStrategyConfig,
      reclaimContinuation: { minResetAtr: 0.5 },
    } as unknown as StrategyConfig;

    expect(Object.keys(shallowMerged.reclaimContinuation)).toHaveLength(1);
    const normalized = normalizeStrategyConfig(shallowMerged);
    expect(normalized.reclaimContinuation.minResetAtr).toBe(0.5);
    expect(normalized.reclaimContinuation.alertingEnabled).toBe(false);
    expect(Object.keys(normalized.reclaimContinuation).sort()).toEqual(
      Object.keys(DEFAULTS).sort()
    );
  });
});

// ---------------------------------------------------------------------------
// Validation (spec tests 61, 63, 73)
// ---------------------------------------------------------------------------

describe("validation", () => {
  it("rejects a present invalid value rather than defaulting it", () => {
    // The distinction the whole design turns on: missing takes the
    // default, present-but-wrong is an error.
    const errors = validateReclaimContinuationConfig(valid({ minResetAtr: -1 }));
    expect(errors.map((e) => e.field)).toContain("reclaimContinuation.minResetAtr");
    // The relationships that depend on it are reported too, rather than
    // the first failure hiding the rest.
    expect(errors.map((e) => e.field)).toContain("reclaimContinuation.minRecoveryAtr");
    // ...and normalization does not paper over the bad value.
    expect(normalizeReclaimContinuationConfig({ minResetAtr: -1 }).minResetAtr).toBe(-1);
    expect(isValidReclaimContinuationConfig(valid({ minResetAtr: -1 }))).toBe(false);
  });

  it("returns ALL errors in one pass, not just the first", () => {
    const errors = validateReclaimContinuationConfig({
      ...DEFAULTS,
      enabled: "yes" as unknown as boolean,
      resetLookbackBars: 0,
      minResetAtr: 0,
      breakBufferAtr: 0,
      retestWindowBars: -3,
      volumeBaselineSessions: 1.5,
    });
    const named = errors.map((e) => e.field);
    expect(named).toContain("reclaimContinuation.enabled");
    expect(named).toContain("reclaimContinuation.resetLookbackBars");
    expect(named).toContain("reclaimContinuation.minResetAtr");
    expect(named).toContain("reclaimContinuation.breakBufferAtr");
    expect(named).toContain("reclaimContinuation.retestWindowBars");
    expect(named).toContain("reclaimContinuation.volumeBaselineSessions");
    expect(errors.length).toBeGreaterThanOrEqual(6);
    // Every error names a field and says something actionable.
    for (const e of errors) {
      expect(e.field.startsWith("reclaimContinuation.")).toBe(true);
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it("requires both rollout flags to be booleans", () => {
    expect(fields(valid({ enabled: 1 as unknown as boolean }))).toContain(
      "reclaimContinuation.enabled"
    );
    expect(fields(valid({ alertingEnabled: null as unknown as boolean }))).toContain(
      "reclaimContinuation.alertingEnabled"
    );
  });

  it("requires positive integers for every bar-count window", () => {
    for (const key of ["resetLookbackBars", "newResetMaxAgeBars", "retestWindowBars"] as const) {
      for (const bad of [0, -1, 2.5, Number.NaN, "3" as unknown as number]) {
        expect(fields(valid({ [key]: bad } as Partial<ReclaimContinuationConfig>))).toContain(
          `reclaimContinuation.${key}`
        );
      }
      expect(fields(valid({ [key]: 4 } as Partial<ReclaimContinuationConfig>))).not.toContain(
        `reclaimContinuation.${key}`
      );
    }
  });

  it("requires newResetMaxAgeBars <= resetLookbackBars", () => {
    expect(fields(valid({ newResetMaxAgeBars: 21, resetLookbackBars: 20 }))).toContain(
      "reclaimContinuation.newResetMaxAgeBars"
    );
    expect(fields(valid({ newResetMaxAgeBars: 20, resetLookbackBars: 20 }))).toEqual([]);
  });

  it("enforces the ascending reset-depth ladder", () => {
    expect(fields(valid({ minResetAtr: 0 }))).toContain("reclaimContinuation.minResetAtr");
    // shallow must exceed min
    expect(fields(valid({ shallowResetMaxAtr: 0.35 }))).toContain(
      "reclaimContinuation.shallowResetMaxAtr"
    );
    // standard must exceed shallow
    expect(fields(valid({ standardResetMaxAtr: 0.6 }))).toContain(
      "reclaimContinuation.standardResetMaxAtr"
    );
    expect(fields(valid({ minResetAtr: 0.2, shallowResetMaxAtr: 0.4, standardResetMaxAtr: 0.9 })))
      .toEqual([]);
  });

  it("keeps recovery inside its own bounds", () => {
    expect(fields(valid({ minRecoveryAtr: -0.1 }))).toContain(
      "reclaimContinuation.minRecoveryAtr"
    );
    // A recovery requirement deeper than the reset itself can never be met.
    expect(fields(valid({ minRecoveryAtr: 0.5, minResetAtr: 0.35 }))).toContain(
      "reclaimContinuation.minRecoveryAtr"
    );
    expect(fields(valid({ minRecoveryAtr: 0 }))).toEqual([]);
    for (const bad of [-0.01, 1.01, Number.POSITIVE_INFINITY]) {
      expect(fields(valid({ minRecoveryFraction: bad }))).toContain(
        "reclaimContinuation.minRecoveryFraction"
      );
    }
    expect(fields(valid({ minRecoveryFraction: 0 }))).toEqual([]);
    expect(fields(valid({ minRecoveryFraction: 1 }))).toEqual([]);
  });

  it("enforces maxBearishCloseLocation = 1 - minBullishCloseLocation (spec test 73)", () => {
    // The mirror is what stops one direction being easier than the other.
    expect(
      fields(valid({ minBullishCloseLocation: 0.55, maxBearishCloseLocation: 0.45 }))
    ).toEqual([]);
    expect(
      fields(valid({ minBullishCloseLocation: 0.6, maxBearishCloseLocation: 0.45 }))
    ).toContain("reclaimContinuation.maxBearishCloseLocation");
    // A mirrored pair at a different setting is fine.
    expect(
      fields(valid({ minBullishCloseLocation: 0.7, maxBearishCloseLocation: 0.3 }))
    ).toEqual([]);
  });

  it("tolerates IEEE-754 drift in the mirror rather than rejecting the defaults", () => {
    // 1 - 0.55 is 0.44999999999999996; an exact comparison would fail.
    const drifted = 1 - 0.55;
    expect(drifted).not.toBe(0.45);
    expect(
      fields(valid({ minBullishCloseLocation: 0.55, maxBearishCloseLocation: drifted }))
    ).toEqual([]);
    // ...but a genuine mismatch beyond tolerance is still caught.
    expect(
      fields(
        valid({
          minBullishCloseLocation: 0.55,
          maxBearishCloseLocation: 0.45 + CLOSE_LOCATION_MIRROR_TOLERANCE * 100,
        })
      )
    ).toContain("reclaimContinuation.maxBearishCloseLocation");
  });

  it("keeps close-location thresholds inside 0..1", () => {
    expect(fields(valid({ minBullishCloseLocation: 1.2, maxBearishCloseLocation: -0.2 })))
      .toEqual(
        expect.arrayContaining([
          "reclaimContinuation.minBullishCloseLocation",
          "reclaimContinuation.maxBearishCloseLocation",
        ])
      );
  });

  it("orders the level thresholds", () => {
    expect(fields(valid({ levelClusterAtr: -0.01 }))).toContain(
      "reclaimContinuation.levelClusterAtr"
    );
    expect(fields(valid({ levelClusterAtr: 0 }))).toEqual([]);
    // A test distance tighter than the cluster width is incoherent.
    expect(fields(valid({ levelTestDistanceAtr: 0.01, levelClusterAtr: 0.05 }))).toContain(
      "reclaimContinuation.levelTestDistanceAtr"
    );
    expect(fields(valid({ levelTestDistanceAtr: 0.05, levelClusterAtr: 0.05 }))).toEqual([]);
    expect(fields(valid({ breakBufferAtr: 0 }))).toContain("reclaimContinuation.breakBufferAtr");
    // The chase guard must sit beyond the break buffer or every accepted
    // break would be born extended.
    expect(fields(valid({ chaseGuardAtr: 0.05, breakBufferAtr: 0.05 }))).toContain(
      "reclaimContinuation.chaseGuardAtr"
    );
  });

  it("orders the volume baseline sessions", () => {
    expect(fields(valid({ minVolumeBaselineSessions: 21, volumeBaselineSessions: 20 }))).toContain(
      "reclaimContinuation.minVolumeBaselineSessions"
    );
    expect(fields(valid({ minVolumeBaselineSessions: 20, volumeBaselineSessions: 20 }))).toEqual(
      []
    );
  });

  it("reports a wholly missing block rather than throwing", () => {
    expect(validateReclaimContinuationConfig(undefined)).toHaveLength(1);
    expect(validateReclaimContinuationConfig(null)[0].message).toMatch(/missing/i);
  });
});

// ---------------------------------------------------------------------------
// The defensive detector-entry boundary (spec test 72)
// ---------------------------------------------------------------------------

describe("detector-entry assertion", () => {
  it("passes a valid config through silently", () => {
    expect(() => assertValidReclaimContinuationConfig(DEFAULTS)).not.toThrow();
  });

  it("throws with every problem named, so an invalid config cannot evaluate", () => {
    expect(() =>
      assertValidReclaimContinuationConfig(valid({ minResetAtr: 0, breakBufferAtr: -1 }))
    ).toThrow(/Invalid reclaimContinuation config/);

    try {
      assertValidReclaimContinuationConfig(valid({ minResetAtr: 0, breakBufferAtr: -1 }));
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("minResetAtr");
      expect(message).toContain("breakBufferAtr");
    }
  });
});
