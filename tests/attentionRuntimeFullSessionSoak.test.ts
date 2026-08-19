import { describe, expect, it } from "vitest";
import { InMemoryRuntimeStore } from "@/lib/attention-runtime/inMemoryStore";
import { AttentionLiveWorker, type AttentionRuntimeProcessor } from "@/lib/attention-runtime/worker";
import type { LiveIngestionSource } from "@/lib/attention-runtime/ingestion";
import type { LiveMinuteBatch, RuntimeIdentity, RuntimeProcessorResult } from "@/lib/attention-runtime/contracts";

const openAt = Math.floor(Date.now() / 60_000) * 60_000;

class FullSessionSource implements LiveIngestionSource {
  readonly mode = "mock" as const;
  private minute = 0;
  async readCompletedMinute(): Promise<LiveMinuteBatch> {
    const offset = this.minute++;
    return {
      at: openAt + offset * 60_000,
      tradingDate: "2026-08-18",
      minuteOfDay: 570 + offset,
      mode: "mock",
      requestedSymbols: [],
      barsBySymbol: {},
      latestBarBySymbol: {},
      responseFeed: "mock",
      complete: true,
      staleSymbols: [],
      missingSymbols: [],
      guard: { active: false, reason: "none", activeSince: null, contiguousMinutes: 5, requiredContiguousMinutes: 5 },
      audit: [],
    };
  }
}

class FullSessionProcessor implements AttentionRuntimeProcessor {
  count = 0;
  restore(state: unknown): void { this.count = (state as { count?: number } | null)?.count ?? 0; }
  async process(): Promise<RuntimeProcessorResult> {
    this.count += 1;
    return { rows: [], events: [], processorState: { count: this.count }, statusMessage: `minute=${this.count}` };
  }
}

describe("full-session sequencing contract (not live throughput acceptance)", () => {
  it("commits 390 mocked minute boundaries contiguously; processor/provider work is deliberately absent", async () => {
    const identity: RuntimeIdentity = { engineInstanceId: "soak", runId: "full-session", userId: "test", universeHash: "u", calibrationId: "c", configHash: "cfg", baselineTableId: "baseline", feedMode: "iex_partial" };
    const store = new InMemoryRuntimeStore();
    store.setControls({ version: 1, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true, activeAlertEngine: "legacy", updatedAt: openAt, reason: "soak" });
    const processor = new FullSessionProcessor();
    const worker = new AttentionLiveWorker(store, new FullSessionSource(), processor, { identity, shadow: true });
    await worker.start(openAt);
    const timestamps: number[] = [];
    for (let minute = 0; minute < 390; minute += 1) {
      const snapshot = await worker.runOnce(openAt + minute * 60_000);
      timestamps.push(snapshot.asOf);
      expect(snapshot.sequence).toBe(minute + 1);
    }
    await worker.stop();
    expect(processor.count).toBe(390);
    expect(timestamps.at(-1)).toBe(openAt + 389 * 60_000);
    expect(timestamps.slice(1).every((at, index) => at - timestamps[index] === 60_000)).toBe(true);
  });
});
