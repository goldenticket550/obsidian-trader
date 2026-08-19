import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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

interface FileState {
  schemaVersion: 1;
  fencingToken: number;
  lease: WorkerLease | null;
  controls: RuntimeControls | null;
  checkpoint: RuntimeCheckpoint | null;
  snapshot: LiveAttentionSnapshot | null;
  events: AttentionEvent[];
  outbox: RuntimeDeliveryEnvelope[];
}

const EMPTY: FileState = { schemaVersion: 1, fencingToken: 0, lease: null, controls: null, checkpoint: null, snapshot: null, events: [], outbox: [] };

export class JsonFileRuntimeStore implements RuntimeStore {
  constructor(private readonly path: string) { mkdirSync(dirname(path), { recursive: true }); }

  setControls(controls: RuntimeControls): void { const state = this.read(); state.controls = structuredClone(controls); this.write(state); }

  async acquireLease(identity: RuntimeIdentity, now: number, ttlMs: number): Promise<WorkerLease> {
    const state = this.read();
    if (state.lease && state.lease.expiresAt > now && state.lease.ownerRunId !== identity.runId) throw new Error(`Runtime lease is held by ${state.lease.ownerRunId}.`);
    state.fencingToken += 1;
    state.lease = { engineInstanceId: identity.engineInstanceId, ownerRunId: identity.runId, fencingToken: state.fencingToken, acquiredAt: now, expiresAt: now + ttlMs };
    this.write(state); return structuredClone(state.lease);
  }

  async renewLease(lease: WorkerLease, now: number, ttlMs: number): Promise<WorkerLease> {
    const state = this.read(); this.assertLease(state, lease, now); state.lease = { ...state.lease!, expiresAt: now + ttlMs }; this.write(state); return structuredClone(state.lease);
  }

  async releaseLease(lease: WorkerLease): Promise<void> {
    const state = this.read(); if (state.lease?.ownerRunId === lease.ownerRunId && state.lease.fencingToken === lease.fencingToken) { state.lease = null; this.write(state); }
  }

  async readControls(): Promise<RuntimeControls | null> { return structuredClone(this.read().controls); }
  async loadCheckpoint(): Promise<RuntimeCheckpoint | null> { return structuredClone(this.read().checkpoint); }

  async commitMinute(input: { lease: WorkerLease; checkpoint: RuntimeCheckpoint; snapshot: LiveAttentionSnapshot; events: readonly AttentionEvent[]; envelopes: readonly RuntimeDeliveryEnvelope[] }): Promise<void> {
    const state = this.read(); this.assertLease(state, input.lease, input.snapshot.asOf);
    if (input.checkpoint.sequence !== input.snapshot.sequence) throw new Error("Checkpoint/snapshot sequence mismatch.");
    if (state.checkpoint && input.checkpoint.sequence <= state.checkpoint.sequence) throw new Error("Runtime sequence must be monotonic.");
    state.checkpoint = structuredClone(input.checkpoint); state.snapshot = structuredClone(input.snapshot);
    const eventIds = new Set(state.events.map((row) => row.eventId)); for (const event of input.events) if (!eventIds.has(event.eventId)) { state.events.push(structuredClone(event)); eventIds.add(event.eventId); }
    const keys = new Set(state.outbox.map((row) => row.idempotencyKey));
    for (const envelope of input.envelopes) {
      const existing = state.outbox.find((row) => row.idempotencyKey === envelope.idempotencyKey);
      if (!existing) { state.outbox.push(structuredClone(envelope)); keys.add(envelope.idempotencyKey); }
      else if (existing.status === "pending" || existing.status === "retrying") {
        existing.eventIds = [...envelope.eventIds]; existing.message = envelope.message;
        existing.expiresAt = envelope.expiresAt; existing.nextAttemptAt = envelope.nextAttemptAt;
      }
    }
    this.write(state);
  }

  async replicateMinute(input: { checkpoint: RuntimeCheckpoint; snapshot: LiveAttentionSnapshot; events: readonly AttentionEvent[]; envelopes: readonly RuntimeDeliveryEnvelope[] }): Promise<void> {
    const state = this.read();
    if (state.checkpoint && input.checkpoint.sequence < state.checkpoint.sequence) throw new Error("Runtime sequence must be monotonic.");
    if (state.checkpoint?.sequence === input.checkpoint.sequence && state.checkpoint.checksum === input.checkpoint.checksum) return;
    state.checkpoint = structuredClone(input.checkpoint);
    state.snapshot = structuredClone(input.snapshot);
    const eventIds = new Set(state.events.map((row) => row.eventId));
    for (const event of input.events) if (!eventIds.has(event.eventId)) { state.events.push(structuredClone(event)); eventIds.add(event.eventId); }
    for (const envelope of input.envelopes) {
      const existing = state.outbox.find((row) => row.idempotencyKey === envelope.idempotencyKey);
      if (!existing) state.outbox.push(structuredClone(envelope));
      else if (existing.status === "pending" || existing.status === "retrying") Object.assign(existing, structuredClone(envelope));
    }
    this.write(state);
  }
  async readSnapshot(): Promise<LiveAttentionSnapshot | null> { return structuredClone(this.read().snapshot); }

  async leaseOutbox(consumerId: string, now: number, limit: number, leaseMs: number): Promise<RuntimeDeliveryEnvelope[]> {
    const state = this.read(); const rows = state.outbox.filter((row) => row.expiresAt > now && row.nextAttemptAt <= now && (row.status === "pending" || row.status === "retrying" || (row.status === "leased" && (row.leaseExpiresAt ?? 0) <= now))).slice(0, limit);
    for (const row of rows) { row.status = "leased"; row.leaseOwner = consumerId; row.leaseExpiresAt = now + leaseMs; }
    this.write(state); return structuredClone(rows);
  }

  async acknowledgeOutbox(id: string, consumerId: string, at: number, acknowledgement: string): Promise<void> {
    const state = this.read(), row = this.requireLeased(state, id, consumerId); row.status = "delivered"; row.deliveredAt = at; row.providerAcknowledgement = acknowledgement; row.leaseOwner = null; row.leaseExpiresAt = null; this.write(state);
  }

  async failOutbox(id: string, consumerId: string, at: number, error: string, nextAttemptAt: number | null): Promise<void> {
    const state = this.read(), row = this.requireLeased(state, id, consumerId); row.attemptCount += 1; row.lastError = error; row.leaseOwner = null; row.leaseExpiresAt = null; row.status = nextAttemptAt === null || nextAttemptAt >= row.expiresAt ? "failed" : "retrying"; row.nextAttemptAt = nextAttemptAt ?? at; this.write(state);
  }

  private read(): FileState { return existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) as FileState : structuredClone(EMPTY); }
  private write(state: FileState): void { const temporary = this.path + ".tmp"; writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n"); renameSync(temporary, this.path); }
  private assertLease(state: FileState, lease: WorkerLease, now: number): void { if (!state.lease || state.lease.ownerRunId !== lease.ownerRunId || state.lease.fencingToken !== lease.fencingToken || state.lease.expiresAt <= now) throw new Error("Runtime lease fencing violation."); }
  private requireLeased(state: FileState, id: string, consumerId: string): RuntimeDeliveryEnvelope { const row = state.outbox.find((entry) => entry.id === id); if (!row || row.status !== "leased" || row.leaseOwner !== consumerId) throw new Error("Outbox lease ownership mismatch."); return row; }
}

