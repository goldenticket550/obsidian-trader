import { describe, expect, it } from "vitest";
import { evaluateAlerts } from "@/lib/alerts/alertEngine";
import { defaultAlertRules } from "@/lib/alerts/defaultRules";
import {
  CONFIRMED_SCORE_FLOOR,
  MISSING_CORE_SCORE_CAP,
  MISSING_REQUIRED_SCORE_CAP,
  scoreSetup,
} from "@/lib/strategies/scorer";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { flatSeries } from "@/lib/fixtures/candles";
import type { SetupResult } from "@/types/setup";

const scored = (count = 30) => scoreSetup({
  symbol: "NVDA",
  timeframe: "5m",
  sessionCandles: flatSeries(count, 100),
  dailyCandles: flatSeries(25, 100),
  prevClose: 101,
  config: defaultStrategyConfig,
  now: "2026-08-14T14:00:00Z",
  quality: "simulated",
});

describe("structured setup decision payload", () => {
  it("gives every evaluated condition numeric evidence and marks unavailable rows explicitly", () => {
    const result = scored();
    for (const condition of result.conditions) {
      if (condition.state === "unavailable") {
        expect(condition.unavailableReason).toBeTruthy();
        expect(condition.observedValue).toBeUndefined();
        expect(condition.thresholdValue).toBeUndefined();
        expect(condition.distanceToThreshold).toBeUndefined();
      } else {
        expect(Number.isFinite(condition.observedValue)).toBe(true);
        expect(Number.isFinite(condition.thresholdValue)).toBe(true);
        expect(Number.isFinite(condition.distanceToThreshold)).toBe(true);
        expect(condition.distanceUnit).toBeTruthy();
      }
    }
    expect(result.evidence?.conditions).toEqual(result.conditions);
  });

  it("publishes empty structured evidence instead of omitting it", () => {
    const result = scored(0);
    expect(result.evidence).toBeDefined();
    expect(result.evidence?.conditions).toEqual([]);
  });

  it("marks required-unavailable warm-up as a capped score", () => {
    const result = scored(1);
    expect(result.conditions.some((condition) => condition.required && condition.state === "unavailable")).toBe(true);
    expect(result.scoreCapReason).toBe("warming_up_required_unavailable");
    expect(result.scoreCap).toBe(MISSING_CORE_SCORE_CAP);
    expect(result.score).toBeLessThanOrEqual(MISSING_CORE_SCORE_CAP);
  });

  it("keeps score bands ordered against the configured alert threshold", () => {
    const alertThreshold = defaultAlertRules.find((rule) => rule.type === "score_threshold")?.scoreThreshold;
    expect(alertThreshold).toBeTypeOf("number");
    expect(MISSING_CORE_SCORE_CAP).toBeLessThan(MISSING_REQUIRED_SCORE_CAP);
    expect(MISSING_REQUIRED_SCORE_CAP).toBeLessThan(alertThreshold!);
    expect(alertThreshold!).toBeLessThanOrEqual(CONFIRMED_SCORE_FLOOR);
  });

  it("puts the takeability, invalidation, n-of-m, trigger, score, and evidence on a green alert", () => {
    const base = scored();
    const previous: SetupResult = { ...base, score: 6, status: "yellow", invalidationNote: null };
    const current: SetupResult = {
      ...base,
      score: 7,
      status: "green",
      convictionLevel: "confirmed",
      entryStatus: "actionable_now",
      invalidationNote: { level: 99.25, reason: "session_low_lost" },
    };
    const event = evaluateAlerts(previous, current, defaultAlertRules, "2026-08-14T14:01:00Z")
      .find((candidate) => candidate.type === "score_threshold");
    expect(event?.entryStatus).toBe("actionable_now");
    expect(event?.invalidationNote).toEqual({ level: 99.25, reason: "session_low_lost" });
    expect(event?.requiredPassing).toBeDefined();
    expect(event?.triggeringConditionId).toBe("score_threshold");
    expect(event?.score).toBe(7);
    expect(event?.conditions).toBe(current.conditions);
    expect(event?.evidence).toBe(current.evidence);
  });

  it("carries numeric evidence by construction and never needs to parse detail prose", () => {
    const base = scored();
    const condition = { ...base.conditions[0], id: "recovery_from_low", detail: "display prose without a number", observedValue: 1.25, thresholdValue: 1, distanceToThreshold: 0.25, distanceUnit: "ratio" as const };
    const previous: SetupResult = { ...base, conditions: [{ ...condition, state: "fail" }] };
    const current: SetupResult = { ...base, conditions: [{ ...condition, state: "pass" }] };
    const event = evaluateAlerts(previous, current, defaultAlertRules, "2026-08-14T14:01:00Z")
      .find((candidate) => candidate.type === "recovery_from_low");
    expect(event?.conditions?.[0]).toMatchObject({ observedValue: 1.25, thresholdValue: 1, distanceToThreshold: 0.25 });
  });
});
