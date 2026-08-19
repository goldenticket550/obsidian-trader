import type { AttentionEvent } from "./attentionEvents";
import {
  DEFAULT_ALERT_DELIVERY_RATE_CONFIG,
  type AlertDeliveryRateConfig,
  type AttentionAlertDelivery,
  type DigestAlertDelivery,
  type DirectAlertDelivery,
} from "./alertDelivery";

export interface IncrementalAlertDeliveryState {
  recentEntryEvents: AttentionEvent[];
  primaryDeliveries: AttentionAlertDelivery[];
  secondaryDigests: DigestAlertDelivery[];
  processedEventIds: string[];
}

export interface IncrementalAlertDeliveryResult {
  deliveries: AttentionAlertDelivery[];
  state: IncrementalAlertDeliveryState;
}

export function emptyIncrementalAlertDeliveryState(): IncrementalAlertDeliveryState {
  return { recentEntryEvents: [], primaryDeliveries: [], secondaryDigests: [], processedEventIds: [] };
}

function message(eventTypes: readonly AttentionEvent["type"][], symbols: readonly string[], count: number, minutes: number): string {
  if (eventTypes.every((type) => type === "NOW_IN_PLAY")) {
    return `${count} more ${count === 1 ? "name" : "names"} entered IN PLAY in the last ${minutes} min: ${symbols.join(", ")}`;
  }
  return `${count} secondary attention ${count === 1 ? "event" : "events"} in the last ${minutes} min: ${eventTypes.map((type, index) => `${type} ${symbols[index]}`).join(", ")}`;
}

/**
 * Exact stateful form of the published stateless compactor. It keeps only the active rolling
 * state, while accepting the complete retained `sessionEvents` suffix on every call. Already
 * processed ids are ignored, so a checkpoint restart cannot duplicate a delivery decision.
 */
export function compactAttentionAlertDeliveriesIncremental(
  sessionEvents: readonly AttentionEvent[],
  prior: IncrementalAlertDeliveryState,
  config: AlertDeliveryRateConfig = DEFAULT_ALERT_DELIVERY_RATE_CONFIG,
): IncrementalAlertDeliveryResult {
  const state = structuredClone(prior);
  const processed = new Set(state.processedEventIds);
  const events = sessionEvents
    .filter((event) => !processed.has(event.eventId))
    .sort((left, right) => left.emittedAt - right.emittedAt || left.eventId.localeCompare(right.eventId));
  const primaryEvents = events.filter((event) => event.type === "NOW_IN_PLAY");
  const secondaryEvents = events.filter((event) => event.type !== "NOW_IN_PLAY");
  const touched = new Map<string, AttentionAlertDelivery>();
  const windowMs = config.alertRateWindowMinutes * 60_000;
  const directCapacity = config.maxAlertsPerWindow - 1;

  for (const event of primaryEvents) {
    state.recentEntryEvents = state.recentEntryEvents.filter((row) => row.emittedAt > event.emittedAt - windowMs);
    state.primaryDeliveries = state.primaryDeliveries.filter((delivery) => delivery.at > event.emittedAt - windowMs);
    const priorEntryPeak = state.recentEntryEvents.reduce((peak, row) => Math.max(peak, row.payload.attentionScore), Number.NEGATIVE_INFINITY);
    const materiallyStronger = priorEntryPeak !== Number.NEGATIVE_INFINITY &&
      event.payload.attentionScore >= priorEntryPeak + config.materialAttentionOverridePoints;
    state.recentEntryEvents.push(event);
    const activeDigest = [...state.primaryDeliveries].reverse().find(
      (delivery): delivery is DigestAlertDelivery => delivery.kind === "digest",
    );
    if (!activeDigest && state.primaryDeliveries.length < directCapacity) {
      const direct: DirectAlertDelivery = { kind: "alert", tier: "primary", deliveryId: `delivery:${event.eventId}`, at: event.emittedAt, event, capOverride: false, overrideReason: null };
      state.primaryDeliveries.push(direct);
      touched.set(direct.deliveryId, direct);
    } else if (materiallyStronger) {
      const override: DirectAlertDelivery = { kind: "alert", tier: "primary", deliveryId: `delivery:${event.eventId}`, at: event.emittedAt, event, capOverride: true, overrideReason: "material_attention" };
      touched.set(override.deliveryId, override);
    } else if (activeDigest) {
      activeDigest.eventIds.push(event.eventId);
      activeDigest.eventTypes.push(event.type);
      activeDigest.symbols.push(event.symbol);
      activeDigest.windowEndsAt = event.emittedAt;
      activeDigest.message = message(activeDigest.eventTypes, activeDigest.symbols, activeDigest.eventIds.length, config.alertRateWindowMinutes);
      touched.set(activeDigest.deliveryId, activeDigest);
    } else {
      const digest: DigestAlertDelivery = {
        kind: "digest", tier: "primary", deliveryId: `delivery:primary-digest:${event.emittedAt}:${event.eventId}`,
        at: event.emittedAt, windowStartedAt: event.emittedAt, windowEndsAt: event.emittedAt,
        eventTypes: [event.type], eventIds: [event.eventId], symbols: [event.symbol],
        message: message([event.type], [event.symbol], 1, config.alertRateWindowMinutes), fullListHref: config.fullListHref,
      };
      state.primaryDeliveries.push(digest);
      touched.set(digest.deliveryId, digest);
    }
  }

  for (const event of secondaryEvents) {
    state.secondaryDigests = state.secondaryDigests.filter((delivery) => delivery.at > event.emittedAt - windowMs);
    const activeDigest = state.secondaryDigests.at(-1);
    if (activeDigest) {
      activeDigest.eventIds.push(event.eventId);
      activeDigest.eventTypes.push(event.type);
      activeDigest.symbols.push(event.symbol);
      activeDigest.windowEndsAt = event.emittedAt;
      activeDigest.message = message(activeDigest.eventTypes, activeDigest.symbols, activeDigest.eventIds.length, config.alertRateWindowMinutes);
      touched.set(activeDigest.deliveryId, activeDigest);
    } else {
      const digest: DigestAlertDelivery = {
        kind: "digest", tier: "secondary", deliveryId: `delivery:secondary-digest:${event.emittedAt}:${event.eventId}`,
        at: event.emittedAt, windowStartedAt: event.emittedAt, windowEndsAt: event.emittedAt,
        eventTypes: [event.type], eventIds: [event.eventId], symbols: [event.symbol],
        message: message([event.type], [event.symbol], 1, config.alertRateWindowMinutes), fullListHref: config.fullListHref,
      };
      state.secondaryDigests.push(digest);
      touched.set(digest.deliveryId, digest);
    }
  }

  state.processedEventIds.push(...events.map((event) => event.eventId));
  return { deliveries: [...touched.values()].map((delivery) => structuredClone(delivery)), state };
}

export function trimIncrementalAlertDeliveryState(
  state: IncrementalAlertDeliveryState,
  retainedEvents: readonly AttentionEvent[],
  throughAt: number,
  config: AlertDeliveryRateConfig = DEFAULT_ALERT_DELIVERY_RATE_CONFIG,
): IncrementalAlertDeliveryState {
  const cutoff = throughAt - config.alertRateWindowMinutes * 60_000;
  const retainedIds = new Set(retainedEvents.map((event) => event.eventId));
  return {
    recentEntryEvents: state.recentEntryEvents.filter((event) => event.emittedAt > cutoff),
    primaryDeliveries: state.primaryDeliveries.filter((delivery) => delivery.at > cutoff),
    secondaryDigests: state.secondaryDigests.filter((delivery) => delivery.at > cutoff),
    processedEventIds: state.processedEventIds.filter((eventId) => retainedIds.has(eventId)),
  };
}
