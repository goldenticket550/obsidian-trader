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

  // Regression test for a real bug found in production: alert messages
  // had no way to show that the underlying market data was from an
  // earlier session (e.g. a Saturday cron run using Friday's close),
  // which was mistaken for the data being wrong/stale.
  it("includes the market-data timestamp in the message when latestCandleTime is set", () => {
    const previous = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "fail" }],
    });
    const current = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
      latestCandleTime: "2026-07-17T20:05:00.000Z", // Friday close, while alert fires Saturday
    });
    const events = evaluateAlerts(previous, current, defaultAlertRules, NOW);
    const event = events.find((e) => e.type === "recovery_from_low");
    expect(event?.message).toContain("market data as of 2026-07-17T20:05:00.000Z");
  });

  it("omits the market-data suffix entirely when latestCandleTime is null", () => {
    const previous = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "fail" }],
    });
    const current = makeResult({
      conditions: [{ id: "recovery_from_low", label: "x", required: true, state: "pass" }],
      latestCandleTime: null,
    });
    const events = evaluateAlerts(previous, current, defaultAlertRules, NOW);
    const event = events.find((e) => e.type === "recovery_from_low");
    expect(event?.message).not.toContain("market data as of");
  });
});

describe("entered_developing — early-tier conviction alert", () => {
  const REQUIRED_3 = (states: ("pass" | "fail")[]): SetupCondition[] =>
    states.map((state, i) => ({
      id: `req_${i}`,
      label: `Required ${i}`,
      required: true,
      state,
    }));

  function atConviction(
    convictionLevel: SetupResult["convictionLevel"],
    overrides: Partial<SetupResult> = {}
  ): SetupResult {
    return makeResult({
      conditions: REQUIRED_3(["pass", "pass", "fail"]),
      convictionLevel,
      score: 4.5,
      ...overrides,
    });
  }

  it("fires on a genuine watch -> developing transition", () => {
    const events = evaluateAlerts(
      atConviction("watch"),
      atConviction("developing"),
      defaultAlertRules,
      NOW
    );
    expect(events.some((e) => e.type === "entered_developing")).toBe(true);
  });

  it("does NOT fire on watch -> confirmed, which skips developing entirely", () => {
    // The confirmed-tier alerts already cover this jump, and there is no
    // earlier heads-up worth giving for something that already confirmed.
    const events = evaluateAlerts(
      atConviction("watch"),
      atConviction("confirmed"),
      defaultAlertRules,
      NOW
    );
    expect(events.some((e) => e.type === "entered_developing")).toBe(false);
  });

  it("does NOT re-fire while a setup sits in developing across scans", () => {
    // Three consecutive scans all in "developing" — only a transition
    // counts, so nothing fires on any of them.
    for (const previousLevel of ["developing", "developing", "developing"] as const) {
      const events = evaluateAlerts(
        atConviction(previousLevel),
        atConviction("developing"),
        defaultAlertRules,
        NOW
      );
      expect(events.some((e) => e.type === "entered_developing")).toBe(false);
    }
  });

  it("does NOT fire on the very first-ever scan (no previous snapshot)", () => {
    const events = evaluateAlerts(null, atConviction("developing"), defaultAlertRules, NOW);
    expect(events).toEqual([]);
  });

  it("fires again on a genuine re-entry after dropping back to watch", () => {
    // Edge-triggered means re-entry IS a new event; the rule's 15-minute
    // cooldown (not the engine) is what suppresses rapid flapping.
    const events = evaluateAlerts(
      atConviction("watch"),
      atConviction("developing"),
      defaultAlertRules,
      NOW
    );
    expect(events.filter((e) => e.type === "entered_developing")).toHaveLength(1);
  });

  it("does not fire when conviction drops from confirmed back to watch", () => {
    const events = evaluateAlerts(
      atConviction("confirmed"),
      atConviction("watch"),
      defaultAlertRules,
      NOW
    );
    expect(events.some((e) => e.type === "entered_developing")).toBe(false);
  });

  it("message reports real computed values, not placeholders", () => {
    const previous = atConviction("watch");
    const current = atConviction("developing", {
      conditions: REQUIRED_3(["pass", "pass", "fail"]),
      score: 4.5,
      maxScore: 10,
      symbol: "MU",
      timeframe: "5m",
      latestCandleTime: "2026-07-30T16:55:00.000Z",
    });

    const event = evaluateAlerts(previous, current, defaultAlertRules, NOW).find(
      (e) => e.type === "entered_developing"
    );

    expect(event?.message).toBe(
      "MU (5m) setup entered developing conviction — 2/3 required conditions passing, " +
        "score 4.5/10.0 [market data as of 2026-07-30T16:55:00.000Z]"
    );
  });

  it("counts only REQUIRED conditions, ignoring optional ones", () => {
    const current = atConviction("developing", {
      conditions: [
        ...REQUIRED_3(["pass", "pass", "fail"]),
        { id: "opt_1", label: "Optional", required: false, state: "pass" },
        { id: "opt_2", label: "Optional", required: false, state: "pass" },
      ],
    });
    const event = evaluateAlerts(atConviction("watch"), current, defaultAlertRules, NOW).find(
      (e) => e.type === "entered_developing"
    );
    expect(event?.message).toContain("2/3 required conditions passing");
  });

  it("is registered and enabled by default with a real cooldown", () => {
    const rule = defaultAlertRules.find((r) => r.type === "entered_developing");
    expect(rule).toBeDefined();
    expect(rule?.enabled).toBe(true);
    expect(rule?.cooldownMs).toBe(15 * 60_000);
    // Deliberately longer than the confirmed tier, which is unchanged.
    expect(rule!.cooldownMs).toBeGreaterThan(5 * 60_000);
  });
});

describe("entered_developing does not disturb the existing alert types", () => {
  it("leaves every pre-existing rule's type, enabled flag and cooldown untouched", () => {
    // Locks the confirmed tier: if adding the early tier ever loosens or
    // retimes an existing rule, this fails.
    const existing = defaultAlertRules
      .filter((r) => r.type !== "entered_developing")
      .map((r) => `${r.id}|${r.type}|${r.enabled}|${r.cooldownMs}|${r.scoreThreshold ?? "-"}`);

    expect(existing).toEqual([
      "recovery_from_low|recovery_from_low|true|300000|-",
      "consecutive_bullish|consecutive_bullish|true|300000|-",
      "liquidity_sweep|liquidity_sweep|true|300000|-",
      "structure_shift|structure_shift|true|300000|-",
      "ema_reclaim|ema_reclaim|true|300000|-",
      "fair_value_gap_created|fair_value_gap_created|true|300000|-",
      "fair_value_gap_proximity|fair_value_gap_proximity|true|300000|-",
      "score_threshold|score_threshold|true|300000|7",
      "setup_invalidated|setup_invalidated|true|300000|-",
    ]);
  });

  it("a conviction change alone fires no confirmed-tier alert", () => {
    // watch -> developing with identical conditions and score: the early
    // alert fires, and nothing else does.
    const conditions: SetupCondition[] = [
      { id: "recovery_from_low", label: "x", required: true, state: "pass" },
    ];
    const previous = makeResult({ conditions, convictionLevel: "watch", score: 4 });
    const current = makeResult({ conditions, convictionLevel: "developing", score: 4 });

    const types = evaluateAlerts(previous, current, defaultAlertRules, NOW).map((e) => e.type);
    expect(types).toEqual(["entered_developing"]);
  });

  it("confirmed-tier alerts still fire exactly as before alongside the new one", () => {
    const previous = makeResult({
      conditions: [{ id: "structure_shift", label: "x", required: true, state: "fail" }],
      convictionLevel: "watch",
      score: 6,
    });
    const current = makeResult({
      conditions: [{ id: "structure_shift", label: "x", required: true, state: "pass" }],
      convictionLevel: "developing",
      score: 7,
    });

    const types = evaluateAlerts(previous, current, defaultAlertRules, NOW).map((e) => e.type);
    expect(types).toContain("structure_shift");
    expect(types).toContain("score_threshold");
    expect(types).toContain("entered_developing");
  });
});
