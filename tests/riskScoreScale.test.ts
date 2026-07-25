import { describe, it, expect } from "vitest";
import {
  clampMinSetupScore,
  validateMinSetupScore,
  defaultRiskSettings,
  MIN_SETUP_SCORE_MIN,
  MIN_SETUP_SCORE_MAX,
} from "@/lib/risk/defaults";

describe("clampMinSetupScore (read path - never throws)", () => {
  it("clamps a legacy value from the old ~21-point scale down to the new max", () => {
    expect(clampMinSetupScore(14)).toBe(10);
    expect(clampMinSetupScore(21)).toBe(10);
  });

  it("clamps a legacy value from the old ~11-point scale that's still above 10", () => {
    expect(clampMinSetupScore(11)).toBe(10);
  });

  it("leaves a value already within 0-10 unchanged", () => {
    expect(clampMinSetupScore(6)).toBe(6);
    expect(clampMinSetupScore(3.5)).toBe(3.5);
  });

  it("passes through the boundary values 0 and 10 unchanged", () => {
    expect(clampMinSetupScore(0)).toBe(0);
    expect(clampMinSetupScore(10)).toBe(10);
  });

  it("clamps a negative value up to 0", () => {
    expect(clampMinSetupScore(-5)).toBe(0);
  });

  it("falls back to the default (never crashes or produces NaN) for invalid input", () => {
    expect(clampMinSetupScore(NaN)).toBe(defaultRiskSettings.minSetupScore);
    expect(clampMinSetupScore(Infinity)).toBe(defaultRiskSettings.minSetupScore);
    expect(clampMinSetupScore(-Infinity)).toBe(defaultRiskSettings.minSetupScore);
  });

  it("the fallback default is itself always within the valid range", () => {
    expect(defaultRiskSettings.minSetupScore).toBeGreaterThanOrEqual(MIN_SETUP_SCORE_MIN);
    expect(defaultRiskSettings.minSetupScore).toBeLessThanOrEqual(MIN_SETUP_SCORE_MAX);
  });
});

describe("validateMinSetupScore (write path - rejects malformed input)", () => {
  it("clamps a legacy or out-of-range value into 0-10", () => {
    expect(validateMinSetupScore(14)).toBe(10);
    expect(validateMinSetupScore(-3)).toBe(0);
  });

  it("passes through the boundary values 0 and 10 unchanged", () => {
    expect(validateMinSetupScore(0)).toBe(0);
    expect(validateMinSetupScore(10)).toBe(10);
  });

  it("throws rather than silently accepting NaN", () => {
    expect(() => validateMinSetupScore(NaN)).toThrow();
  });

  it("throws rather than silently accepting Infinity", () => {
    expect(() => validateMinSetupScore(Infinity)).toThrow();
    expect(() => validateMinSetupScore(-Infinity)).toThrow();
  });
});
