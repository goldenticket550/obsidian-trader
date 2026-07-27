import { describe, it, expect } from "vitest";
import {
  computeSignalCards,
  filterEventsByWindow,
  DEFAULT_SIGNAL_WINDOW,
  SIGNAL_WINDOW_LABEL,
  ALERT_FETCH_LIMIT,
} from "@/lib/alerts/signalCounts";
import type { AlertEvent, AlertType } from "@/lib/alerts/types";

function makeEvent(type: AlertType, firedAt: string): AlertEvent {
  return {
    id: `${type}-${firedAt}`,
    ruleId: `rule_${type}`,
    type,
    symbol: "NVDA",
    timeframe: "5m",
    message: "x",
    firedAt,
  };
}

const NOW = Date.parse("2026-07-27T18:00:00Z");

describe("DEFAULT_SIGNAL_WINDOW", () => {
  it("defaults the dashboard to the last 60 minutes, not the full recent set", () => {
    expect(DEFAULT_SIGNAL_WINDOW).toBe("last_60m");
  });
});

describe("filterEventsByWindow", () => {
  it("keeps only events from the last 60 minutes", () => {
    const events = [
      makeEvent("liquidity_sweep", "2026-07-27T17:30:00Z"), // 30m ago
      makeEvent("liquidity_sweep", "2026-07-27T16:30:00Z"), // 90m ago
    ];
    expect(filterEventsByWindow(events, "last_60m", NOW).length).toBe(1);
  });

  it("includes an event exactly 60 minutes old (inclusive boundary)", () => {
    const events = [makeEvent("ema_reclaim", "2026-07-27T17:00:00Z")]; // exactly 60m before NOW
    expect(filterEventsByWindow(events, "last_60m", NOW)).toHaveLength(1);
  });

  it("excludes an event 60 minutes and one second old", () => {
    const events = [makeEvent("ema_reclaim", "2026-07-27T16:59:59Z")]; // 60m01s before NOW
    expect(filterEventsByWindow(events, "last_60m", NOW)).toEqual([]);
  });

  it("applies no time filter for 'recent' — it counts exactly what was loaded", () => {
    // The API returns a flat latest-N with no date filter, so pretending
    // to scope this to "today" would overstate what we actually have.
    const events = [
      makeEvent("ema_reclaim", "2026-07-27T02:00:00Z"),
      makeEvent("ema_reclaim", "2026-07-26T23:00:00Z"),
      makeEvent("ema_reclaim", "2020-01-01T00:00:00Z"),
    ];
    expect(filterEventsByWindow(events, "recent", NOW).length).toBe(3);
  });

  it("excludes future-dated events from the 60-minute window", () => {
    const events = [makeEvent("score_threshold", "2026-07-27T19:00:00Z")];
    expect(filterEventsByWindow(events, "last_60m", NOW)).toEqual([]);
  });

  it("excludes an unparseable timestamp from the timed window rather than counting it", () => {
    const events = [makeEvent("score_threshold", "not-a-date")];
    expect(filterEventsByWindow(events, "last_60m", NOW)).toEqual([]);
    // "recent" is explicitly unfiltered, so it still reflects the loaded
    // set — it makes no time claim to violate.
    expect(filterEventsByWindow(events, "recent", NOW)).toHaveLength(1);
  });

  it("returns nothing for an empty input", () => {
    expect(filterEventsByWindow([], "recent", NOW)).toEqual([]);
  });

  it("feeds the counts and the queue from the SAME filtered collection", () => {
    // The dashboard passes filterEventsByWindow(...) to the ActionQueue and
    // computeSignalCards calls it internally — this guards that both derive
    // from one identical windowed set, so counts and queue can never drift.
    const events = [
      makeEvent("liquidity_sweep", "2026-07-27T17:45:00Z"), // in window
      makeEvent("structure_shift", "2026-07-27T17:50:00Z"), // in window
      makeEvent("liquidity_sweep", "2026-07-27T09:00:00Z"), // out of window
    ];
    const queueSource = filterEventsByWindow(events, "last_60m", NOW);
    const cards = computeSignalCards(events, "last_60m", NOW);
    const cardTotal = cards.reduce((sum, c) => sum + c.count, 0);
    // Every windowed event here is a headline type, so the queue length and
    // the summed card counts match exactly — same collection, same window.
    expect(queueSource).toHaveLength(2);
    expect(cardTotal).toBe(queueSource.length);
  });
});

describe("computeSignalCards", () => {
  it("always returns exactly the five headline cards, even with no events", () => {
    const cards = computeSignalCards([], "recent", NOW);
    expect(cards.map((c) => c.key)).toEqual([
      "liquidity_sweep",
      "structure_shift",
      "ema_reclaim",
      "fvg_entry",
      "score_threshold",
    ]);
    expect(cards.every((c) => c.count === 0)).toBe(true);
  });

  it("counts real events of each type", () => {
    const events = [
      makeEvent("liquidity_sweep", "2026-07-27T17:00:00Z"),
      makeEvent("liquidity_sweep", "2026-07-27T17:10:00Z"),
      makeEvent("structure_shift", "2026-07-27T17:20:00Z"),
    ];
    const cards = computeSignalCards(events, "recent", NOW);
    const byKey = Object.fromEntries(cards.map((c) => [c.key, c.count]));
    expect(byKey.liquidity_sweep).toBe(2);
    expect(byKey.structure_shift).toBe(1);
    expect(byKey.ema_reclaim).toBe(0);
  });

  it("counts gap ENTRY (proximity) for the FVG card, not gap creation", () => {
    // A gap forming is a Monitor-bucket event; a gap being entered is the
    // headline. Conflating them would inflate the card.
    const events = [
      makeEvent("fair_value_gap_created", "2026-07-27T17:00:00Z"),
      makeEvent("fair_value_gap_created", "2026-07-27T17:01:00Z"),
      makeEvent("fair_value_gap_proximity", "2026-07-27T17:02:00Z"),
    ];
    const cards = computeSignalCards(events, "recent", NOW);
    expect(cards.find((c) => c.key === "fvg_entry")?.count).toBe(1);
  });

  it("respects the window when counting", () => {
    const events = [
      makeEvent("score_threshold", "2026-07-27T17:45:00Z"), // within 60m
      makeEvent("score_threshold", "2026-07-27T09:00:00Z"), // today, outside 60m
    ];
    const today = computeSignalCards(events, "recent", NOW);
    const lastHour = computeSignalCards(events, "last_60m", NOW);
    expect(today.find((c) => c.key === "score_threshold")?.count).toBe(2);
    expect(lastHour.find((c) => c.key === "score_threshold")?.count).toBe(1);
  });

  it("never claims a complete day, since the API returns a flat latest-N", () => {
    // Guards the specific overstatement: "Events today" would imply the
    // full Eastern trading day was retrieved. It isn't.
    expect(SIGNAL_WINDOW_LABEL.recent).toBe(`Recent events (latest ${ALERT_FETCH_LIMIT})`);
    expect(SIGNAL_WINDOW_LABEL.recent.toLowerCase()).not.toContain("today");
    expect(SIGNAL_WINDOW_LABEL.last_60m).toBe("Last 60 minutes");
  });
});
