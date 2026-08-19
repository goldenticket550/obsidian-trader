import { describe, expect, it } from "vitest";
import { InMemoryRuntimeStore } from "@/lib/attention-runtime/inMemoryStore";
import { AttentionLiveWorker, type AttentionRuntimeProcessor } from "@/lib/attention-runtime/worker";
import type { LiveIngestionSource } from "@/lib/attention-runtime/ingestion";
import type { LiveMinuteBatch, RuntimeIdentity, RuntimeProcessorResult } from "@/lib/attention-runtime/contracts";

const at = Date.parse("2026-08-19T16:14:00.000Z");
const identity = (runId: string): RuntimeIdentity => ({
  engineInstanceId: "host-lease-test", runId, userId: "user", universeHash: "u",
  calibrationId: "c", configHash: "cfg", baselineTableId: "baseline", feedMode: "iex_partial",
});
function minute(): LiveMinuteBatch {
  return { at, tradingDate: "2026-08-19", minuteOfDay: 734, mode: "mock", requestedSymbols: ["SPY"],
    barsBySymbol: {}, latestBarBySymbol: { SPY: null }, responseFeed: "mock", complete: true,
    staleSymbols: [], missingSymbols: [], guard: { active: false, reason: "none", activeSince: null,
      contiguousMinutes: 5, requiredContiguousMinutes: 5 }, audit: [] };
}
class Source implements LiveIngestionSource {
  readonly mode = "mock" as const;
  constructor(private readonly fail = false) {}
  async readCompletedMinute(): Promise<LiveMinuteBatch> {
    if (this.fail) throw new Error("guaranteed cycle failure");
    return minute();
  }
}
class Processor implements AttentionRuntimeProcessor {
  restore(): void {}
  async process(): Promise<RuntimeProcessorResult> {
    return { rows: [], events: [], processorState: { ok: true }, statusMessage: "ok" };
  }
}
function setControls(store: InMemoryRuntimeStore): void {
  store.setControls({ version: 1, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true,
    activeAlertEngine: "legacy", updatedAt: at, reason: "host-test" });
}

describe("productive runtime leases", () => {
  it("releases ownership on a failed cycle so a fresh worker acquires immediately", async () => {
    const store = new InMemoryRuntimeStore(); setControls(store);
    const failed = new AttentionLiveWorker(store, new Source(true), new Processor(), { identity: identity("failed"), shadow: true, leaseTtlMs: 90_000 });
    await failed.start(at);
    await expect(failed.runOnce(at)).rejects.toThrow("guaranteed cycle failure");
    const fresh = new AttentionLiveWorker(store, new Source(), new Processor(), { identity: identity("fresh"), shadow: true, leaseTtlMs: 90_000 });
    await expect(fresh.start(at + 1)).resolves.toBeUndefined();
    await fresh.stop();
  });

  it("never displaces a live productive holder", async () => {
    const store = new InMemoryRuntimeStore(); setControls(store);
    const holder = new AttentionLiveWorker(store, new Source(), new Processor(), { identity: identity("holder"), shadow: true, leaseTtlMs: 90_000 });
    await holder.start(at);
    await holder.runOnce(at);
    const contender = new AttentionLiveWorker(store, new Source(), new Processor(), { identity: identity("contender"), shadow: true, leaseTtlMs: 90_000 });
    await expect(contender.start(at + 60_000)).rejects.toThrow("Runtime lease is held");
    await holder.stop();
  });

  it("allows takeover after a crashed holder's TTL, never before", async () => {
    const store = new InMemoryRuntimeStore();
    await store.acquireLease(identity("crashed"), at, 90_000);
    await expect(store.acquireLease(identity("early"), at + 89_999, 90_000)).rejects.toThrow("Runtime lease is held");
    await expect(store.acquireLease(identity("takeover"), at + 90_000, 90_000)).resolves.toMatchObject({ ownerRunId: "takeover", fencingToken: 2 });
  });
});
