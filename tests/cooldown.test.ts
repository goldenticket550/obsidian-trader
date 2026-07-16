import { describe, it, expect } from "vitest";
import { AlertCooldownTracker, applyCooldowns } from "@/lib/alerts/cooldown";
import type { AlertEvent, AlertRule } from "@/lib/alerts/types";

function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: "evt_1",
    ruleId: "recovery_from_low",
    type: "recovery_from_low",
    symbol: "NVDA",
    timeframe: "5m",
    message: "test",
    firedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const rules: AlertRule[] = [
  {
    id: "recovery_from_low",
    type: "recovery_from_low",
    label: "x",
    enabled: true,
    cooldownMs: 60_000,
  },
];

describe("AlertCooldownTracker", () => {
  it("is not on cooldown before anything has fired", () => {
    const tracker = new AlertCooldownTracker();
    expect(tracker.isOnCooldown(makeEvent(), 60_000, 0)).toBe(false);
  });

  it("is on cooldown immediately after firing", () => {
    const tracker = new AlertCooldownTracker();
    tracker.recordFired(makeEvent(), 1000);
    expect(tracker.isOnCooldown(makeEvent(), 60_000, 1500)).toBe(true);
  });

  it("is no longer on cooldown once the window passes", () => {
    const tracker = new AlertCooldownTracker();
    tracker.recordFired(makeEvent(), 0);
    expect(tracker.isOnCooldown(makeEvent(), 60_000, 60_001)).toBe(false);
  });

  it("tracks cooldowns independently per symbol", () => {
    const tracker = new AlertCooldownTracker();
    tracker.recordFired(makeEvent({ symbol: "NVDA" }), 0);
    expect(tracker.isOnCooldown(makeEvent({ symbol: "TSLA" }), 60_000, 100)).toBe(false);
  });
});

describe("applyCooldowns", () => {
  it("lets a first-time event through and records it", () => {
    const tracker = new AlertCooldownTracker();
    const surviving = applyCooldowns([makeEvent()], rules, tracker, 0);
    expect(surviving.length).toBe(1);
  });

  it("suppresses a duplicate event within the cooldown window", () => {
    const tracker = new AlertCooldownTracker();
    applyCooldowns([makeEvent()], rules, tracker, 0);
    const surviving = applyCooldowns([makeEvent({ id: "evt_2" })], rules, tracker, 1000);
    expect(surviving.length).toBe(0);
  });

  it("allows the event again after the cooldown expires", () => {
    const tracker = new AlertCooldownTracker();
    applyCooldowns([makeEvent()], rules, tracker, 0);
    const surviving = applyCooldowns([makeEvent({ id: "evt_2" })], rules, tracker, 61_000);
    expect(surviving.length).toBe(1);
  });
});
