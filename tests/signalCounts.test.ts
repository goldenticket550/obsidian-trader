import { describe, it, expect } from "vitest";
import {
  computeSignalCards,
  eventsInWindow,
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

describe("eventsInWindow", () => {
  it("keeps only events from the last 60 minutes", () => {
    const events = [
      makeEvent("liquidity_sweep", "2026-07-27T17:30:00Z"), // 30m ago
      makeEvent("liquidity_sweep", "2026-07-27T16:30:00Z"), // 90m ago
    ];
    expect(eventsInWindow(events, "last_60m", NOW).length).toBe(1);
  });

  it("applies no time filter for 'recent' — it counts exactly what was loaded", () => {
    // The API returns a flat latest-N with no date filter, so pretending
    // to scope this to "today" would overstate what we actually have.
    const events = [
      makeEvent("ema_reclaim", "2026-07-27T02:00:00Z"),
      makeEvent("ema_reclaim", "2026-07-26T23:00:00Z"),
      makeEvent("ema_reclaim", "2020-01-01T00:00:00Z"),
    ];
    expect(eventsInWindow(events, "recent", NOW).length).toBe(3);
  });

  it("excludes future-dated events from the 60-minute window", () => {
    const events = [makeEvent("score_threshold", "2026-07-27T19:00:00Z")];
    expect(eventsInWindow(events, "last_60m", NOW)).toEqual([]);
  });

  it("excludes an unparseable timestamp from the timed window rather than counting it", () => {
    const events = [makeEvent("score_threshold", "not-a-date")];
    expect(eventsInWindow(events, "last_60m", NOW)).toEqual([]);
    // "recent" is explicitly unfiltered, so it still reflects the loaded
    // set — it makes no time claim to violate.
    expect(eventsInWindow(events, "recent", NOW)).toHaveLength(1);
  });

  it("returns nothing for an empty input", () => {
    expect(eventsInWindow([], "recent", NOW)).toEqual([]);
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
