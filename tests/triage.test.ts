import { describe, it, expect } from "vitest";
import {
  bucketForAlertType,
  triageAlerts,
  dedupeAlerts,
  TRIAGE_ORDER,
} from "@/lib/alerts/triage";
import type { AlertEvent, AlertType } from "@/lib/alerts/types";

function makeEvent(type: AlertType, symbol: string, firedAt: string, id?: string): AlertEvent {
  return {
    id: id ?? `${symbol}-${type}-${firedAt}`,
    ruleId: `rule_${type}`,
    type,
    symbol,
    timeframe: "5m",
    message: `${symbol} ${type}`,
    firedAt,
  };
}

const ALL_TYPES: AlertType[] = [
  "recovery_from_low",
  "consecutive_bullish",
  "liquidity_sweep",
  "structure_shift",
  "ema_reclaim",
  "fair_value_gap_created",
  "fair_value_gap_proximity",
  "score_threshold",
  "setup_invalidated",
];

describe("bucketForAlertType", () => {
  it("puts setup_invalidated in the top bucket, never informational", () => {
    // An invalidation means a thesis you may already be acting on broke.
    expect(bucketForAlertType("setup_invalidated")).toBe("risk_review");
    expect(bucketForAlertType("setup_invalidated")).not.toBe("informational");
  });

  it("routes the act-on-it types to risk_review", () => {
    expect(bucketForAlertType("score_threshold")).toBe("risk_review");
    expect(bucketForAlertType("fair_value_gap_proximity")).toBe("risk_review");
    expect(bucketForAlertType("structure_shift")).toBe("risk_review");
  });

  it("routes the developing types to monitor", () => {
    expect(bucketForAlertType("fair_value_gap_created")).toBe("monitor");
    expect(bucketForAlertType("liquidity_sweep")).toBe("monitor");
    expect(bucketForAlertType("ema_reclaim")).toBe("monitor");
  });

  it("routes early-stage types to informational", () => {
    expect(bucketForAlertType("recovery_from_low")).toBe("informational");
    expect(bucketForAlertType("consecutive_bullish")).toBe("informational");
  });

  it("covers every alert type with a known bucket", () => {
    for (const t of ALL_TYPES) {
      expect(TRIAGE_ORDER).toContain(bucketForAlertType(t));
    }
  });
});

describe("dedupeAlerts", () => {
  it("removes repeats by stable event id", () => {
    // The dashboard merges freshly-fired events with persisted history;
    // the same event legitimately arrives from both sources.
    const a = makeEvent("score_threshold", "NVDA", "2026-07-27T14:00:00Z", "evt_1");
    const b = makeEvent("score_threshold", "NVDA", "2026-07-27T14:00:00Z", "evt_1");
    expect(dedupeAlerts([a, b])).toHaveLength(1);
  });

  it("keeps distinct events that merely look similar", () => {
    const a = makeEvent("score_threshold", "NVDA", "2026-07-27T14:00:00Z", "evt_1");
    const b = makeEvent("score_threshold", "NVDA", "2026-07-27T14:00:00Z", "evt_2");
    expect(dedupeAlerts([a, b])).toHaveLength(2);
  });

  it("preserves first-seen order and handles an empty list", () => {
    const a = makeEvent("ema_reclaim", "A", "2026-07-27T10:00:00Z", "1");
    const b = makeEvent("ema_reclaim", "B", "2026-07-27T11:00:00Z", "2");
    expect(dedupeAlerts([a, b]).map((e) => e.id)).toEqual(["1", "2"]);
    expect(dedupeAlerts([])).toEqual([]);
  });
});

describe("triageAlerts", () => {
  it("returns all three buckets in priority order, always", () => {
    expect(triageAlerts([]).map((g) => g.bucket)).toEqual([
      "risk_review",
      "monitor",
      "informational",
    ]);
  });

  it("provides calm empty copy instead of example alerts", () => {
    const groups = triageAlerts([]);
    for (const group of groups) {
      expect(group.events).toEqual([]);
      expect(group.emptyCopy.length).toBeGreaterThan(0);
    }
  });

  it("sorts newest first within a bucket", () => {
    const events = [
      makeEvent("score_threshold", "OLD", "2026-07-27T10:00:00Z"),
      makeEvent("structure_shift", "NEW", "2026-07-27T15:00:00Z"),
      makeEvent("fair_value_gap_proximity", "MID", "2026-07-27T12:00:00Z"),
    ];
    const group = triageAlerts(events).find((g) => g.bucket === "risk_review");
    expect(group?.events.map((e) => e.symbol)).toEqual(["NEW", "MID", "OLD"]);
  });

  it("deduplicates before grouping", () => {
    const dup = makeEvent("score_threshold", "NVDA", "2026-07-27T14:00:00Z", "same");
    const groups = triageAlerts([dup, { ...dup }]);
    const total = groups.reduce((sum, g) => sum + g.events.length, 0);
    expect(total).toBe(1);
  });

  it("routes every event somewhere — nothing is silently dropped", () => {
    const events = ALL_TYPES.map((t, i) =>
      makeEvent(t, "SYM", `2026-07-27T1${i}:00:00Z`, `id_${i}`)
    );
    const total = triageAlerts(events).reduce((sum, g) => sum + g.events.length, 0);
    expect(total).toBe(ALL_TYPES.length);
  });
});
