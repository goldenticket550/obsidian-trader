// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import LiveAttentionPage from "@/components/attention/LiveAttentionPage";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import type { LiveAttentionSnapshot } from "@/lib/attention-runtime/contracts";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function snapshot(): LiveAttentionSnapshot {
  const now = Date.now();
  return {
    schemaVersion: 1, engineInstanceId: "local", runId: "run", sequence: 2, asOf: now,
    tradingDate: "2026-08-18", minuteOfDay: 600, health: "ready", ready: true, shadow: true,
    liveDeliveryEnabled: false, legacyAlertingEnabled: true, ingestionMode: "iex_rest_polling",
    feedMode: "iex_partial", feedBadge: "IEX PARTIAL", calibrationId: "cal", baselineTableId: "baseline", darkWindowReason: null,
    guard: { active: false, reason: "none", activeSince: null, contiguousMinutes: 5, requiredContiguousMinutes: 5 },
    rankedRows: [{ symbol: "AAOI", attentionScore: 45, core: .4, state: "LOW_PRIORITY", freshness: null, rank: 1, dataQualityState: "ok", dataQualityReason: "settled", feedBadge: "IEX PARTIAL", pendingTransition: "none", pendingTransitionMinutes: 0 }],
    eventsDetected: 1, envelopesCreated: 0, detectionStatus: "ran", detectionSuppressionReason: null,
    detectionCounters: { processedMinutes: 2, detectionRanMinutes: 2, guardSuppressedByReason: {}, incompleteBatchMinutes: 0, nonRegularMinutes: 0, eventsDetected: 1 },
    statusMessage: "shadow", cycleTimings: { providerFetchMs: 1, barReconciliationMs: 1, baselineResolutionMs: 1, axisComputationMs: 1, scoringMs: 1, stateMachineMs: 1, episodeEventMs: 1, checkpointWriteMs: 1, snapshotPublishMs: 0, totalCycleMs: 8 },
    cycleBudgetExceeded: false, watermarkLagMs: 0, lagWarning: false,
  };
}

function event(): AttentionEvent {
  const at = Date.now();
  return {
    eventId: "event-1", type: "NOW_IN_PLAY", symbol: "AAOI", at, qualifiedAt: at, emittedAt: at, episodeId: "episode-1",
    payload: {
      episodeId: "episode-1", symbol: "AAOI", at, attentionScore: 82, core: .83, rawCore: .83, inPlayEnterThreshold: .8,
      feedMode: "iex_partial", subWindow: "regular", calibrationId: "cal",
      axes: { participation: { input: 1, inputKind: "z", normalized: .5, scoringRole: "display_only" }, displacement: { input: 3, inputKind: "z", normalized: .8, scoringRole: "core" }, idiosyncrasy: { input: 3, inputKind: "z", normalized: .8, scoringRole: "core" } },
      freshness: "Extended", freshnessDetail: { minutesSinceEpisodeStart: 8, atrTravelledSinceEpisodeStart: 1.2, distanceFromVwapAtr: 2, distanceFromEma9Atr: 1.7, consecutiveExpansionBars: 3, pullbackObserved: false, reasons: ["ema9_distance_extended"] },
      contextBadges: [{ kind: "vwap_distance", label: "2.0 ATR from VWAP", value: 2, unit: "atr" }], atrTravelledSinceEpisodeStart: 1.2, nearestReference: null,
      dataQualityBadge: "ok", feedModeBadge: "IEX PARTIAL", notice: "NOT AN ENTRY — open the chart.", extensionWarning: "EXTENDED — do not chase",
    },
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("LR8 on-page live alert feed", () => {
  it("loads snapshot and events together and renders stored freshness/context", async () => {
    const live = snapshot();
    const detected = event();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/events")
      ? json({ events: [detected], detection: { status: "ran", reason: null, counters: live.detectionCounters } })
      : json({ snapshot: live })));
    render(<LiveAttentionPage />);
    await screen.findByText("AAOI", { selector: "article span" });
    expect(screen.getByText("Extended").className).toContain("text-red-200");
    expect(screen.getByText("2.0 ATR from VWAP")).toBeTruthy();
    expect(screen.getByText("SHADOW — ON-PAGE ONLY · NO OUT-OF-BAND DELIVERY")).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/attention/live", { cache: "no-store" }));
    expect(fetch).toHaveBeenCalledWith("/api/attention/events?limit=200", { cache: "no-store" });
  });

  it("renders a closed-for-the-day state rather than implying a broken or quiet scanner", async () => {
    vi.setSystemTime(new Date("2026-08-22T16:14:00Z"));
    const closed = snapshot();
    closed.health = "dark_window";
    closed.ready = false;
    closed.darkWindowReason = "unavailable_on_partial_feed";
    closed.detectionStatus = "suppressed";
    closed.detectionSuppressionReason = "non_regular";
    closed.eventsDetected = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/events")
      ? json({ events: [], detection: { status: "suppressed", reason: "non_regular", counters: closed.detectionCounters } })
      : json({ snapshot: closed })));

    render(<LiveAttentionPage />);

    await screen.findByText("MARKET CLOSED — REGULAR SESSION ONLY");
    expect(screen.getByText("Market closed — regular-session scanning resumes at 09:30 ET.")).toBeTruthy();
    expect(screen.getByText("Market is closed. Free IEX shadow scanning resumes at 09:30 ET; no regular-session detection is running now.")).toBeTruthy();
    expect(screen.getByText("Closed for the day")).toBeTruthy();
    expect(screen.queryByText("QUIET — DETECTION RAN")).toBeNull();
  });

  it("does not call an open market closed because the last snapshot is from a dark window", async () => {
    vi.setSystemTime(new Date("2026-08-19T16:14:00Z"));
    const stale = snapshot();
    stale.asOf = Date.parse("2026-08-19T09:25:00Z");
    stale.health = "dark_window"; stale.ready = false; stale.darkWindowReason = "unavailable_on_partial_feed";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("/events")
      ? json({ events: [], detection: { status: "suppressed", reason: "non_regular", counters: stale.detectionCounters } })
      : json({ snapshot: stale })));
    render(<LiveAttentionPage />);
    await screen.findByText(/WORKER DOWN/);
    expect(screen.queryByText(/MARKET CLOSED/)).toBeNull();
    expect(screen.queryByText(/Market closed/)).toBeNull();
  });
  it("renders a signed-out state for redirected or non-JSON API responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } })));
    render(<LiveAttentionPage />);
    await screen.findByText("SIGNED OUT — SIGN IN AGAIN", { selector: "h2" });
  });
});
