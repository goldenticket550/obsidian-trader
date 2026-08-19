import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileRuntimeStore } from "@/lib/attention-runtime/jsonFileStore";
import { SupabaseRuntimeStore, SUPABASE_LEASE_CONFLICT } from "@/lib/attention-runtime/supabaseStore";
import { AttentionLiveWorker, type AttentionRuntimeProcessor } from "@/lib/attention-runtime/worker";
import type { LiveAttentionSnapshot, LiveMinuteBatch, RuntimeCheckpoint, RuntimeControls, RuntimeIdentity, RuntimeProcessorResult } from "@/lib/attention-runtime/contracts";

class FakeSupabase {
  controls: Record<string, unknown> | null = null;
  snapshot: LiveAttentionSnapshot | null = null;
  commits = 0;
  checkpoint: RuntimeCheckpoint | null = null;
  checkpointHistory: RuntimeCheckpoint[] = [];
  receivedEventIds: string[] = [];
  leaseConflict = false;
  from(table: string) {
    const self = this;
    const chain: any = {
      upsert: async (value: Record<string, unknown>) => { if (table === "attention_runtime_controls") self.controls = value; return { error: null }; },
      update: () => chain,
      eq: () => chain,
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => ({ data: { fencing_token: 1 }, error: null }),
      maybeSingle: async () => table === "attention_runtime_controls"
        ? { data: self.controls, error: null }
        : table === "attention_engine_checkpoints"
          ? { data: self.checkpoint ? { state: self.checkpoint } : null, error: null }
          : { data: self.snapshot ? { snapshot: self.snapshot } : null, error: null },
    };
    return chain;
  }
  async rpc(name: string, args: Record<string, unknown>) {
    if (name === "acquire_attention_engine_lease") return this.leaseConflict
      ? { data: null, error: { message: "attention runtime lease already held" } }
      : { data: [{ fencing_token: 1, lease_expires_at: new Date(Date.now() + 3_600_000).toISOString() }], error: null };
    if (name === "commit_attention_runtime_minute") {
      expect(args).toHaveProperty("p_checkpoint");
      this.checkpoint = args.p_checkpoint as RuntimeCheckpoint;
      this.checkpointHistory.push(this.checkpoint);
      this.checkpointHistory = this.checkpointHistory.slice(-3);
      for (const event of args.p_events as Array<{ eventId: string }>) {
        if (this.receivedEventIds.includes(event.eventId)) throw new Error("duplicate event replay");
        this.receivedEventIds.push(event.eventId);
      }
      this.snapshot = args.p_snapshot as LiveAttentionSnapshot;
      this.commits += 1;
      return { data: null, error: null };
    }
    return { data: [], error: null };
  }
}

const baseAt = Date.parse("2026-08-18T14:00:00Z");
const directory = mkdtempSync(join(tmpdir(), "attention-supabase-"));
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function identity(runId: string): RuntimeIdentity { return { engineInstanceId: "attention-test", runId, userId: "123e4567-e89b-42d3-a456-426614174000", universeHash: "u", calibrationId: "c", configHash: "cfg", baselineTableId: "b", feedMode: "iex_partial" }; }
function controls(at: number): RuntimeControls { return { version: 1, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true, activeAlertEngine: "legacy", updatedAt: at, reason: "test" }; }
class Source { readonly mode = "mock" as const; constructor(public at: number) {} async readCompletedMinute(): Promise<LiveMinuteBatch> { return { at: this.at, tradingDate: "2026-08-18", minuteOfDay: 600 + (this.at-baseAt)/60_000, mode: "mock", requestedSymbols: [], barsBySymbol: {}, latestBarBySymbol: {}, responseFeed: "mock", complete: true, staleSymbols: [], missingSymbols: [], guard: { active: false, reason: "none", activeSince: null, contiguousMinutes: 5, requiredContiguousMinutes: 5 }, audit: [] }; } }
class Processor implements AttentionRuntimeProcessor { count = 0; restore(state: unknown) { this.count = (state as { count?: number } | null)?.count ?? 0; } async process(): Promise<RuntimeProcessorResult> { this.count += 1; return { rows: [], events: [], processorState: { count: this.count }, statusMessage: `count=${this.count}` }; } }

describe("Supabase runtime publication with durable crash recovery", () => {
  it("persists the full checkpoint in Supabase and resumes at the next watermark without a local file", async () => {
    const cloud = new FakeSupabase();
    const mirror = new JsonFileRuntimeStore(join(directory, "runtime.json"));
    const firstStore = new SupabaseRuntimeStore(cloud as any, identity("run-1"), mirror);
    await firstStore.setControls(controls(baseAt));
    const first = new AttentionLiveWorker(firstStore, new Source(baseAt), new Processor(), { identity: identity("run-1"), shadow: true, leaseTtlMs: 3_600_000 });
    await first.start(baseAt);
    await first.runOnce(baseAt);
    expect(cloud.commits).toBe(1);
    expect(cloud.checkpoint?.processorState).toEqual({ count: 1 });

    const secondStore = new SupabaseRuntimeStore(cloud as any, identity("run-2"));
    await secondStore.setControls(controls(baseAt + 60_000));
    const restored = new Processor();
    const second = new AttentionLiveWorker(secondStore, new Source(baseAt + 60_000), restored, { identity: identity("run-2"), shadow: true, leaseTtlMs: 3_600_000 });
    await second.start(baseAt + 60_000);
    expect(restored.count).toBe(1);
    const snapshot = await second.runOnce(baseAt + 60_000);
    expect(snapshot.sequence).toBe(2);
    expect(snapshot.asOf).toBe(baseAt + 60_000);
    expect(restored.count).toBe(2);
    expect(cloud.commits).toBe(2);
  });

  it("resumes exactly after a mid-session kill with only three retained checkpoints and no event replay", async () => {
    class EventProcessor extends Processor {
      async process(): Promise<RuntimeProcessorResult> {
        this.count += 1;
        const event = {
          eventId: `event-${this.count}`, type: "NOW_IN_PLAY", symbol: "AAOI",
          at: baseAt + (this.count - 1) * 60_000, qualifiedAt: baseAt + (this.count - 1) * 60_000,
          emittedAt: baseAt + (this.count - 1) * 60_000, episodeId: "episode",
          payload: { attentionScore: 80, freshness: "Fresh", contextBadges: [] },
        } as any;
        return { rows: [], events: [event], processorState: { count: this.count }, statusMessage: `count=${this.count}` };
      }
    }
    const cloud = new FakeSupabase();
    const firstStore = new SupabaseRuntimeStore(cloud as any, identity("retained-1"));
    const source = new Source(baseAt);
    await firstStore.setControls(controls(baseAt));
    const first = new AttentionLiveWorker(firstStore, source, new EventProcessor(), { identity: identity("retained-1"), shadow: true, leaseTtlMs: 3_600_000 });
    await first.start(baseAt);
    for (let minute = 0; minute < 5; minute += 1) {
      source.at = baseAt + minute * 60_000;
      await firstStore.setControls(controls(source.at));
      await first.runOnce(source.at);
    }
    await first.stop();
    expect(cloud.checkpointHistory.map((row) => row.sequence)).toEqual([3, 4, 5]);

    const restartedAt = baseAt + 5 * 60_000;
    const secondStore = new SupabaseRuntimeStore(cloud as any, identity("retained-2"));
    await secondStore.setControls(controls(restartedAt));
    const restored = new EventProcessor();
    const second = new AttentionLiveWorker(secondStore, new Source(restartedAt), restored, { identity: identity("retained-2"), shadow: true, leaseTtlMs: 3_600_000 });
    await second.start(restartedAt);
    expect(restored.count).toBe(5);
    const resumed = await second.runOnce(restartedAt);
    await second.stop();

    expect(resumed.sequence).toBe(6);
    expect(resumed.asOf).toBe(restartedAt);
    expect(cloud.checkpointHistory.map((row) => row.sequence)).toEqual([4, 5, 6]);
    expect(cloud.receivedEventIds).toEqual(["event-1", "event-2", "event-3", "event-4", "event-5", "event-6"]);
    expect(new Set(cloud.receivedEventIds).size).toBe(6);
  });
  it("normalizes the Supabase lease conflict for 90-second supervisor backoff", async () => {
    const cloud = new FakeSupabase(); cloud.leaseConflict = true;
    const store = new SupabaseRuntimeStore(cloud as any, identity("run"));
    await expect(store.acquireLease(identity("run"), baseAt, 90_000)).rejects.toThrow(SUPABASE_LEASE_CONFLICT);
  });
});
