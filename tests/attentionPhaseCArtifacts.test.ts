import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_ATTENTION_EVENT_CONFIG } from "@/lib/attention/attentionEvents";

const frequency = JSON.parse(readFileSync("data/replay/reports/exit-alert-frequency.json", "utf8"));
const digest = JSON.parse(readFileSync("data/replay/reports/phase-c-alert-digest.json", "utf8"));
const digestMarkdown = readFileSync("data/replay/reports/phase-c-alert-digest.md", "utf8");
const spec = readFileSync("docs/attention-engine-spec.md", "utf8");

describe("published Phase C replay artifacts", () => {
  it("promotes the provisional exit choice after train and holdout alert verification", () => {
    expect(frequency.status).toBe("published_alert_verified");
    expect(frequency.provisionalAccepted).toBe(true);
    expect(frequency.finalPolicy.scenario).toEqual({ exitCore: 0.66, exitPersistence: 15 });
    expect(frequency.finalPolicy.splits[0].newInPlayAlertsPerSession).toMatchObject({ median: 3.5, p25: 1, p75: 7, iqr: 6 });
    expect(frequency.finalPolicy.splits[1].newInPlayAlertsPerSession).toMatchObject({ median: 3.5, p25: 1.75, p75: 5.75, iqr: 4 });
    for (const point of frequency.results) {
      for (const split of point.splits) {
        expect(split.newInPlayAlertsPerSession).toMatchObject({ count: expect.any(Number), median: expect.any(Number), iqr: expect.any(Number) });
      }
    }
  });

  it("publishes payload-verified events with both timestamps and the corrected distributions", () => {
    expect(digest.status).toBe("PHASE_C_TIERED_DELIVERY_VERIFIED");
    expect(digest.entryAlertName).toBe("NOW IN PLAY");
    expect(digest.directionTransition).toBe("unavailable_pending_phase_d");
    const counts = digest.sessions.map((session: any) => session.alerts.length).sort((a: number, b: number) => a - b);
    expect(counts).toEqual([0, 1, 16, 20, 57]);
    for (const event of digest.sessions.flatMap((session: any) => session.alerts)) {
      expect(event.payload).toMatchObject({
        episodeId: expect.any(String),
        attentionScore: expect.any(Number),
        core: expect.any(Number),
        rawCore: expect.any(Number),
        inPlayEnterThreshold: expect.any(Number),
        axes: { participation: expect.any(Object), displacement: expect.any(Object), idiosyncrasy: expect.any(Object) },
        dataQualityBadge: expect.any(String),
        feedModeBadge: "SIP",
        notice: "NOT AN ENTRY \u2014 open the chart.",
      });
      expect(event.payload).toHaveProperty("atrTravelledSinceEpisodeStart");
      expect(event.payload).toHaveProperty("contextBadges");
      expect(event.payload).toHaveProperty("freshnessDetail");
      expect(event.payload).toHaveProperty("nearestReference");
      expect(event.payload).toHaveProperty("extensionWarning");
      if (event.payload.freshness === "Extended") expect(event.payload.extensionWarning).toBe("EXTENDED \u2014 do not chase");
      else expect(event.payload.extensionWarning).toBeNull();
      expect(event).toMatchObject({ at: event.qualifiedAt, qualifiedAt: event.payload.at, emittedAt: expect.any(Number) });
      expect(event.emittedAt).toBeGreaterThanOrEqual(event.qualifiedAt);
    }
    expect(digest.statistics).toMatchObject({
      alertCountsByType: { NOW_IN_PLAY: 47, ACCELERATION: 4, KEY_LEVEL_EVENT: 43, FAILED_ACCELERATION: 0 },
      nowInPlayThresholdViolations: 0,
      nowInPlayFreshness: { Fresh: 0, Developing: 16, Mature: 7, Extended: 24, "n/a": 0 },
      qualifyingToEmissionGapMinutes: { min: 0, median: 0, max: 0 },
      earlyCloseComparison: {
        corpusSessions: 1,
        corpusSessionFraction: 0.025,
        emittedAlerts: 0,
        droppedCandidates: 53,
        droppedNowInPlayCandidates: 18,
        correctedNowInPlayCandidateShareBeforeQuarantine: 18 / 65,
        correctedAllAlertCandidateShareBeforeQuarantine: 53 / 147,
        treatment: "final_15_minutes_excluded_until_close_relative_baseline_is_versioned",
      },
    });
    expect(digest.delivery).toMatchObject({
      config: {
        maxAlertsPerWindow: 4,
        alertRateWindowMinutes: 15,
        maxSecondaryDigestsPerWindow: 1,
        materialAttentionOverridePoints: 10,
      },
      detectedEvents: 94,
      primaryDetectedEvents: 47,
      secondaryDetectedEvents: 47,
      deliveredEnvelopes: 39,
      directDeliveries: 24,
      digestDeliveries: 15,
      primaryDirectDeliveries: 24,
      primaryDigestDeliveries: 2,
      secondaryDigestDeliveries: 13,
      collapsedEvents: 70,
      primaryCollapsedEvents: 23,
      secondaryCollapsedEvents: 47,
      materialOverrides: 0,
    });
    expect(digest.deliveryReview).toEqual({
      primaryCapHeld: true,
      secondaryCapHeld: true,
      sessionsAbovePrimaryEight: [
        { tradingDate: "2025-10-10", primaryDirectDeliveries: 9 },
      ],
      capAdjusted: false,
    });
    expect(digest.delivery.perSession.map((row: any) => ({
      date: row.tradingDate,
      primaryDetected: row.primaryDetectedEvents,
      secondaryDetected: row.secondaryDetectedEvents,
      primaryDirect: row.primaryDirectDeliveries,
      primaryDigests: row.primaryDigestDeliveries,
      secondaryDigests: row.secondaryDigestDeliveries,
      delivered: row.deliveredEnvelopes,
      primaryCollapsed: row.primaryCollapsedEvents,
      secondaryCollapsed: row.secondaryCollapsedEvents,
      maxPrimary: row.maxPrimaryDeliveriesInAnyWindow,
      maxSecondary: row.maxSecondaryDigestsInAnyWindow,
    }))).toEqual([
      { date: "2025-10-01", primaryDetected: 8, secondaryDetected: 12, primaryDirect: 8, primaryDigests: 0, secondaryDigests: 4, delivered: 12, primaryCollapsed: 0, secondaryCollapsed: 12, maxPrimary: 3, maxSecondary: 1 },
      { date: "2025-10-10", primaryDetected: 32, secondaryDetected: 25, primaryDirect: 9, primaryDigests: 2, secondaryDigests: 5, delivered: 16, primaryCollapsed: 23, secondaryCollapsed: 25, maxPrimary: 4, maxSecondary: 1 },
      { date: "2025-11-04", primaryDetected: 6, secondaryDetected: 10, primaryDirect: 6, primaryDigests: 0, secondaryDigests: 4, delivered: 10, primaryCollapsed: 0, secondaryCollapsed: 10, maxPrimary: 2, maxSecondary: 1 },
      { date: "2025-11-28", primaryDetected: 0, secondaryDetected: 0, primaryDirect: 0, primaryDigests: 0, secondaryDigests: 0, delivered: 0, primaryCollapsed: 0, secondaryCollapsed: 0, maxPrimary: 0, maxSecondary: 0 },
      { date: "2026-02-13", primaryDetected: 1, secondaryDetected: 0, primaryDirect: 1, primaryDigests: 0, secondaryDigests: 0, delivered: 1, primaryCollapsed: 0, secondaryCollapsed: 0, maxPrimary: 1, maxSecondary: 0 },
    ]);
    expect(digest.freshnessDiagnostics).toMatchObject({
      activeDefinition: { published: "D1_EMA9_ONLY", extendedWhen: "distance_from_ema9_gte_1.5_atr" },
      atrTravelledSinceEpisodeStart: { median: 1.3794247571710134 },
      distanceFromEma9Atr: { median: 1.5857480884085353 },
      distanceFromVwapAtr: { median: 2.941379701600772 },
      extensionReasonCounts: { ema9_distance_extended: 24 },
      factualBadgeCounts: { vwapDistanceAtLeast1_5Atr: 40, expansionRunAtLeast4: 41 },
      freshnessWithoutBackdating: { Fresh: 1, Developing: 19, Mature: 3, Extended: 24 },
      extendedOnlyBecauseOfBackdatedTravel: 0,
      activeExtendedButEmaNotExtended: 0,
    });
    expect(digest.gateDiagnostics.acceleration).toMatchObject({
      cumulative: {
        activeEpisode: 9751,
        inPlay: 1684,
        participationDelta: 453,
        displacementDelta: 115,
        idiosyncrasy: 95,
        persistence: 8,
        extension: 6,
        openingProtection: 6,
      },
      emitted: 4,
    });
    expect(digest.gateDiagnostics.keyLevel).toMatchObject({
      relevanceFloor: 84.11111111111111,
      fractionAllowedObservationsAtOrAboveFloor: 3362 / 33516,
      funnel: {
        eligibleSymbolMinutes: 1684,
        withRelevantLevel: 1063,
        semanticTransition: 89,
        novelIdentity: 64,
        allowedLevelObservations: 33516,
        relevantLevelObservations: 3362,
      },
      emitted: 43,
    });
    expect(digest.feb13Confirmation).toMatchObject({
      symbol: "AAPL",
      timeEt: "08:53",
      subWindow: "premarket_core",
      regularSession: false,
    });    expect(digestMarkdown).toContain("OPTIMISTICALLY BIASED");
    expect(digestMarkdown).toContain("not a performance, hit-rate");
  });

  it("keeps optional failure alerts off and records permanent WAKING retirement plus I6/I7", () => {
    expect(DEFAULT_ATTENTION_EVENT_CONFIG).toMatchObject({
      alertEmissionEnabled: false,
      emitFailedAcceleration: false,
      keyLevelMinimumRelevance: 84.11111111111111,
      pendingAlertMaxAgeMinutes: 10,
      earlyCloseClosingAuctionExclusionMinutes: 15,
    });
    expect(spec).toContain("WAKING UP retirement (normative)");
    expect(spec).toContain("0.09% train / 0.09% holdout");
    expect(spec).toContain("0.23% / 0.28%");
    expect(spec).toContain("202-minute holdout lead");
    expect(spec).toContain("WAKING UP is permanently retired");
    expect(spec).toContain("I6 ALERT-PAYLOAD CONSISTENCY");
    expect(spec).toContain("I7 ALERT PAYLOAD SNAPSHOT");
    expect(spec).toContain("EXTENDED \u2014 do not chase");
    expect(spec).toContain("pendingAlertMaxAgeMinutes");
    expect(spec).toContain("early_close_baseline_unavailable");
    expect(spec).toContain("Post-storage tiered delivery");
    expect(spec).toContain("Published empirical gate resolution (normative)");
    expect(spec).toContain("withdrawn and cancelled");
  });
});