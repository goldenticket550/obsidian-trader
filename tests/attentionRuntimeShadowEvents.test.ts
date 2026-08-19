import { describe, expect, it } from "vitest";
import { InMemoryRuntimeStore } from "@/lib/attention-runtime/inMemoryStore";
import { AttentionLiveWorker, type AttentionRuntimeProcessor } from "@/lib/attention-runtime/worker";
import type { LiveIngestionSource } from "@/lib/attention-runtime/ingestion";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import type { LiveMinuteBatch, RuntimeIdentity, RuntimeProcessorResult } from "@/lib/attention-runtime/contracts";

const baseAt = Math.floor(Date.now() / 60_000) * 60_000;
const identity: RuntimeIdentity = {
  engineInstanceId: "shadow-events", runId: "run", userId: "user", universeHash: "u",
  calibrationId: "c", configHash: "cfg", baselineTableId: "baseline", feedMode: "iex_partial",
};

function batch(at: number): LiveMinuteBatch {
  return {
    at, tradingDate: "2026-08-18", minuteOfDay: 660 + Math.round((at - baseAt) / 60_000),
    mode: "mock", requestedSymbols: [], barsBySymbol: {}, latestBarBySymbol: {}, responseFeed: "mock",
    complete: true, staleSymbols: [], missingSymbols: [],
    guard: { active: false, reason: "none", activeSince: null, contiguousMinutes: 5, requiredContiguousMinutes: 5 },
    audit: [],
  };
}

function detectedEvent(at: number, index: number): AttentionEvent {
  return {
    eventId: `detected:${at}:${index}`, type: "NOW_IN_PLAY", symbol: `S${index}`,
    at, qualifiedAt: at, emittedAt: at, episodeId: `episode:${at}:${index}`,
    payload: {
      episodeId: `episode:${at}:${index}`, symbol: `S${index}`, at, attentionScore: 70 + index,
      core: .82, rawCore: .82, inPlayEnterThreshold: .8, feedMode: "iex_partial", subWindow: "regular", calibrationId: "c",
      axes: {
        participation: { input: 3, inputKind: "z", normalized: .8, scoringRole: "display_only" },
        displacement: { input: 3, inputKind: "z", normalized: .8, scoringRole: "core" },
        idiosyncrasy: { input: 3, inputKind: "z", normalized: .8, scoringRole: "core" },
      },
      freshness: "Developing",
      freshnessDetail: { minutesSinceEpisodeStart: 2, atrTravelledSinceEpisodeStart: .4, distanceFromVwapAtr: .2, distanceFromEma9Atr: .1, consecutiveExpansionBars: 1, pullbackObserved: false, reasons: [] },
      contextBadges: [], atrTravelledSinceEpisodeStart: .4, nearestReference: null,
      dataQualityBadge: "ok", feedModeBadge: "IEX PARTIAL", notice: "NOT AN ENTRY — open the chart.", extensionWarning: null,
    },
  };
}

class SequenceSource implements LiveIngestionSource {
  readonly mode = "mock" as const;
  private minute = 0;
  constructor(private readonly startAt: number) {}
  async readCompletedMinute(): Promise<LiveMinuteBatch> { return batch(this.startAt + this.minute++ * 60_000); }
}

class DetectingProcessor implements AttentionRuntimeProcessor {
  private count = 0;
  restore(state: unknown): void { this.count = (state as { count?: number } | null)?.count ?? 0; }
  async process(value: LiveMinuteBatch): Promise<RuntimeProcessorResult> {
    this.count += 1;
    const eventCount = this.count === 1 ? 2 : this.count === 21 ? 8 : 0;
    return {
      rows: [], events: Array.from({ length: eventCount }, (_, index) => detectedEvent(value.at, index)),
      processorState: { count: this.count }, statusMessage: `count=${this.count}`,
    };
  }
}

describe("shadow event recording and delivery activation", () => {
  it("stores shadow detections but never catches them up when delivery is enabled", async () => {
    const store = new InMemoryRuntimeStore();
    store.setControls({ version: 1, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true, activeAlertEngine: "legacy", updatedAt: baseAt, reason: "shadow" });
    const shadowWorker = new AttentionLiveWorker(store, new SequenceSource(baseAt), new DetectingProcessor(), { identity, shadow: true });
    await shadowWorker.start(baseAt);
    for (let minute = 0; minute < 20; minute += 1) {
      const snapshot = await shadowWorker.runOnce(baseAt + minute * 60_000);
      expect(snapshot.envelopesCreated).toBe(0);
      expect(snapshot.liveDeliveryEnabled).toBe(false);
    }
    await shadowWorker.stop();
    expect(store.events).toHaveLength(2);
    expect(store.outbox).toHaveLength(0);

    const enabledAt = baseAt + 20 * 60_000;
    store.setControls({ version: 1, attentionLiveAlertingEnabled: true, legacyAlertingEnabled: false, activeAlertEngine: "attention", updatedAt: enabledAt, reason: "test-enable" });
    const enabledWorker = new AttentionLiveWorker(store, new SequenceSource(enabledAt), new DetectingProcessor(), { identity, shadow: false });
    await enabledWorker.start(enabledAt);
    const snapshot = await enabledWorker.runOnce(enabledAt);
    await enabledWorker.stop();

    expect(snapshot.eventsDetected).toBe(8);
    expect(snapshot.envelopesCreated).toBe(4);
    expect(store.events).toHaveLength(10);
    expect(store.outbox.filter((row) => row.kind === "alert")).toHaveLength(3);
    expect(store.outbox.filter((row) => row.kind === "digest")).toHaveLength(1);
    const currentIds = new Set(store.events.filter((event) => event.qualifiedAt === enabledAt).map((event) => event.eventId));
    expect(store.outbox.flatMap((row) => row.eventIds).every((eventId) => currentIds.has(eventId))).toBe(true);
    expect(store.outbox.flatMap((row) => row.eventIds).some((eventId) => eventId.startsWith(`detected:${baseAt}:`))).toBe(false);
  });
});
