import type { AlertEvent, AlertType } from "./types";

/**
 * The five headline signal cards. Each is a COUNT OF REAL ALERT EVENTS of
 * a specific type within an explicit window — never a modelled or
 * projected number, and never compared against a "previous period" the
 * app doesn't actually store.
 *
 * `fvg_entry` intentionally counts proximity events only. A gap being
 * created is a setup forming (that's a Monitor-bucket event); a gap being
 * entered is the thing worth a headline card.
 */
export interface SignalCard {
  key: string;
  label: string;
  type: AlertType;
  count: number;
}

const SIGNAL_DEFINITIONS: { key: string; label: string; type: AlertType }[] = [
  { key: "liquidity_sweep", label: "Liquidity sweep", type: "liquidity_sweep" },
  { key: "structure_shift", label: "Structure shift", type: "structure_shift" },
  { key: "ema_reclaim", label: "EMA reclaim", type: "ema_reclaim" },
  { key: "fvg_entry", label: "FVG entry", type: "fair_value_gap_proximity" },
  { key: "score_threshold", label: "Score threshold", type: "score_threshold" },
];

export type SignalWindow = "recent" | "last_60m";

/**
 * The API returns at most ALERT_FETCH_LIMIT events with no date filter,
 * so the unfiltered view CANNOT honestly be called "Events today" — a
 * busy day would silently truncate and the label would overstate what
 * was actually counted. "Recent events" plus the explicit limit is the
 * true claim. The 60-minute view is safe to name precisely because it
 * filters the loaded set by timestamp.
 */
export const ALERT_FETCH_LIMIT = 100;

export const SIGNAL_WINDOW_LABEL: Record<SignalWindow, string> = {
  recent: `Recent events (latest ${ALERT_FETCH_LIMIT})`,
  last_60m: "Last 60 minutes",
};

/**
 * Filters events to the requested window. "recent" applies no time filter
 * at all — it counts exactly the events that were loaded, which is the
 * only honest thing to do given the API's flat limit. Events with an
 * unparseable `firedAt` are excluded from the timed window rather than
 * silently counted.
 */
export function eventsInWindow(events: AlertEvent[], window: SignalWindow, now: number): AlertEvent[] {
  if (window === "last_60m") {
    const cutoff = now - 60 * 60 * 1000;
    return events.filter((e) => {
      const t = new Date(e.firedAt).getTime();
      return Number.isFinite(t) && t >= cutoff && t <= now;
    });
  }

  return events;
}

/** Builds the five signal cards from real events within an explicit window. */
export function computeSignalCards(
  events: AlertEvent[],
  window: SignalWindow,
  now: number
): SignalCard[] {
  const scoped = eventsInWindow(events, window, now);
  return SIGNAL_DEFINITIONS.map((def) => ({
    ...def,
    count: scoped.filter((e) => e.type === def.type).length,
  }));
}
