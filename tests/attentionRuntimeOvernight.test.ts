import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import type { LiveIngestionSource } from "@/lib/attention-runtime/ingestion";
import { assertIexBaselineTable, type IexBaselineTable } from "@/lib/attention-runtime/iexBaselineTable";
import { InMemoryRuntimeStore, assertCheckpointCompatible } from "@/lib/attention-runtime/inMemoryStore";
import { eventsForEasternDay } from "@/lib/attention-runtime/localRuntimeHandoff";
import type {
  LiveMinuteBatch,
  RuntimeIdentity,
  RuntimeProcessorResult,
} from "@/lib/attention-runtime/contracts";
import { AttentionLiveWorker, type AttentionRuntimeProcessor } from "@/lib/attention-runtime/worker";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";
import {
  assertFeedAwareAttentionThresholdStore,
  type FeedAwareAttentionThresholdStore,
} from "@/lib/replay/feedAwareAttentionThresholds";

const identity: RuntimeIdentity = {
  engineInstanceId: "overnight-worker",
  runId: "overnight-run",
  userId: "owner",
  universeHash: "universe",
  calibrationId: "calibration",
  configHash: "config",
  baselineTableId: "baseline",
  feedMode: "iex_partial",
};

function batch(at: number): LiveMinuteBatch {
  const eastern = getEasternTimeParts(new Date(at));
  return {
    at,
    tradingDate: eastern.date,
    minuteOfDay: eastern.minutesSinceMidnight,
    mode: "mock",
    requestedSymbols: [],
    barsBySymbol: {},
    latestBarBySymbol: {},
    responseFeed: "mock",
    complete: true,
    staleSymbols: [],
    missingSymbols: [],
    guard: {
      active: false,
      reason: "none",
      activeSince: null,
      contiguousMinutes: 5,
      requiredContiguousMinutes: 5,
    },
    audit: [],
  };
}

function event(at: number): AttentionEvent {
  const id = `NOW_IN_PLAY:AAOI:${at}`;
  return {
    eventId: id,
    type: "NOW_IN_PLAY",
    symbol: "AAOI",
    at,
    qualifiedAt: at,
    emittedAt: at,
    episodeId: `episode:${at}`,
    payload: {
      episodeId: `episode:${at}`,
      symbol: "AAOI",
      at,
      attentionScore: 82,
      core: 0.82,
      rawCore: 0.82,
      inPlayEnterThreshold: 0.8,
      feedMode: "iex_partial",
      subWindow: "regular",
      calibrationId: "calibration",
      axes: {
        participation: { input: 2, inputKind: "z", normalized: 0.7, scoringRole: "display_only" },
        displacement: { input: 3, inputKind: "z", normalized: 0.8, scoringRole: "core" },
        idiosyncrasy: { input: 3, inputKind: "z", normalized: 0.8, scoringRole: "core" },
      },
      freshness: "Fresh",
      freshnessDetail: null,
      contextBadges: [],
      atrTravelledSinceEpisodeStart: 0.2,
      nearestReference: null,
      dataQualityBadge: "ok",
      feedModeBadge: "IEX PARTIAL",
      notice: "NOT AN ENTRY — open the chart.",
      extensionWarning: null,
    },
  };
}

class MutableMinuteSource implements LiveIngestionSource {
  readonly mode = "mock" as const;
  at = 0;
  async readCompletedMinute(): Promise<LiveMinuteBatch> {
    return batch(this.at);
  }
}

class RegularMinuteDetector implements AttentionRuntimeProcessor {
  private processed = 0;
  restore(state: unknown): void {
    this.processed = (state as { processed?: number } | null)?.processed ?? 0;
  }
  async process(value: LiveMinuteBatch): Promise<RuntimeProcessorResult> {
    this.processed += 1;
    return {
      rows: [],
      events: [event(value.at)],
      processorState: { processed: this.processed },
      statusMessage: "regular detection ran",
    };
  }
}

describe("overnight live-runtime rollover", () => {
  it("clears prior-date event state and restarts session counters at the first regular minute", async () => {
    const store = new InMemoryRuntimeStore();
    const source = new MutableMinuteSource();
    const worker = new AttentionLiveWorker(store, source, new RegularMinuteDetector(), {
      identity,
      shadow: false,
      leaseTtlMs: 48 * 60 * 60_000,
    });
    const firstAt = Date.parse("2026-08-18T19:59:00Z"); // 15:59 ET
    const midnightAt = Date.parse("2026-08-19T04:00:00Z"); // 00:00 ET
    const nextOpenAt = Date.parse("2026-08-19T13:30:00Z"); // 09:30 ET

    store.setControls({
      version: 1,
      attentionLiveAlertingEnabled: true,
      legacyAlertingEnabled: false,
      activeAlertEngine: "attention",
      updatedAt: firstAt,
      reason: "test only",
    });
    await worker.start(firstAt);

    let midnightCheckpoint = null as Awaited<ReturnType<typeof store.loadCheckpoint>>;
    for (let at = firstAt; at <= nextOpenAt; at += 60_000) {
      source.at = at;
      store.setControls({
        version: 1,
        attentionLiveAlertingEnabled: true,
        legacyAlertingEnabled: false,
        activeAlertEngine: "attention",
        updatedAt: at,
        reason: "test only",
      });
      await worker.runOnce(at);
      if (at === midnightAt) midnightCheckpoint = await store.loadCheckpoint();
    }
    await worker.stop();

    const midnightDelivery = midnightCheckpoint?.deliveryState as {
      tradingDate: string;
      sessionEvents: AttentionEvent[];
      detectionCounters: { processedMinutes: number; nonRegularMinutes: number };
    };
    expect(midnightDelivery.tradingDate).toBe("2026-08-19");
    expect(midnightDelivery.sessionEvents).toEqual([]);
    expect(midnightDelivery.detectionCounters).toMatchObject({ processedMinutes: 1, nonRegularMinutes: 1 });

    const finalCheckpoint = await store.loadCheckpoint();
    expect(finalCheckpoint).not.toBeNull();
    assertCheckpointCompatible(finalCheckpoint!, identity);
    const finalDelivery = finalCheckpoint!.deliveryState as {
      tradingDate: string;
      sessionEvents: AttentionEvent[];
      detectionCounters: {
        processedMinutes: number;
        detectionRanMinutes: number;
        nonRegularMinutes: number;
        eventsDetected: number;
      };
    };
    expect(finalDelivery.tradingDate).toBe("2026-08-19");
    expect(finalDelivery.sessionEvents.map((row) => row.qualifiedAt)).toEqual([nextOpenAt]);
    expect(finalDelivery.detectionCounters).toMatchObject({
      processedMinutes: 1,
      detectionRanMinutes: 1,
      nonRegularMinutes: 0,
      eventsDetected: 1,
    });

    expect(eventsForEasternDay(store.events, nextOpenAt).map((row) => row.qualifiedAt)).toEqual([nextOpenAt]);
    const nextDayEnvelopes = store.outbox.filter((row) => row.createdAt >= nextOpenAt);
    expect(nextDayEnvelopes).toHaveLength(1);
    expect(nextDayEnvelopes[0].eventIds).toEqual([`NOW_IN_PLAY:AAOI:${nextOpenAt}`]);
  });

  it("advances a restarted dark-window watermark without erasing processor state", async () => {
    const store = new InMemoryRuntimeStore();
    const firstSource = new MutableMinuteSource();
    const firstProcessor = new RegularMinuteDetector();
    const firstWorker = new AttentionLiveWorker(store, firstSource, firstProcessor, { identity, shadow: true, leaseTtlMs: 48 * 60 * 60_000 });
    const regularAt = Date.parse("2026-08-18T19:59:00Z");
    store.setControls({ version: 1, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true, activeAlertEngine: "legacy", updatedAt: regularAt, reason: "test" });
    firstSource.at = regularAt;
    await firstWorker.start(regularAt);
    await firstWorker.runOnce(regularAt);
    await firstWorker.stop();

    const darkAt = Date.parse("2026-08-19T00:30:00Z");
    const secondSource = new MutableMinuteSource();
    const secondProcessor = new RegularMinuteDetector();
    const secondWorker = new AttentionLiveWorker(store, secondSource, secondProcessor, { identity, shadow: true, leaseTtlMs: 48 * 60 * 60_000 });
    secondSource.at = darkAt;
    store.setControls({ version: 1, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true, activeAlertEngine: "legacy", updatedAt: darkAt, reason: "test" });
    await secondWorker.start(darkAt);
    const snapshot = await secondWorker.runOnce(darkAt);
    await secondWorker.stop();

    expect(snapshot.darkWindowReason).toBe("unavailable_on_partial_feed");
    expect(snapshot.detectionSuppressionReason).toBe("non_regular");
    expect(snapshot.asOf).toBe(darkAt);
    expect((await store.loadCheckpoint())?.processorState).toEqual({ processed: 1 });
  });
  it("keeps the persisted IEX baseline and calibration identities valid across 2026-08-19", () => {
    const baseline = JSON.parse(readFileSync(resolve("data/replay/calibration/iex-live-baseline-table.json"), "utf8")) as IexBaselineTable;
    const thresholds = JSON.parse(readFileSync(resolve("data/replay/reports/attention-thresholds.json"), "utf8")) as FeedAwareAttentionThresholdStore;

    expect(() => assertIexBaselineTable(baseline)).not.toThrow();
    expect(() => assertFeedAwareAttentionThresholdStore(thresholds)).not.toThrow();
    expect(thresholds.sets.iex_partial.regular.calibrationStatus).toBe("calibrated");
    expect(baseline.firstMinute).toBe(570);
    expect(baseline.lastMinuteExclusive).toBe(960);
    expect(Object.prototype.hasOwnProperty.call(baseline, "expiresAt")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(thresholds.sets.iex_partial.regular, "expiresAt")).toBe(false);
  });
});
