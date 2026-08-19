import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import type {
  LiveAttentionSnapshot, RuntimeCheckpoint, RuntimeControls, RuntimeDeliveryEnvelope,
  RuntimeIdentity, RuntimeStore, WorkerLease,
} from "./contracts";
import type { JsonFileRuntimeStore } from "./jsonFileStore";

export const SUPABASE_LEASE_CONFLICT = "Runtime lease is held (Supabase: attention runtime lease already held).";

/** Service-role worker adapter. Checkpoints are durable in Supabase; a local mirror is optional diagnostics only. */
export class SupabaseRuntimeStore implements RuntimeStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly identity: RuntimeIdentity,
    private readonly localMirror?: JsonFileRuntimeStore,
  ) {}

  async setControls(controls: RuntimeControls): Promise<void> {
    const { error } = await this.client.from("attention_runtime_controls").upsert({
      engine_instance_id: this.identity.engineInstanceId,
      version: controls.version,
      attention_live_alerting_enabled: controls.attentionLiveAlertingEnabled,
      legacy_alerting_enabled: controls.legacyAlertingEnabled,
      active_alert_engine: controls.activeAlertEngine,
      reason: controls.reason,
      config_identity: this.identity.configHash,
      updated_at: new Date(controls.updatedAt).toISOString(),
      updated_by: this.identity.userId,
    }, { onConflict: "engine_instance_id" });
    if (error) throw new Error(`Attention runtime controls upsert failed: ${error.message}`);
    this.localMirror?.setControls(controls);
  }

  async acquireLease(identity: RuntimeIdentity, now: number, ttlMs: number): Promise<WorkerLease> {
    const { error: instanceError } = await this.client.from("attention_engine_instances").upsert({
      engine_instance_id: identity.engineInstanceId,
      user_id: identity.userId,
      universe_hash: identity.universeHash,
      calibration_id: identity.calibrationId,
      config_hash: identity.configHash,
      feed_mode: identity.feedMode,
      ingestion_mode: "iex_rest_polling",
      health: "starting",
      ready: false,
      shadow: true,
      updated_at: new Date(now).toISOString(),
    }, { onConflict: "engine_instance_id" });
    if (instanceError) throw new Error(`Attention engine instance upsert failed: ${instanceError.message}`);
    const { data, error } = await this.client.rpc("acquire_attention_engine_lease", {
      p_engine_instance_id: identity.engineInstanceId,
      p_run_id: identity.runId,
      p_ttl_seconds: Math.ceil(ttlMs / 1000),
    });
    if (error) {
      if (error.message.toLowerCase().includes("attention runtime lease already held")) throw new Error(SUPABASE_LEASE_CONFLICT);
      throw new Error(`Attention runtime lease acquisition failed: ${error.message}`);
    }
    const row = (data as Array<{ fencing_token: number; lease_expires_at: string }> | null)?.[0];
    if (!row) throw new Error("Attention runtime lease acquisition returned no lease row.");
    return { engineInstanceId: identity.engineInstanceId, ownerRunId: identity.runId, fencingToken: row.fencing_token, acquiredAt: now, expiresAt: Date.parse(row.lease_expires_at) };
  }

  async renewLease(lease: WorkerLease, now: number, ttlMs: number): Promise<WorkerLease> {
    const { data, error } = await this.client.from("attention_engine_instances")
      .update({ lease_expires_at: new Date(now + ttlMs).toISOString(), heartbeat_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString() })
      .eq("engine_instance_id", lease.engineInstanceId).eq("owner_run_id", lease.ownerRunId).eq("fencing_token", lease.fencingToken)
      .select("fencing_token").single();
    if (error || !data) throw new Error(`Runtime lease fencing violation: ${error?.message ?? "no matching row"}`);
    return { ...lease, expiresAt: now + ttlMs };
  }

  async releaseLease(lease: WorkerLease): Promise<void> {
    const { error } = await this.client.from("attention_engine_instances")
      .update({ lease_expires_at: new Date(0).toISOString(), ready: false, health: "stopped", updated_at: new Date().toISOString() })
      .eq("engine_instance_id", lease.engineInstanceId).eq("owner_run_id", lease.ownerRunId).eq("fencing_token", lease.fencingToken);
    if (error) throw new Error(`Attention runtime lease release failed: ${error.message}`);
  }

  async readControls(engineInstanceId: string): Promise<RuntimeControls | null> {
    const { data, error } = await this.client.from("attention_runtime_controls").select("*").eq("engine_instance_id", engineInstanceId).maybeSingle();
    if (error) throw new Error(`Attention runtime controls read failed: ${error.message}`);
    if (!data) return null;
    return { version: Number(data.version), attentionLiveAlertingEnabled: data.attention_live_alerting_enabled, legacyAlertingEnabled: data.legacy_alerting_enabled, activeAlertEngine: data.active_alert_engine, updatedAt: Date.parse(data.updated_at), reason: data.reason };
  }

  async loadCheckpoint(): Promise<RuntimeCheckpoint | null> {
    const { data, error } = await this.client.from("attention_engine_checkpoints")
      .select("state").eq("engine_instance_id", this.identity.engineInstanceId)
      .order("sequence", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`Attention checkpoint read failed: ${error.message}`);
    if (data?.state) return data.state as RuntimeCheckpoint;
    return this.localMirror?.loadCheckpoint() ?? null;
  }

  async commitMinute(input: { lease: WorkerLease; checkpoint: RuntimeCheckpoint; snapshot: LiveAttentionSnapshot; events: readonly AttentionEvent[]; envelopes: readonly RuntimeDeliveryEnvelope[] }): Promise<void> {
    const { error } = await this.client.rpc("commit_attention_runtime_minute", {
      p_engine_instance_id: input.lease.engineInstanceId,
      p_run_id: input.lease.ownerRunId,
      p_fencing_token: input.lease.fencingToken,
      p_checkpoint: input.checkpoint,
      p_snapshot: input.snapshot,
      p_events: input.events,
      p_envelopes: input.envelopes,
    });
    if (error) throw new Error(`Attention runtime publish failed: ${error.message}`);
    await this.localMirror?.replicateMinute({ checkpoint: input.checkpoint, snapshot: input.snapshot, events: input.events, envelopes: input.envelopes });
  }

  async readSnapshot(engineInstanceId: string): Promise<LiveAttentionSnapshot | null> {
    const { data, error } = await this.client.from("attention_live_snapshots").select("snapshot").eq("engine_instance_id", engineInstanceId).maybeSingle();
    if (error) throw new Error(`Attention snapshot read failed: ${error.message}`);
    return data ? data.snapshot as LiveAttentionSnapshot : null;
  }

  async leaseOutbox(consumerId: string, now: number, limit: number, leaseMs: number): Promise<RuntimeDeliveryEnvelope[]> {
    const { data, error } = await this.client.rpc("lease_attention_outbox", { p_consumer_id: consumerId, p_now: new Date(now).toISOString(), p_limit: limit, p_lease_seconds: Math.ceil(leaseMs / 1000) });
    if (error) throw new Error(`Attention outbox lease failed: ${error.message}`);
    return (data ?? []) as RuntimeDeliveryEnvelope[];
  }
  async acknowledgeOutbox(id: string, consumerId: string, at: number, acknowledgement: string): Promise<void> {
    const { error } = await this.client.from("attention_delivery_outbox").update({ status: "delivered", delivered_at: new Date(at).toISOString(), provider_acknowledgement: acknowledgement, lease_owner: null, lease_expires_at: null }).eq("id", id).eq("lease_owner", consumerId);
    if (error) throw new Error(`Attention outbox acknowledgement failed: ${error.message}`);
  }
  async failOutbox(id: string, consumerId: string, at: number, errorMessage: string, nextAttemptAt: number | null): Promise<void> {
    const { error } = await this.client.rpc("fail_attention_outbox", { p_id: id, p_consumer_id: consumerId, p_at: new Date(at).toISOString(), p_error: errorMessage, p_next_attempt_at: nextAttemptAt === null ? null : new Date(nextAttemptAt).toISOString() });
    if (error) throw new Error(`Attention outbox failure update failed: ${error.message}`);
  }
}
