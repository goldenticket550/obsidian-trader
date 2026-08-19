import { describe, it, expect } from "vitest";
import { AlertStore } from "@/lib/alerts/alertStore";
import { defaultAlertRules } from "@/lib/alerts/defaultRules";
import type { SetupResult, SetupCondition } from "@/types/setup";

function makeResult(overrides: Partial<SetupResult> & { conditions: SetupCondition[] }): SetupResult {
  return {
    symbol: "NVDA",
    timeframe: "5m",
    quality: "simulated",
    stage: "none",
    status: "yellow",
    score: 0,
    maxScore: 10,
    lastUpdated: "2026-01-01T00:00:00Z",
    convictionLevel: "watch",
    entryStatus: "wait_for_pullback",
    invalidationNote: null,
    ...overrides,
  };
}

describe("AlertStore", () => {
  it("fires nothing on the very first result for a symbol", () => {
    const store = new AlertStore();
    const result = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
    });
    const fired = store.processResult(result, defaultAlertRules, "2026-01-01T00:00:00Z");
    expect(fired.length).toBe(0);
  });

  it("fires and stores an event on a real transition", () => {
    const store = new AlertStore();
    store.processResult(
      makeResult({
        conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "fail" }],
      }),
      defaultAlertRules,
      "2026-01-01T00:00:00Z"
    );
    const fired = store.processResult(
      makeResult({
        conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
      }),
      defaultAlertRules,
      "2026-01-01T00:00:10Z"
    );
    expect(fired.length).toBeGreaterThan(0);
    expect(store.getRecentEvents().length).toBe(fired.length);
  });

  it("does not fire the same alert twice within its cooldown across separate scans", () => {
    const store = new AlertStore();
    store.processResult(
      makeResult({
        conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "fail" }],
      }),
      defaultAlertRules,
      "2026-01-01T00:00:00Z"
    );
    store.processResult(
      makeResult({
        conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
      }),
      defaultAlertRules,
      "2026-01-01T00:00:10Z"
    );
    // Condition flips back to fail then pass again quickly - still within cooldown.
    store.processResult(
      makeResult({
        conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "fail" }],
      }),
      defaultAlertRules,
      "2026-01-01T00:00:20Z"
    );
    const fired = store.processResult(
      makeResult({
        conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
      }),
      defaultAlertRules,
      "2026-01-01T00:00:30Z"
    );
    expect(fired.some((e) => e.type === "recovery_from_low")).toBe(false);
  });

  it("clear() resets stored events and previous-result history", () => {
    const store = new AlertStore();
    store.processResult(
      makeResult({
        conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "fail" }],
      }),
      defaultAlertRules,
      "2026-01-01T00:00:00Z"
    );
    store.processResult(
      makeResult({
        conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
      }),
      defaultAlertRules,
      "2026-01-01T00:00:10Z"
    );
    store.clear();
    expect(store.getRecentEvents().length).toBe(0);
  });
});
