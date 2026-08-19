import { describe, expect, it } from "vitest";
import {
  compactAttentionAlertDeliveries,
  DEFAULT_ALERT_DELIVERY_RATE_CONFIG,
} from "@/lib/attention/alertDelivery";
import { deliveriesQualifiedAtMinute, trimSessionEventsForDelivery } from "@/lib/attention-runtime/worker";
import { compactAttentionAlertDeliveriesIncremental, emptyIncrementalAlertDeliveryState, trimIncrementalAlertDeliveryState } from "@/lib/attention/incrementalAlertDelivery";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";

function event(index: number, score: number, type: AttentionEvent["type"] = "NOW_IN_PLAY"): AttentionEvent {
  const at = index * 60_000;
  return {
    eventId: "e" + index + "-" + type,
    type,
    symbol: "S" + index,
    at,
    qualifiedAt: at,
    emittedAt: at,
    episodeId: "episode-" + index,
    payload: {
      episodeId: "episode-" + index,
      symbol: "S" + index,
      at,
      attentionScore: score,
      core: .82,
      rawCore: .82,
      inPlayEnterThreshold: .8,
      feedMode: "sip",
      subWindow: "regular",
      calibrationId: "cal",
      axes: {
        participation: { input: 3, inputKind: "z", normalized: .8, scoringRole: "core" },
        displacement: { input: 3, inputKind: "z", normalized: .8, scoringRole: "core" },
        idiosyncrasy: { input: 1, inputKind: "z", normalized: .4, scoringRole: "modifier" },
      },
      freshness: "Extended",
      freshnessDetail: {
        minutesSinceEpisodeStart: 20,
        atrTravelledSinceEpisodeStart: 2.1,
        distanceFromVwapAtr: 1,
        distanceFromEma9Atr: 1.6,
        consecutiveExpansionBars: 1,
        pullbackObserved: false,
        reasons: ["ema9_distance_extended"],
      },
      contextBadges: [],
      atrTravelledSinceEpisodeStart: 2.1,
      nearestReference: null,
      dataQualityBadge: "ok",
      feedModeBadge: "SIP",
      notice: "NOT AN ENTRY — open the chart.",
      extensionWarning: "EXTENDED — do not chase",
    },
  };
}

describe("post-storage tiered alert delivery", () => {
  it("retains the four-per-window PRIMARY budget with an overflow digest", () => {
    const detections = Array.from({ length: 8 }, (_, index) => event(index, 70 + index));
    const result = compactAttentionAlertDeliveries(detections);
    expect(result).toMatchObject({
      detectedEventCount: 8,
      primaryDetectedEventCount: 8,
      secondaryDetectedEventCount: 0,
      deliveredEnvelopeCount: 4,
      primaryDirectDeliveryCount: 3,
      primaryDigestDeliveryCount: 1,
      secondaryDigestDeliveryCount: 0,
      primaryCollapsedEventCount: 5,
      materialOverrideCount: 0,
      maxPrimaryDeliveriesInAnyWindow: 4,
    });
    const digest = result.deliveries.find((row) => row.kind === "digest");
    expect(digest).toMatchObject({
      tier: "primary",
      symbols: ["S3", "S4", "S5", "S6", "S7"],
      fullListHref: "/attention?view=in-play",
    });
  });

  it("applies the material override to PRIMARY only", () => {
    const primary = [event(0, 70), event(1, 71), event(2, 72), event(3, 73), event(4, 90)];
    const result = compactAttentionAlertDeliveries(primary, {
      ...DEFAULT_ALERT_DELIVERY_RATE_CONFIG,
      materialAttentionOverridePoints: 10,
    });
    expect(result).toMatchObject({ deliveredEnvelopeCount: 5, materialOverrideCount: 1 });
    expect(result.deliveries).toContainEqual(expect.objectContaining({
      kind: "alert",
      tier: "primary",
      event: expect.objectContaining({ symbol: "S4" }),
      capOverride: true,
    }));

    const secondary = compactAttentionAlertDeliveries([
      event(0, 70, "KEY_LEVEL_EVENT"),
      event(1, 99, "ACCELERATION"),
    ], { ...DEFAULT_ALERT_DELIVERY_RATE_CONFIG, materialAttentionOverridePoints: 1 });
    expect(secondary.materialOverrideCount).toBe(0);
    expect(secondary.directDeliveryCount).toBe(0);
  });

  it("never delivers SECONDARY events individually and starts at most one digest per rolling window", () => {
    const detections = [
      event(0, 70, "KEY_LEVEL_EVENT"),
      event(1, 71, "ACCELERATION"),
      event(2, 72, "KEY_LEVEL_EVENT"),
      event(16, 73, "KEY_LEVEL_EVENT"),
      event(17, 74, "ACCELERATION"),
    ];
    const result = compactAttentionAlertDeliveries(detections);
    expect(result).toMatchObject({
      primaryDetectedEventCount: 0,
      secondaryDetectedEventCount: 5,
      directDeliveryCount: 0,
      secondaryDigestDeliveryCount: 2,
      secondaryCollapsedEventCount: 5,
      maxSecondaryDigestsInAnyWindow: 1,
    });
    expect(result.deliveries.every((delivery) => delivery.kind === "digest" && delivery.tier === "secondary")).toBe(true);
    expect(result.deliveries[0]).toMatchObject({
      eventTypes: ["KEY_LEVEL_EVENT", "ACCELERATION", "KEY_LEVEL_EVENT"],
      symbols: ["S0", "S1", "S2"],
    });
  });

  it("keeps PRIMARY and SECONDARY budgets independent", () => {
    const primary = Array.from({ length: 8 }, (_, index) => event(index, 70 + index));
    const secondary = Array.from({ length: 5 }, (_, index) => event(index, 60 + index, "KEY_LEVEL_EVENT"));
    const detections = [...primary, ...secondary];
    const before = structuredClone(detections);
    const result = compactAttentionAlertDeliveries(detections);
    expect(detections).toEqual(before);
    expect(result).toMatchObject({
      detectedEventCount: 13,
      deliveredEnvelopeCount: 5,
      primaryDirectDeliveryCount: 3,
      primaryDigestDeliveryCount: 1,
      secondaryDigestDeliveryCount: 1,
      primaryCollapsedEventCount: 5,
      secondaryCollapsedEventCount: 5,
      maxPrimaryDeliveriesInAnyWindow: 4,
      maxSecondaryDigestsInAnyWindow: 1,
    });
  });

  it("bounds checkpointed delivery history without changing current-minute compaction over 390 minutes", () => {
    const full: AttentionEvent[] = [];
    let trimmed: AttentionEvent[] = [];
    let state = emptyIncrementalAlertDeliveryState();
    for (let minute = 0; minute < 390; minute += 1) {
      const current = [
        ...(minute % 3 === 0 ? [event(minute, 65 + minute % 30, "NOW_IN_PLAY")] : []),
        ...(minute % 7 === 0 ? [event(minute + 1_000, 70 + minute % 20, "KEY_LEVEL_EVENT")] : []),
        ...(minute % 11 === 0 ? [event(minute + 2_000, 75 + minute % 15, "ACCELERATION")] : []),
      ].map((row, index) => ({
        ...row,
        eventId: `${row.eventId}:m${minute}:${index}`,
        at: minute * 60_000,
        qualifiedAt: minute * 60_000,
        emittedAt: minute * 60_000,
        payload: { ...row.payload, at: minute * 60_000 },
      }));
      full.push(...current);
      trimmed.push(...structuredClone(current));
      const fullCompaction = compactAttentionAlertDeliveries(full);
      const incremental = compactAttentionAlertDeliveriesIncremental(trimmed, state);
      state = incremental.state;
      expect(deliveriesQualifiedAtMinute(incremental.deliveries, trimmed, minute * 60_000))
        .toEqual(deliveriesQualifiedAtMinute(fullCompaction.deliveries, full, minute * 60_000));
      trimmed = trimSessionEventsForDelivery(trimmed, minute * 60_000);
      state = trimIncrementalAlertDeliveryState(state, trimmed, minute * 60_000);
    }
    expect(trimmed.every((row) => row.emittedAt > 389 * 60_000 - 30 * 60_000)).toBe(true);
  });
});