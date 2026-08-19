import type { AttentionEvent, AttentionEventType } from "./attentionEvents";

export interface AlertDeliveryRateConfig {
  /** Strict PRIMARY envelope cap. One slot is reserved for a PRIMARY overflow digest. */
  maxAlertsPerWindow: number;
  alertRateWindowMinutes: number;
  /** SECONDARY events are never direct; at most one digest envelope starts per window. */
  maxSecondaryDigestsPerWindow: 1;
  materialAttentionOverridePoints: number;
  fullListHref: string;
}

export const DEFAULT_ALERT_DELIVERY_RATE_CONFIG: AlertDeliveryRateConfig = {
  maxAlertsPerWindow: 4,
  alertRateWindowMinutes: 15,
  maxSecondaryDigestsPerWindow: 1,
  materialAttentionOverridePoints: 10,
  fullListHref: "/attention?view=in-play",
};

export interface DirectAlertDelivery {
  kind: "alert";
  tier: "primary";
  deliveryId: string;
  at: number;
  event: AttentionEvent;
  capOverride: boolean;
  overrideReason: "material_attention" | null;
}

export interface DigestAlertDelivery {
  kind: "digest";
  tier: "primary" | "secondary";
  deliveryId: string;
  at: number;
  windowStartedAt: number;
  windowEndsAt: number;
  eventTypes: AttentionEventType[];
  eventIds: string[];
  symbols: string[];
  message: string;
  fullListHref: string;
}

export type AttentionAlertDelivery = DirectAlertDelivery | DigestAlertDelivery;

export interface AlertDeliveryCompactionResult {
  deliveries: AttentionAlertDelivery[];
  detectedEventCount: number;
  deliveredEnvelopeCount: number;
  directDeliveryCount: number;
  digestDeliveryCount: number;
  collapsedEventCount: number;
  materialOverrideCount: number;
  /** Backward-compatible alias for the PRIMARY rolling-window maximum. */
  maxOrdinaryDeliveriesInAnyWindow: number;
  primaryDetectedEventCount: number;
  secondaryDetectedEventCount: number;
  primaryDirectDeliveryCount: number;
  primaryDigestDeliveryCount: number;
  secondaryDigestDeliveryCount: number;
  primaryCollapsedEventCount: number;
  secondaryCollapsedEventCount: number;
  maxPrimaryDeliveriesInAnyWindow: number;
  maxSecondaryDigestsInAnyWindow: number;
}

function digestMessage(
  eventTypes: readonly AttentionEventType[],
  symbols: readonly string[],
  eventCount: number,
  minutes: number,
): string {
  if (eventTypes.every((type) => type === "NOW_IN_PLAY")) {
    return eventCount + " more " + (eventCount === 1 ? "name" : "names") +
      " entered IN PLAY in the last " + minutes + " min: " + symbols.join(", ");
  }
  return eventCount + " secondary attention " + (eventCount === 1 ? "event" : "events") +
    " in the last " + minutes + " min: " +
    eventTypes.map((type, index) => type + " " + symbols[index]).join(", ");
}

/**
 * Post-storage delivery tiering. NOW_IN_PLAY is PRIMARY and retains the existing four-envelope
 * rolling budget, including one overflow-digest slot; only PRIMARY can materially override it.
 * KEY_LEVEL_EVENT and ACCELERATION are SECONDARY: never direct, one update-in-place digest per
 * rolling window. Detection, storage, state, and standing lists remain untouched.
 */
export function compactAttentionAlertDeliveries(
  detectedEvents: readonly AttentionEvent[],
  config: AlertDeliveryRateConfig = DEFAULT_ALERT_DELIVERY_RATE_CONFIG,
): AlertDeliveryCompactionResult {
  if (config.maxAlertsPerWindow < 2 || config.alertRateWindowMinutes < 1 ||
      config.maxSecondaryDigestsPerWindow !== 1 ||
      config.materialAttentionOverridePoints < 0 || !config.fullListHref) {
    throw new Error("Alert delivery rate configuration is invalid.");
  }
  const events = [...detectedEvents].sort((a, b) => a.emittedAt - b.emittedAt || a.eventId.localeCompare(b.eventId));
  const primaryEvents = events.filter((event) => event.type === "NOW_IN_PLAY");
  const secondaryEvents = events.filter((event) => event.type !== "NOW_IN_PLAY");
  const deliveries: AttentionAlertDelivery[] = [];
  const primaryDeliveries: AttentionAlertDelivery[] = [];
  const secondaryDigests: DigestAlertDelivery[] = [];
  const recentEntryEvents: AttentionEvent[] = [];
  const windowMs = config.alertRateWindowMinutes * 60_000;
  const directCapacity = config.maxAlertsPerWindow - 1;
  let primaryCollapsedEventCount = 0;
  let secondaryCollapsedEventCount = 0;
  let materialOverrideCount = 0;

  for (const event of primaryEvents) {
    while (recentEntryEvents.length && recentEntryEvents[0].emittedAt <= event.emittedAt - windowMs) {
      recentEntryEvents.shift();
    }
    const priorEntryPeak = recentEntryEvents.reduce(
      (peak, row) => Math.max(peak, row.payload.attentionScore),
      Number.NEGATIVE_INFINITY,
    );
    const materiallyStronger = priorEntryPeak !== Number.NEGATIVE_INFINITY &&
      event.payload.attentionScore >= priorEntryPeak + config.materialAttentionOverridePoints;
    recentEntryEvents.push(event);

    const activePrimary = primaryDeliveries.filter((delivery) => delivery.at > event.emittedAt - windowMs);
    const activeDigest = [...activePrimary].reverse().find(
      (delivery): delivery is DigestAlertDelivery => delivery.kind === "digest",
    );

    if (!activeDigest && activePrimary.length < directCapacity) {
      const direct: DirectAlertDelivery = {
        kind: "alert",
        tier: "primary",
        deliveryId: "delivery:" + event.eventId,
        at: event.emittedAt,
        event,
        capOverride: false,
        overrideReason: null,
      };
      deliveries.push(direct);
      primaryDeliveries.push(direct);
      continue;
    }

    if (materiallyStronger) {
      deliveries.push({
        kind: "alert",
        tier: "primary",
        deliveryId: "delivery:" + event.eventId,
        at: event.emittedAt,
        event,
        capOverride: true,
        overrideReason: "material_attention",
      });
      materialOverrideCount += 1;
      continue;
    }

    if (activeDigest) {
      activeDigest.eventIds.push(event.eventId);
      activeDigest.eventTypes.push(event.type);
      activeDigest.symbols.push(event.symbol);
      activeDigest.windowEndsAt = event.emittedAt;
      activeDigest.message = digestMessage(
        activeDigest.eventTypes,
        activeDigest.symbols,
        activeDigest.eventIds.length,
        config.alertRateWindowMinutes,
      );
      primaryCollapsedEventCount += 1;
      continue;
    }

    const digest: DigestAlertDelivery = {
      kind: "digest",
      tier: "primary",
      deliveryId: "delivery:primary-digest:" + event.emittedAt + ":" + event.eventId,
      at: event.emittedAt,
      windowStartedAt: event.emittedAt,
      windowEndsAt: event.emittedAt,
      eventTypes: [event.type],
      eventIds: [event.eventId],
      symbols: [event.symbol],
      message: digestMessage([event.type], [event.symbol], 1, config.alertRateWindowMinutes),
      fullListHref: config.fullListHref,
    };
    deliveries.push(digest);
    primaryDeliveries.push(digest);
    primaryCollapsedEventCount += 1;
  }

  for (const event of secondaryEvents) {
    const activeDigest = [...secondaryDigests].reverse().find(
      (delivery) => delivery.at > event.emittedAt - windowMs,
    );
    if (activeDigest) {
      activeDigest.eventIds.push(event.eventId);
      activeDigest.eventTypes.push(event.type);
      activeDigest.symbols.push(event.symbol);
      activeDigest.windowEndsAt = event.emittedAt;
      activeDigest.message = digestMessage(
        activeDigest.eventTypes,
        activeDigest.symbols,
        activeDigest.eventIds.length,
        config.alertRateWindowMinutes,
      );
      secondaryCollapsedEventCount += 1;
      continue;
    }
    const digest: DigestAlertDelivery = {
      kind: "digest",
      tier: "secondary",
      deliveryId: "delivery:secondary-digest:" + event.emittedAt + ":" + event.eventId,
      at: event.emittedAt,
      windowStartedAt: event.emittedAt,
      windowEndsAt: event.emittedAt,
      eventTypes: [event.type],
      eventIds: [event.eventId],
      symbols: [event.symbol],
      message: digestMessage([event.type], [event.symbol], 1, config.alertRateWindowMinutes),
      fullListHref: config.fullListHref,
    };
    deliveries.push(digest);
    secondaryDigests.push(digest);
    secondaryCollapsedEventCount += 1;
  }

  deliveries.sort((a, b) => a.at - b.at || a.deliveryId.localeCompare(b.deliveryId));
  const rollingMaximum = (rows: readonly AttentionAlertDelivery[]) => rows.reduce((maximum, delivery) => {
    const count = rows.filter(
      (candidate) => candidate.at > delivery.at - windowMs && candidate.at <= delivery.at,
    ).length;
    return Math.max(maximum, count);
  }, 0);
  const maxPrimaryDeliveriesInAnyWindow = rollingMaximum(primaryDeliveries);
  const maxSecondaryDigestsInAnyWindow = rollingMaximum(secondaryDigests);
  const collapsedEventCount = primaryCollapsedEventCount + secondaryCollapsedEventCount;

  return {
    deliveries,
    detectedEventCount: events.length,
    deliveredEnvelopeCount: deliveries.length,
    directDeliveryCount: deliveries.filter((row) => row.kind === "alert").length,
    digestDeliveryCount: deliveries.filter((row) => row.kind === "digest").length,
    collapsedEventCount,
    materialOverrideCount,
    maxOrdinaryDeliveriesInAnyWindow: maxPrimaryDeliveriesInAnyWindow,
    primaryDetectedEventCount: primaryEvents.length,
    secondaryDetectedEventCount: secondaryEvents.length,
    primaryDirectDeliveryCount: deliveries.filter((row) => row.kind === "alert").length,
    primaryDigestDeliveryCount: deliveries.filter((row) => row.kind === "digest" && row.tier === "primary").length,
    secondaryDigestDeliveryCount: secondaryDigests.length,
    primaryCollapsedEventCount,
    secondaryCollapsedEventCount,
    maxPrimaryDeliveriesInAnyWindow,
    maxSecondaryDigestsInAnyWindow,
  };
}