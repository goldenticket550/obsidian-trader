import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import type { LiveAttentionSnapshot } from "@/lib/attention-runtime/contracts";
import { easternDayRange, eventsForEasternDay } from "@/lib/attention-runtime/localRuntimeHandoff";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));

import { GET as eventsGET } from "@/app/api/attention/events/route";
import { GET as liveGET } from "@/app/api/attention/live/route";

let directory = "";

function event(at: number, id: string): AttentionEvent {
  return {
    eventId: id, type: "NOW_IN_PLAY", symbol: "AAOI", at, qualifiedAt: at, emittedAt: at, episodeId: `episode:${id}`,
    payload: {
      episodeId: `episode:${id}`, symbol: "AAOI", at, attentionScore: 81, core: .82, rawCore: .82,
      inPlayEnterThreshold: .8, feedMode: "iex_partial", subWindow: "regular", calibrationId: "cal",
      axes: {
        participation: { input: 2, inputKind: "z", normalized: .7, scoringRole: "display_only" },
        displacement: { input: 3, inputKind: "z", normalized: .8, scoringRole: "core" },
        idiosyncrasy: { input: 3, inputKind: "z", normalized: .8, scoringRole: "core" },
      },
      freshness: "Fresh", freshnessDetail: null, contextBadges: [], atrTravelledSinceEpisodeStart: .2,
      nearestReference: null, dataQualityBadge: "ok", feedModeBadge: "IEX PARTIAL",
      notice: "NOT AN ENTRY — open the chart.", extensionWarning: null,
    },
  };
}

function snapshot(asOf: number): LiveAttentionSnapshot {
  return {
    schemaVersion: 1, engineInstanceId: "local", runId: "run", sequence: 4, asOf,
    tradingDate: "2026-08-18", minuteOfDay: 600, health: "ready", ready: true, shadow: true,
    liveDeliveryEnabled: false, legacyAlertingEnabled: true, ingestionMode: "iex_rest_polling",
    feedMode: "iex_partial", feedBadge: "IEX PARTIAL", calibrationId: "cal", baselineTableId: "baseline",
    darkWindowReason: null,
    guard: { active: false, reason: "none", activeSince: null, contiguousMinutes: 5, requiredContiguousMinutes: 5 },
    rankedRows: [], eventsDetected: 1, envelopesCreated: 0,
    detectionStatus: "ran", detectionSuppressionReason: null,
    detectionCounters: { processedMinutes: 4, detectionRanMinutes: 3, guardSuppressedByReason: { poll_failed: 1 }, incompleteBatchMinutes: 0, nonRegularMinutes: 0, eventsDetected: 1 },
    statusMessage: "shadow", cycleTimings: { providerFetchMs: 1, barReconciliationMs: 1, baselineResolutionMs: 1, axisComputationMs: 1, scoringMs: 1, stateMachineMs: 1, episodeEventMs: 1, checkpointWriteMs: 1, snapshotPublishMs: 0, totalCycleMs: 8 },
    cycleBudgetExceeded: false, watermarkLagMs: 0, lagWarning: false,
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "obsidian-events-"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("ATTENTION_RUNTIME_STATE_PATH", join(directory, "runtime.json"));
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL_ENV", "");
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("local Attention runtime APIs", () => {
  it("uses an explicit half-open Eastern day and returns authenticated events newest first", async () => {
    const range = easternDayRange();
    const included = [event(range.startAt, "start"), event(range.endAt - 1, "last")];
    const excluded = [event(range.startAt - 1, "before"), event(range.endAt, "end")];
    writeFileSync(process.env.ATTENTION_RUNTIME_STATE_PATH!, JSON.stringify({ snapshot: snapshot(Date.now()), events: [...included, ...excluded] }));

    expect(eventsForEasternDay([...included, ...excluded]).map((row) => row.eventId)).toEqual(["last", "start"]);
    const response = await eventsGET(new Request("http://localhost/api/attention/events?limit=20"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events.map((row: AttentionEvent) => row.eventId)).toEqual(["last", "start"]);
    expect(body.detection).toMatchObject({ status: "ran", counters: { detectionRanMinutes: 3 } });

    const liveResponse = await liveGET();
    const liveBody = await liveResponse.json();
    expect(liveBody.snapshot.sequence).toBe(4);
    expect(liveBody.instance.engine_instance_id).toBe("local");
  });

  it("refuses unauthenticated access", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await eventsGET(new Request("http://localhost/api/attention/events"));
    expect(response.status).toBe(401);
  });

  it("refuses a deployed production environment with a distinct detail", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await eventsGET(new Request("http://localhost/api/attention/events"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ status: "runtime_handoff_not_configured", detail: "local_runtime_refused_in_production" });
  });

  it("uses the single new unreadable-file status", async () => {
    const response = await eventsGET(new Request("http://localhost/api/attention/events"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "runtime_file_unreadable" });
  });
});
