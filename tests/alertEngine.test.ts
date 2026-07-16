import { describe, it, expect } from "vitest";
import { evaluateAlerts } from "@/lib/alerts/alertEngine";
import { defaultAlertRules } from "@/lib/alerts/defaultRules";
import type { SetupResult, SetupCondition } from "@/types/setup";

function makeResult(overrides: Partial<SetupResult> & { conditions: SetupCondition[] }): SetupResult {
  return {
    symbol: "TEST",
    timeframe: "5m",
    quality: "simulated",
    stage: "none",
    status: "yellow",
    score: 0,
    maxScore: 10,
    lastUpdated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const NOW = "2026-01-01T00:05:00Z";

describe("evaluateAlerts", () => {
  it("fires nothing on the first scan (no previous result)", () => {
    const current = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
    });
    const events = evaluateAlerts(null, current, defaultAlertRules, NOW);
    expect(events).toEqual([]);
  });

  it("fires when a condition transitions from not-passing to passing", () => {
    const previous = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "fail" }],
    });
    const current = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
    });
    const events = evaluateAlerts(previous, current, defaultAlertRules, NOW);
    expect(events.some((e) => e.type === "recovery_from_low")).toBe(true);
  });

  it("does not fire again if the condition was already passing", () => {
    const previous = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
    });
    const current = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
    });
    const events = evaluateAlerts(previous, current, defaultAlertRules, NOW);
    expect(events.some((e) => e.type === "recovery_from_low")).toBe(false);
  });

  it("fires a score_threshold alert when score crosses the configured threshold", () => {
    const previous = makeResult({ score: 6, conditions: [] });
    const current = makeResult({ score: 7, conditions: [] });
    const events = evaluateAlerts(previous, current, defaultAlertRules, NOW);
    expect(events.some((e) => e.type === "score_threshold")).toBe(true);
  });

  it("does not fire score_threshold again once already above it", () => {
    const previous = makeResult({ score: 8, conditions: [] });
    const current = makeResult({ score: 9, conditions: [] });
    const events = evaluateAlerts(previous, current, defaultAlertRules, NOW);
    expect(events.some((e) => e.type === "score_threshold")).toBe(false);
  });

  it("fires setup_invalidated when a condition newly becomes invalidated", () => {
    const previous = makeResult({
      conditions: [{ id: "fair_value_gap", label: "FVG", required: true, state: "pass" }],
    });
    const current = makeResult({
      conditions: [{ id: "fair_value_gap", label: "FVG", required: true, state: "invalidated" }],
    });
    const events = evaluateAlerts(previous, current, defaultAlertRules, NOW);
    expect(events.some((e) => e.type === "setup_invalidated")).toBe(true);
  });

  it("does not fire setup_invalidated if it was already invalidated last scan", () => {
    const previous = makeResult({
      conditions: [{ id: "fair_value_gap", label: "FVG", required: true, state: "invalidated" }],
    });
    const current = makeResult({
      conditions: [{ id: "fair_value_gap", label: "FVG", required: true, state: "invalidated" }],
    });
    const events = evaluateAlerts(previous, current, defaultAlertRules, NOW);
    expect(events.some((e) => e.type === "setup_invalidated")).toBe(false);
  });

  it("skips disabled rules", () => {
    const disabledRules = defaultAlertRules.map((r) =>
      r.type === "recovery_from_low" ? { ...r, enabled: false } : r
    );
    const previous = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "fail" }],
    });
    const current = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
    });
    const events = evaluateAlerts(previous, current, disabledRules, NOW);
    expect(events.some((e) => e.type === "recovery_from_low")).toBe(false);
  });
});
