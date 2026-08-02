import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  buildReclaimAlertCandidates,
  reclaimAlertMessage,
  reclaimRuleIdFor,
  RECLAIM_ALERT_RULE_PREFIX,
  RECLAIM_ALERT_COOLDOWN_MS,
} from "@/lib/alerts/reclaimAlerts";
import { AlertStore } from "@/lib/alerts/alertStore";
import { recordCandidatesPersistent } from "@/lib/alerts/persistentAlertStore";
import { bucketForAlertType } from "@/lib/alerts/triage";
import { defaultAlertRules } from "@/lib/alerts/defaultRules";
import { runReclaimForSymbol, type ReclaimSymbolResult } from "@/lib/scanner/reclaimRunner";
import { buildReclaimTimeframeSeries } from "@/lib/scanner/reclaimTimeframe";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { AlertEvent } from "@/lib/alerts/types";
import type { SetupResult } from "@/types/setup";
import type { Candle } from "@/types/candle";

/**
 * Reclaim ALERT EMISSION.
 *
 * This is the first Reclaim code that emits anything, so the tests are
 * weighted toward what must NOT fire: everything below the review tier,
 * everything a timeframe cap or a conflicting alignment already held
 * back, and anything that would fire twice for one setup.
 *
 * Results come from the REAL runner. Where a specific tier or alignment
 * is needed, it is patched onto a real result rather than hand-built, so
 * the surrounding fields stay internally consistent.
 */

const CONFIG = defaultStrategyConfig.reclaimContinuation;
const ALERTING_ON = { ...CONFIG, alertingEnabled: true };
const ALERTING_OFF = { ...CONFIG, alertingEnabled: false };
const ATR = 1.0;
const T0 = Math.floor(Date.parse("2026-07-13T13:30:00Z") / 1000);
const LEVEL = 101.0;
const NOW = "2026-07-13T14:00:00.000Z";

function bar(i: number, o: number, h: number, l: number, c: number, step = 300): Candle {
  return { time: T0 + i * step, open: o, high: h, low: l, close: c, volume: 5000 };
}

function fullSequence(step = 300): Candle[] {
  const b = LEVEL + CONFIG.breakBufferAtr * ATR;
  return [
    bar(0, 100.0, 100.2, 99.9, 100.1, step),
    bar(1, 100.1, 101.0, 100.0, 100.9, step),
    bar(2, 100.9, 101.0, 99.2, 99.3, step),
    bar(3, 99.3, 99.4, 99.0, 99.15, step),
    bar(4, 99.15, 99.95, 99.1, 99.9, step),
    bar(5, 99.9, 100.9, 99.85, 100.85, step),
    bar(6, 100.85, 101.0, 100.7, 100.95, step),
    bar(7, 100.95, b + 0.4, 100.9, b + 0.3, step),
    bar(8, b + 0.3, b + 0.6, b + 0.2, b + 0.5, step),
    bar(9, b + 0.5, b + 0.55, b + 0.1, b + 0.15, step),
    bar(10, b + 0.15, b + 0.7, b + 0.12, b + 0.65, step),
    bar(11, b + 0.65, b + 1.4, b + 0.6, b + 1.3, step),
  ];
}

function build(symbol: string, candles: Candle[] = fullSequence()): ReclaimSymbolResult {
  return runReclaimForSymbol(
    {
      symbol,
      sessionDate: "2026-07-13",
      fiveMinute: buildReclaimTimeframeSeries(candles),
      oneMinute: buildReclaimTimeframeSeries(fullSequence(60)),
      atr: ATR,
      priorDayLevel: { high: LEVEL, low: 98.5 },
      premarketLevel: null,
      openingRangeLevel: null,
      structureLevel: { high: 99.5, low: 99.5 },
      structureAvailableFromTime: T0,
      sweepEvidence: null,
      freshness: "real_time",
      volumePace: null,
      benchmarkRelativeMove: null,
    },
    CONFIG
  );
}

let reviewNow: ReclaimSymbolResult;

beforeAll(() => {
  reviewNow = build("EXPD");
});

/** Preconditions for the whole file — if these drift, nothing below means what it says. */
describe("fixture preconditions", () => {
  it("really does reach the review tier with an active machine", () => {
    expect(reviewNow.alertTier).toBe("review_now");
    expect(reviewNow.fiveMinute).not.toBeNull();
    expect(reviewNow.setupKey).not.toBeNull();
    expect(reviewNow.reviewBlockedByAlignment).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The flag
// ---------------------------------------------------------------------------

describe("alertingEnabled", () => {
  it("emits NOTHING when alerting is off, even at the review tier", () => {
    const { events, rules } = buildReclaimAlertCandidates(
      { EXPD: reviewNow },
      ALERTING_OFF,
      NOW
    );
    expect(events).toEqual([]);
    expect(rules).toEqual([]);
  });

  it("emits exactly one candidate when alerting is on", () => {
    const { events } = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, NOW);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("reclaim_review_now");
    expect(events[0].symbol).toBe("EXPD");
    expect(events[0].timeframe).toBe("5m");
    expect(events[0].firedAt).toBe(NOW);
  });

  it("ships with alerting on", () => {
    expect(defaultStrategyConfig.reclaimContinuation.alertingEnabled).toBe(true);
  });

  it("emits nothing when Reclaim did not run at all", () => {
    expect(buildReclaimAlertCandidates(undefined, ALERTING_ON, NOW).events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// What must never fire
// ---------------------------------------------------------------------------

describe("tiers below review", () => {
  it("does not emit on early, monitor or none", () => {
    for (const alertTier of ["none", "early", "monitor"] as const) {
      const entry = { ...reviewNow, alertTier };
      expect(buildReclaimAlertCandidates({ EXPD: entry }, ALERTING_ON, NOW).events).toEqual([]);
    }
  });

  it("does not emit when a conflicting alignment blocked review", () => {
    // The runner already downgrades alertTier in this case; this asserts
    // the emission path never second-guesses that and re-promotes it.
    const blocked = {
      ...reviewNow,
      alignment: "conflicting" as const,
      reviewBlockedByAlignment: true,
      alertTier: "monitor" as const,
    };
    expect(buildReclaimAlertCandidates({ EXPD: blocked }, ALERTING_ON, NOW).events).toEqual([]);
  });

  it("does not emit on a one-minute-only read held back by the timeframe cap", () => {
    const capped = {
      ...reviewNow,
      cappedByTimeframe: true,
      oneMinuteUncappedTier: "review_now" as const,
      fiveMinuteTier: "early" as const,
      alertTier: "monitor" as const,
    };
    expect(buildReclaimAlertCandidates({ EXPD: capped }, ALERTING_ON, NOW).events).toEqual([]);
  });

  it("does not emit for an invalidated or historical setup", () => {
    // No active machine: `historical` is deliberately never consulted.
    const historical = {
      ...reviewNow,
      fiveMinute: null,
      historical: reviewNow.fiveMinute,
      stage: "invalidated" as const,
    };
    expect(buildReclaimAlertCandidates({ EXPD: historical }, ALERTING_ON, NOW).events).toEqual([]);
  });

  it("does not emit without a stable setup key to dedupe on", () => {
    const keyless = { ...reviewNow, setupKey: null };
    expect(buildReclaimAlertCandidates({ EXPD: keyless }, ALERTING_ON, NOW).events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

describe("alert copy", () => {
  it("states symbol, direction, stage, the level and the criteria met", () => {
    const message = reclaimAlertMessage(reviewNow);
    expect(message).toContain("EXPD");
    expect(message).toContain("5m");
    expect(message).toContain("Reclaim & Continuation");
    expect(message).toContain(reviewNow.direction!);
    expect(message).toMatch(/review criteria met/i);
    // A real level, from the machine.
    expect(message).toMatch(/\d+\.\d{2}/);
  });

  it("uses no directive, target, or probability language", () => {
    const message = reclaimAlertMessage(reviewNow);
    expect(message).not.toMatch(/\b(buy|sell|long|short|enter|exit|take|add)\b/i);
    expect(message).not.toMatch(/\b(target|stop[- ]loss|profit|risk[/ ]reward)\b/i);
    expect(message).not.toMatch(/\b(probability|confidence|likely|chance|expect|should|will)\b/i);
    expect(message).not.toMatch(/%/);
  });

  it("names no level rather than inventing one when the machine has none", () => {
    const levelless = {
      ...reviewNow,
      fiveMinute: {
        ...reviewNow.fiveMinute!,
        acceptedLevelPrice: null,
        acceptedLevelName: null,
        nextLevelPrice: null,
        nextLevelName: null,
      },
    };
    const message = reclaimAlertMessage(levelless);
    expect(message).toContain("no tracked level in play");
    expect(message).not.toMatch(/\b0\.00\b/);
  });

  it("is triaged as review, not buried in informational", () => {
    expect(bucketForAlertType("reclaim_review_now")).toBe("risk_review");
  });
});

// ---------------------------------------------------------------------------
// Dedup, through the REAL cooldown mechanisms
// ---------------------------------------------------------------------------

describe("dedup", () => {
  it("keys the rule id on the setup key", () => {
    const { events, rules } = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, NOW);
    expect(events[0].ruleId).toBe(reclaimRuleIdFor(reviewNow.setupKey!));
    expect(events[0].ruleId).toContain(RECLAIM_ALERT_RULE_PREFIX);
    expect(events[0].ruleId).toContain(reviewNow.setupKey!);
    expect(rules[0].cooldownMs).toBe(RECLAIM_ALERT_COOLDOWN_MS);
  });

  it("alerts once per setup across consecutive scans (in-memory store)", () => {
    const store = new AlertStore();
    const fire = (now: string) => {
      const { events, rules } = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, now);
      return store.processCandidates(events, rules, now);
    };

    expect(fire("2026-07-13T14:00:00.000Z")).toHaveLength(1);
    expect(fire("2026-07-13T14:00:30.000Z")).toHaveLength(0);
    expect(fire("2026-07-13T14:01:00.000Z")).toHaveLength(0);
    // One event in the shared feed, not three.
    expect(store.getRecentEvents().filter((e) => e.type === "reclaim_review_now")).toHaveLength(1);
  });

  it("alerts separately for a genuinely different setup", () => {
    const store = new AlertStore();
    const other = { ...reviewNow, symbol: "CALM", setupKey: "CALM:2026-07-13:bullish:1:2" };
    const fire = (entry: ReclaimSymbolResult, now: string) => {
      const { events, rules } = buildReclaimAlertCandidates({ X: entry }, ALERTING_ON, now);
      return store.processCandidates(events, rules, now);
    };
    expect(fire(reviewNow, NOW)).toHaveLength(1);
    expect(fire(other, NOW)).toHaveLength(1);
  });

  it("dedupes through the persistent store's own cooldown query", async () => {
    const inserted: Record<string, unknown>[] = [];
    let cooldownHit = false;
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  gte: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: cooldownHit ? { id: "existing" } : null,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: null };
        },
      }),
    } as never;

    const { events, rules } = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, NOW);

    const first = await recordCandidatesPersistent(supabase, "user-1", events, rules);
    expect(first).toHaveLength(1);
    expect(inserted).toHaveLength(1);
    // Recorded through the same table and columns the reversal path uses.
    expect(inserted[0].alert_type).toBe("reclaim_review_now");
    expect(inserted[0].rule_id).toBe(reclaimRuleIdFor(reviewNow.setupKey!));
    expect(inserted[0].timeframe).toBe("5m");

    // Second scan: the cooldown row now exists, so nothing new is written.
    cooldownHit = true;
    const second = await recordCandidatesPersistent(supabase, "user-1", events, rules);
    expect(second).toHaveLength(0);
    expect(inserted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Regression: the reversal path
// ---------------------------------------------------------------------------

describe("reversal alerts are unaffected", () => {
  /** Two snapshots that produce a real reversal alert edge. */
  function reversalPair(): { previous: SetupResult; current: SetupResult } {
    const base: SetupResult = {
      symbol: "NVDA",
      timeframe: "5m",
      quality: "simulated",
      stage: "none",
      status: "red",
      score: 0,
      maxScore: 10,
      conditions: [
        { id: "recovery_from_low", label: "Recovery", required: true, category: "core", state: "fail", detail: "" },
      ],
      lastUpdated: NOW,
      latestCandleTime: null,
      convictionLevel: "watch",
      entryStatus: "wait_for_pullback",
      invalidationNote: null,
    };
    return {
      previous: base,
      current: {
        ...base,
        conditions: [{ ...base.conditions[0], state: "pass" }],
      },
    };
  }

  let store: AlertStore;
  beforeEach(() => {
    store = new AlertStore();
  });

  it("fires the same reversal alerts whether or not Reclaim alerting is on", () => {
    const { previous, current } = reversalPair();

    const withoutReclaim = new AlertStore();
    withoutReclaim.processResult(previous, defaultAlertRules, NOW);
    const baseline = withoutReclaim.processResult(current, defaultAlertRules, NOW);

    // Same sequence, but with Reclaim emission interleaved.
    store.processResult(previous, defaultAlertRules, NOW);
    const { events, rules } = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, NOW);
    store.processCandidates(events, rules, NOW);
    const withReclaim = store.processResult(current, defaultAlertRules, NOW);

    // Precondition: a reversal alert really did fire, so this is not
    // comparing two empty arrays.
    expect(baseline.length).toBeGreaterThan(0);
    expect(withReclaim.map((e) => [e.type, e.symbol, e.message])).toEqual(
      baseline.map((e) => [e.type, e.symbol, e.message])
    );
  });

  it("adds Reclaim events without displacing reversal events in the feed", () => {
    const { previous, current } = reversalPair();
    store.processResult(previous, defaultAlertRules, NOW);
    store.processResult(current, defaultAlertRules, NOW);
    const reversalCount = store.getRecentEvents().length;

    const { events, rules } = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, NOW);
    store.processCandidates(events, rules, NOW);

    const feed = store.getRecentEvents();
    expect(feed.filter((e) => e.type === "reclaim_review_now")).toHaveLength(1);
    expect(feed.filter((e) => e.type !== "reclaim_review_now")).toHaveLength(reversalCount);
  });

  it("never emits a reversal alert type from the Reclaim path", () => {
    const { events } = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, NOW);
    const reversalTypes = new Set(defaultAlertRules.map((r) => r.type));
    for (const event of events) {
      expect(reversalTypes.has(event.type)).toBe(false);
    }
  });

  it("uses rule ids that cannot collide with a reversal rule", () => {
    const { events } = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, NOW);
    const reversalRuleIds = new Set(defaultAlertRules.map((r) => r.id));
    for (const event of events) {
      expect(reversalRuleIds.has(event.ruleId)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe("purity", () => {
  it("does not mutate the runner result it reads", () => {
    const entry = build("EXPD");
    const frozen = Object.freeze({ ...entry });
    expect(() =>
      buildReclaimAlertCandidates({ EXPD: frozen as ReclaimSymbolResult }, ALERTING_ON, NOW)
    ).not.toThrow();
    expect(frozen.alertTier).toBe(entry.alertTier);
  });

  it("produces identical events for identical input, apart from the event id", () => {
    const strip = (e: AlertEvent) => ({ ...e, id: "" });
    const a = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, NOW).events.map(strip);
    const b = buildReclaimAlertCandidates({ EXPD: reviewNow }, ALERTING_ON, NOW).events.map(strip);
    expect(a).toEqual(b);
  });
});
