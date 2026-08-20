import { createHash } from "node:crypto";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import type {
  LiveAttentionSnapshot,
  RuntimeCheckpoint,
  RuntimeControls,
  RuntimeDeliveryEnvelope,
  RuntimeIdentity,
  RuntimeStore,
  WorkerLease,
} from "./contracts";

function clone<T>(value: T): T { return structuredClone(value); }

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalizeJson(record[key])]));
  }
  return value;
}

export function checkpointChecksum(checkpoint: Omit<RuntimeCheckpoint, "checksum">): string {
  // Supabase stores the checkpoint as jsonb, which does not preserve object-key insertion order.
  return createHash("sha256").update(JSON.stringify(canonicalizeJson(checkpoint))).digest("hex");
}

export function assertCheckpointCompatible(checkpoint: RuntimeCheckpoint, identity: RuntimeIdentity): void {
  const { checksum, ...unsigned } = checkpoint;
  if (checkpointChecksum(unsigned) !== checksum) throw new Error("Runtime checkpoint checksum mismatch.");
  for (const key of ["engineInstanceId", "userId", "universeHash", "calibrationId", "configHash", "baselineTableId", "feedMode"] as const) {
    if (checkpoint.identity[key] !== identity[key]) throw new Error(`Runtime checkpoint ${key} mismatch.`);
  }
}

export function canRollForwardEmptyLegacyCheckpoint(checkpoint: RuntimeCheckpoint, identity: RuntimeIdentity): boolean {
  for (const key of ["engineInstanceId", "userId", "universeHash", "calibrationId", "configHash", "baselineTableId", "feedMode"] as const) {
    if (checkpoint.identity[key] !== identity[key]) return false;
  }
  if (checkpoint.schemaVersion !== 1 || checkpoint.ingestionMode !== "iex_rest_polling") return false;
  if (checkpoint.processorState !== null || checkpoint.guard.active) return false;
  if (!checkpoint.deliveryState || typeof checkpoint.deliveryState !== "object") return false;
  const delivery = checkpoint.deliveryState as {
    sessionEvents?: unknown[];
    regularCountersStarted?: boolean;
    detectionCounters?: { detectionRanMinutes?: number; eventsDetected?: number };
  };
  return Array.isArray(delivery.sessionEvents)
    && delivery.sessionEvents.length === 0
    && delivery.regularCountersStarted !== true
    && delivery.detectionCounters?.detectionRanMinutes === 0
    && delivery.detectionCounters.eventsDetected === 0;
}

export class InMemoryRuntimeStore implements RuntimeStore {
  private lease: WorkerLease | null = null;
  private fencingToken = 0;
  private controls: RuntimeControls | null = null;
  private checkpoint: RuntimeCheckpoint | null = null;
  private snapshot: LiveAttentionSnapshot | null = null;
  readonly events: AttentionEvent[] = [];
  readonly outbox: RuntimeDeliveryEnvelope[] = [];

  setControls(controls: RuntimeControls): void { this.controls = clone(controls); }

  async acquireLease(identity: RuntimeIdentity, now: number, ttlMs: number): Promise<WorkerLease> {
    if (this.lease && this.lease.expiresAt > now && this.lease.ownerRunId !== identity.runId) {
      throw new Error(`Runtime lease is held by ${this.lease.ownerRunId}.`);
    }
    this.fencingToken += 1;
    this.lease = { engineInstanceId: identity.engineInstanceId, ownerRunId: identity.runId, fencingToken: this.fencingToken, acquiredAt: now, expiresAt: now + ttlMs };
    return clone(this.lease);
  }

  async renewLease(lease: WorkerLease, now: number, ttlMs: number): Promise<WorkerLease> {
    this.assertLease(lease, now);
    this.lease = { ...this.lease!, expiresAt: now + ttlMs };
    return clone(this.lease);
  }

  async releaseLease(lease: WorkerLease): Promise<void> {
    if (this.lease && this.lease.fencingToken === lease.fencingToken && this.lease.ownerRunId === lease.ownerRunId) this.lease = null;
  }

  async readControls(): Promise<RuntimeControls | null> { return this.controls ? clone(this.controls) : null; }
  async loadCheckpoint(): Promise<RuntimeCheckpoint | null> { return this.checkpoint ? clone(this.checkpoint) : null; }

  async commitMinute(input: { lease: WorkerLease; checkpoint: RuntimeCheckpoint; snapshot: LiveAttentionSnapshot; events: readonly AttentionEvent[]; envelopes: readonly RuntimeDeliveryEnvelope[] }): Promise<void> {
    this.assertLease(input.lease, input.snapshot.asOf);
    if (input.checkpoint.sequence !== input.snapshot.sequence) throw new Error("Checkpoint/snapshot sequence mismatch.");
    if (this.checkpoint && input.checkpoint.sequence <= this.checkpoint.sequence) throw new Error("Runtime sequence must be monotonic.");
    this.checkpoint = clone(input.checkpoint);
    this.snapshot = clone(input.snapshot);
    const eventIds = new Set(this.events.map((event) => event.eventId));
    for (const event of input.events) if (!eventIds.has(event.eventId)) { this.events.push(clone(event)); eventIds.add(event.eventId); }
    const envelopeIds = new Set(this.outbox.map((row) => row.idempotencyKey));
    for (const envelope of input.envelopes) {
      const existing = this.outbox.find((row) => row.idempotencyKey === envelope.idempotencyKey);
      if (!existing) { this.outbox.push(clone(envelope)); envelopeIds.add(envelope.idempotencyKey); }
      else if (existing.status === "pending" || existing.status === "retrying") {
        existing.eventIds = [...envelope.eventIds]; existing.message = envelope.message;
        existing.expiresAt = envelope.expiresAt; existing.nextAttemptAt = envelope.nextAttemptAt;
      }
    }
  }

  async readSnapshot(): Promise<LiveAttentionSnapshot | null> { return this.snapshot ? clone(this.snapshot) : null; }

  async leaseOutbox(consumerId: string, now: number, limit: number, leaseMs: number): Promise<RuntimeDeliveryEnvelope[]> {
    const available = this.outbox.filter((row) =>
      row.expiresAt > now && row.nextAttemptAt <= now &&
      (row.status === "pending" || row.status === "retrying" || (row.status === "leased" && (row.leaseExpiresAt ?? 0) <= now))
    ).slice(0, limit);
    for (const row of available) {
      row.status = "leased";
      row.leaseOwner = consumerId;
      row.leaseExpiresAt = now + leaseMs;
    }
    return clone(available);
  }

  async acknowledgeOutbox(id: string, consumerId: string, at: number, acknowledgement: string): Promise<void> {
    const row = this.requireLeased(id, consumerId);
    row.status = "delivered"; row.deliveredAt = at; row.providerAcknowledgement = acknowledgement; row.leaseOwner = null; row.leaseExpiresAt = null;
  }

  async failOutbox(id: string, consumerId: string, at: number, error: string, nextAttemptAt: number | null): Promise<void> {
    const row = this.requireLeased(id, consumerId);
    row.attemptCount += 1; row.lastError = error; row.leaseOwner = null; row.leaseExpiresAt = null;
    row.status = nextAttemptAt === null || nextAttemptAt >= row.expiresAt ? "failed" : "retrying";
    row.nextAttemptAt = nextAttemptAt ?? at;
  }

  private assertLease(lease: WorkerLease, now: number): void {
    if (!this.lease || this.lease.ownerRunId !== lease.ownerRunId || this.lease.fencingToken !== lease.fencingToken || this.lease.expiresAt <= now) {
      throw new Error("Runtime lease fencing violation.");
    }
  }

  private requireLeased(id: string, consumerId: string): RuntimeDeliveryEnvelope {
    const row = this.outbox.find((entry) => entry.id === id);
    if (!row || row.status !== "leased" || row.leaseOwner !== consumerId) throw new Error("Outbox lease ownership mismatch.");
    return row;
  }
}

