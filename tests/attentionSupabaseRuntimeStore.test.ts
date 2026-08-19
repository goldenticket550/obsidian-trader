import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileRuntimeStore } from "@/lib/attention-runtime/jsonFileStore";
import { SupabaseRuntimeStore, SUPABASE_LEASE_CONFLICT } from "@/lib/attention-runtime/supabaseStore";
import { AttentionLiveWorker, type AttentionRuntimeProcessor } from "@/lib/attention-runtime/worker";
import type { LiveAttentionSnapshot, LiveMinuteBatch, RuntimeControls, RuntimeIdentity, RuntimeProcessorResult } from "@/lib/attention-runtime/contracts";

class FakeSupabase {
  controls: Record<string, unknown> | null = null;
  snapshot: LiveAttentionSnapshot | null = null;
  commits = 0;
  leaseConflict = false;
  from(table: string) {
    const self = this;
    const chain: any = {
      upsert: async (value: Record<string, unknown>) => { if (table === "attention_runtime_controls") self.controls = value; return { error: null }; },
      update: () => chain,
      eq: () => chain,
      select: () => chain,
      single: async () => ({ data: { fencing_token: 1 }, error: null }),
      maybeSingle: async () => table === "attention_runtime_controls"
        ? { data: self.controls, error: null }
        : { data: self.snapshot ? { snapshot: self.snapshot } : null, error: null },
    };
    return chain;
  }
  async rpc(name: string, args: Record<string, unknown>) {
    if (name === "acquire_attention_engine_lease") return this.leaseConflict
      ? { data: null, error: { message: "attention runtime lease already held" } }
      : { data: [{ fencing_token: 1, lease_expires_at: new Date(Date.now() + 3_600_000).toISOString() }], error: null };
    if (name === "commit_attention_runtime_minute") {
      expect(args).not.toHaveProperty("p_checkpoint");
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

describe("Supabase runtime publication with local crash recovery", () => {
  it("keeps the full checkpoint local, publishes no processor state, and resumes at the next watermark", async () => {
    const cloud = new FakeSupabase();
    const mirror = new JsonFileRuntimeStore(join(directory, "runtime.json"));
    const firstStore = new SupabaseRuntimeStore(cloud as any, identity("run-1"), mirror);
    await firstStore.setControls(controls(baseAt));
    const first = new AttentionLiveWorker(firstStore, new Source(baseAt), new Processor(), { identity: identity("run-1"), shadow: true, leaseTtlMs: 3_600_000 });
    await first.start(baseAt);
    await first.runOnce(baseAt);
    expect(cloud.commits).toBe(1);
    expect((await mirror.loadCheckpoint())?.processorState).toEqual({ count: 1 });

    const secondStore = new SupabaseRuntimeStore(cloud as any, identity("run-2"), mirror);
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

  it("normalizes the Supabase lease conflict for 90-second supervisor backoff", async () => {
    const cloud = new FakeSupabase(); cloud.leaseConflict = true;
    const store = new SupabaseRuntimeStore(cloud as any, identity("run"));
    await expect(store.acquireLease(identity("run"), baseAt, 90_000)).rejects.toThrow(SUPABASE_LEASE_CONFLICT);
  });
});
