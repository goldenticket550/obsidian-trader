import type { AlertEvent, AlertType } from "./types";

/**
 * Triage buckets for the dashboard action queue. These group the EXISTING
 * nine alert types by how much they should interrupt you. Nothing here is
 * a severity score — an event's bucket is a fixed property of its type.
 *
 * `setup_invalidated` sits in the top bucket alongside the act-on-it
 * types, never in informational: an invalidation means a thesis you may
 * already be acting on just broke, which is the opposite of low priority.
 */
export type TriageBucket = "risk_review" | "monitor" | "informational";

const BUCKET_FOR_TYPE: Record<AlertType, TriageBucket> = {
  setup_invalidated: "risk_review",
  score_threshold: "risk_review",
  fair_value_gap_proximity: "risk_review",
  structure_shift: "risk_review",
  // Reclaim only emits at its Review-criteria tier, which is already
  // capped by timeframe and blocked by a conflicting alignment before it
  // gets here. Anything below that tier never becomes an event at all.
  reclaim_review_now: "risk_review",

  fair_value_gap_created: "monitor",
  liquidity_sweep: "monitor",
  ema_reclaim: "monitor",
  // Early tier belongs in Monitor, never risk_review: "developing" is
  // explicitly not a confirmed setup, and this bucket's own empty copy
  // ("Nothing developing.") already describes exactly this.
  entered_developing: "monitor",

  recovery_from_low: "informational",
  consecutive_bullish: "informational",
};

export const TRIAGE_ORDER: TriageBucket[] = ["risk_review", "monitor", "informational"];

export const TRIAGE_LABEL: Record<TriageBucket, string> = {
  risk_review: "Risk / review now",
  monitor: "Monitor",
  informational: "Informational",
};

/** Empty-state copy per bucket — calm, never seeded with example alerts. */
export const TRIAGE_EMPTY_COPY: Record<TriageBucket, string> = {
  risk_review: "Nothing needs review.",
  monitor: "Nothing developing.",
  informational: "No background events.",
};

export function bucketForAlertType(type: AlertType): TriageBucket {
  return BUCKET_FOR_TYPE[type];
}

/**
 * Removes repeat entries by stable event id, keeping first occurrence.
 * The dashboard merges freshly-fired events from /api/scan with persisted
 * history from /api/alerts, and the same event legitimately appears in
 * both — without this the queue would double-count it.
 */
export function dedupeAlerts(events: AlertEvent[]): AlertEvent[] {
  const seen = new Set<string>();
  const out: AlertEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}

export interface TriagedGroup {
  bucket: TriageBucket;
  label: string;
  emptyCopy: string;
  events: AlertEvent[];
}

/**
 * Deduplicates, then groups into the three buckets, newest first within
 * each. Every bucket is always returned — the UI shows a calm empty state
 * rather than hiding the section, so "nothing to review" is a visible
 * answer instead of an absence.
 */
export function triageAlerts(events: AlertEvent[]): TriagedGroup[] {
  const deduped = dedupeAlerts(events);
  return TRIAGE_ORDER.map((bucket) => ({
    bucket,
    label: TRIAGE_LABEL[bucket],
    emptyCopy: TRIAGE_EMPTY_COPY[bucket],
    events: deduped
      .filter((e) => bucketForAlertType(e.type) === bucket)
      .sort((a, b) => new Date(b.firedAt).getTime() - new Date(a.firedAt).getTime()),
  }));
}
