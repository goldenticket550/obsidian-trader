import { createHash } from "node:crypto";
import { DEFAULT_ALERT_DELIVERY_RATE_CONFIG, type AttentionAlertDelivery } from "@/lib/attention/alertDelivery";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import { compactAttentionAlertDeliveriesIncremental, emptyIncrementalAlertDeliveryState, trimIncrementalAlertDeliveryState, type IncrementalAlertDeliveryState } from "@/lib/attention/incrementalAlertDelivery";
import { exchangeCalendarDay } from "@/lib/attention/exchangeCalendar";
import { assertCheckpointCompatible, checkpointChecksum } from "./inMemoryStore";
import type { LiveIngestionSource } from "./ingestion";
import type {
  LiveAttentionSnapshot,
  LiveMinuteBatch,
  RuntimeCheckpoint,
  RuntimeDetectionCounters,
  RuntimeDetectionSuppressionReason,
  RuntimeControls,
  RuntimeDeliveryEnvelope,
  RuntimeCycleStageTimings,
  RuntimeIdentity,
  RuntimeProcessorResult,
  RuntimeStore,
  WorkerLease,
} from "./contracts";

export interface AttentionRuntimeProcessor {
  restore(state: unknown): void;
  process(batch: LiveMinuteBatch, controls: RuntimeControls): Promise<RuntimeProcessorResult>;
}

interface DeliveryCheckpointState {
  sessionEvents: AttentionEvent[];
  detectionCounters: RuntimeDetectionCounters;
  compactionState: IncrementalAlertDeliveryState;
  tradingDate: string | null;
  regularCountersStarted: boolean;
}

function emptyDetectionCounters(): RuntimeDetectionCounters {
  return {
    processedMinutes: 0,
    detectionRanMinutes: 0,
    guardSuppressedByReason: {},
    incompleteBatchMinutes: 0,
    nonRegularMinutes: 0,
    eventsDetected: 0,
  };
}

function detectionSuppressionReason(batch: LiveMinuteBatch, regular: boolean): RuntimeDetectionSuppressionReason | null {
  if (!regular) return "non_regular";
  if (batch.guard.active) return batch.guard.reason === "none" ? "partial_batch" : batch.guard.reason;
  if (!batch.complete) return "incomplete_batch";
  return null;
}

function recordDetectionMinute(
  counters: RuntimeDetectionCounters,
  reason: RuntimeDetectionSuppressionReason | null,
  eventCount: number,
): void {
  counters.processedMinutes += 1;
  if (reason === null) {
    counters.detectionRanMinutes += 1;
    counters.eventsDetected += eventCount;
  } else if (reason === "non_regular") {
    counters.nonRegularMinutes += 1;
  } else if (reason === "incomplete_batch") {
    counters.incompleteBatchMinutes += 1;
  } else {
    counters.guardSuppressedByReason[reason] = (counters.guardSuppressedByReason[reason] ?? 0) + 1;
  }
}

export function trimSessionEventsForDelivery(
  events: readonly AttentionEvent[],
  throughAt: number,
  windowMinutes = DEFAULT_ALERT_DELIVERY_RATE_CONFIG.alertRateWindowMinutes,
): AttentionEvent[] {
  const cutoff = throughAt - 2 * windowMinutes * 60_000;
  return events.filter((event) => event.emittedAt > cutoff);
}

export function deliveriesQualifiedAtMinute(
  deliveries: readonly AttentionAlertDelivery[],
  sessionEvents: readonly AttentionEvent[],
  at: number,
): AttentionAlertDelivery[] {
  const eventsById = new Map(sessionEvents.map((event) => [event.eventId, event]));
  return deliveries.filter((delivery) => {
    if (delivery.at !== at) return false;
    const eventIds = delivery.kind === "alert" ? [delivery.event.eventId] : delivery.eventIds;
    return eventIds.length > 0 && eventIds.every((eventId) => eventsById.get(eventId)?.qualifiedAt === at);
  });
}

export interface AttentionWorkerConfig {
  identity: RuntimeIdentity;
  leaseTtlMs?: number;
  shadow: boolean;
}

function envelopeFromDelivery(identity: RuntimeIdentity, delivery: AttentionAlertDelivery): RuntimeDeliveryEnvelope {
  const eventIds = delivery.kind === "alert" ? [delivery.event.eventId] : delivery.eventIds;
  const title = delivery.kind === "alert"
    ? `NOW IN PLAY — ${delivery.event.symbol}`
    : delivery.tier === "primary" ? "More names entered IN PLAY" : "Attention context update";
  const message = delivery.kind === "alert"
    ? `${delivery.event.symbol} · attention ${delivery.event.payload.attentionScore.toFixed(1)} · ${delivery.event.payload.notice}`
    : delivery.message;
  const expiresAt = delivery.at + 60 * 60_000;
  const nextAttemptAt = delivery.kind === "digest" ? delivery.at + 15 * 60_000 : delivery.at;
  return {
    id: delivery.deliveryId,
    idempotencyKey: `${identity.engineInstanceId}:${delivery.deliveryId}`,
    engineInstanceId: identity.engineInstanceId,
    tier: delivery.tier,
    kind: delivery.kind,
    createdAt: delivery.at,
    expiresAt,
    eventIds: [...eventIds],
    title,
    message,
    fullListHref: delivery.kind === "digest" ? delivery.fullListHref : "/attention?view=in-play",
    status: "pending",
    attemptCount: 0,
    nextAttemptAt,
    leaseOwner: null,
    leaseExpiresAt: null,
    deliveredAt: null,
    lastError: null,
    providerAcknowledgement: null,
  };
}

function emptyDeliveryCheckpointState(): DeliveryCheckpointState {
  return {
    sessionEvents: [],
    detectionCounters: emptyDetectionCounters(),
    compactionState: emptyIncrementalAlertDeliveryState(),
    tradingDate: null,
    regularCountersStarted: false,
  };
}

function deliveryState(value: unknown): DeliveryCheckpointState {
  if (!value || typeof value !== "object") return emptyDeliveryCheckpointState();
  const candidate = value as Partial<DeliveryCheckpointState>;
  return {
    sessionEvents: Array.isArray(candidate.sessionEvents) ? structuredClone(candidate.sessionEvents) : [],
    detectionCounters: candidate.detectionCounters
      ? structuredClone(candidate.detectionCounters)
      : emptyDetectionCounters(),
    compactionState: candidate.compactionState
      ? structuredClone(candidate.compactionState)
      : emptyIncrementalAlertDeliveryState(),
    tradingDate: typeof candidate.tradingDate === "string" ? candidate.tradingDate : null,
    regularCountersStarted: candidate.regularCountersStarted === true,
  };
}

export class AttentionLiveWorker {
  private lease: WorkerLease | null = null;
  private sequence = 0;
  private delivery: DeliveryCheckpointState = emptyDeliveryCheckpointState();

  private processorState: unknown = null;
  constructor(
    private readonly store: RuntimeStore,
    private readonly source: LiveIngestionSource,
    private readonly processor: AttentionRuntimeProcessor,
    private readonly config: AttentionWorkerConfig,
  ) {}

  async start(now = Date.now()): Promise<void> {
    this.lease = await this.store.acquireLease(this.config.identity, now, this.config.leaseTtlMs ?? 90_000);
    const checkpoint = await this.store.loadCheckpoint(this.config.identity);
    if (!checkpoint) return;
    assertCheckpointCompatible(checkpoint, this.config.identity);
    this.sequence = checkpoint.sequence;
    this.delivery = deliveryState(checkpoint.deliveryState);
    this.processor.restore(checkpoint.processorState);
    this.processorState = structuredClone(checkpoint.processorState);
  }

  async stop(): Promise<void> {
    if (this.lease) await this.store.releaseLease(this.lease);
    this.lease = null;
  }

  async runOnce(now = Date.now()): Promise<LiveAttentionSnapshot> {
    const cycleStartedAt = performance.now();
    if (!this.lease) throw new Error("Attention worker is not started.");
    this.lease = await this.store.renewLease(this.lease, now, this.config.leaseTtlMs ?? 90_000);
    const controls = await this.store.readControls(this.config.identity.engineInstanceId);
    const failClosed = !controls || controls.updatedAt > now || now - controls.updatedAt > 5 * 60_000;
    const effective: RuntimeControls = failClosed ? {
      version: 1,
      attentionLiveAlertingEnabled: false,
      legacyAlertingEnabled: true,
      activeAlertEngine: "legacy",
      updatedAt: now,
      reason: "missing_stale_or_invalid_control",
    } : controls;
    const processorTimings = { baselineResolutionMs: 0, axisComputationMs: 0, scoringMs: 0, stateMachineMs: 0, episodeEventMs: 0 };
    const accumulateProcessorTimings = (value: RuntimeProcessorResult): void => {
      if (!value.stageTimings) return;
      processorTimings.baselineResolutionMs += value.stageTimings.baselineResolutionMs;
      processorTimings.axisComputationMs += value.stageTimings.axisComputationMs;
      processorTimings.scoringMs += value.stageTimings.scoringMs;
      processorTimings.stateMachineMs += value.stageTimings.stateMachineMs;
      processorTimings.episodeEventMs += value.stageTimings.episodeEventMs;
    };
    const batch = await this.source.readCompletedMinute(now);
    const priorSnapshot = this.sequence > 0
      ? await this.store.readSnapshot(this.config.identity.engineInstanceId)
      : null;
    if (priorSnapshot && batch.at <= priorSnapshot.asOf) return priorSnapshot;
    const rollback = { sequence: this.sequence, delivery: structuredClone(this.delivery), processorState: structuredClone(this.processorState) };
    const calendar = exchangeCalendarDay(batch.tradingDate);
    const regular = calendar.isTradingDay && batch.minuteOfDay >= 570 && batch.minuteOfDay < calendar.regularCloseMinutes!;
    if (this.delivery.tradingDate !== batch.tradingDate) {
      this.delivery.tradingDate = batch.tradingDate;
      this.delivery.sessionEvents = [];
      this.delivery.compactionState = emptyIncrementalAlertDeliveryState();
      this.delivery.detectionCounters = emptyDetectionCounters();
      this.delivery.regularCountersStarted = false;
    }
    if (priorSnapshot && regular && batch.at - priorSnapshot.asOf > 60_000) {
      const missingMinutes = Math.floor((batch.at - priorSnapshot.asOf) / 60_000) - 1;
      const oldestAvailable = Math.min(...Object.values(batch.barsBySymbol).flat().map((bar) => bar.time * 1000));
      if (!Number.isFinite(oldestAvailable) || oldestAvailable > priorSnapshot.asOf + 60_000) {
        throw new Error("Gap reconciliation cannot prove a contiguous minute after the durable watermark.");
      }
      const recoveryControls = { ...effective, attentionLiveAlertingEnabled: false, activeAlertEngine: "legacy" as const, reason: "gap_reconciliation_no_catch_up_alerts" };
      for (let at = priorSnapshot.asOf + 60_000; at < batch.at; at += 60_000) {
        const ttl = this.config.leaseTtlMs ?? 90_000;
        if (this.lease && Date.now() >= this.lease.expiresAt - Math.floor(ttl / 2)) {
          this.lease = await this.store.renewLease(this.lease, Date.now(), ttl);
        }
        const barsBySymbol = Object.fromEntries(Object.entries(batch.barsBySymbol).map(([symbol, bars]) => [symbol, bars.filter((bar) => bar.time * 1000 <= at)]));
        const latestBarBySymbol = Object.fromEntries(Object.entries(barsBySymbol).map(([symbol, bars]) => [symbol, bars.at(-1) ?? null]));
        const recoveryResult = await this.processor.process({ ...batch, at, minuteOfDay: batch.minuteOfDay - Math.round((batch.at - at) / 60_000), barsBySymbol, latestBarBySymbol, guard: { active: true, reason: "gap_reconciliation", activeSince: priorSnapshot.asOf + 60_000, contiguousMinutes: Math.round((at - priorSnapshot.asOf) / 60_000), requiredContiguousMinutes: 5 } }, recoveryControls);
        accumulateProcessorTimings(recoveryResult);
        this.processorState = structuredClone(recoveryResult.processorState);
        recordDetectionMinute(this.delivery.detectionCounters, "gap_reconciliation", 0);
      }
      batch.audit.push(`gap_reconciled_minutes=${missingMinutes}`, "catch_up_alerts=disabled");
    }

    if (regular && !this.delivery.regularCountersStarted) {
      this.delivery.detectionCounters = emptyDetectionCounters();
      this.delivery.regularCountersStarted = true;
    }
    let result: RuntimeProcessorResult = { rows: [], events: [], processorState: this.processorState, statusMessage: "Unavailable on partial feed" };
    const suppressionReason = detectionSuppressionReason(batch, regular);
    if (suppressionReason === null) {
      result = await this.processor.process(batch, effective);
      accumulateProcessorTimings(result);
      this.processorState = structuredClone(result.processorState);
    }

    const detectionValid = suppressionReason === null;
    const events = detectionValid ? result.events : [];
    recordDetectionMinute(this.delivery.detectionCounters, suppressionReason, events.length);
    const deliveryEnabled = !this.config.shadow && effective.attentionLiveAlertingEnabled &&
      effective.activeAlertEngine === "attention" && detectionValid;
    this.delivery.sessionEvents.push(...events);
    const compacted = compactAttentionAlertDeliveriesIncremental(this.delivery.sessionEvents, this.delivery.compactionState);
    this.delivery.compactionState = compacted.state;
    const currentMinuteDeliveries = deliveriesQualifiedAtMinute(compacted.deliveries, this.delivery.sessionEvents, batch.at);
    const envelopes = deliveryEnabled
      ? currentMinuteDeliveries.map((row) => envelopeFromDelivery(this.config.identity, row))
      : [];
    this.delivery.sessionEvents = trimSessionEventsForDelivery(this.delivery.sessionEvents, batch.at);
    this.delivery.compactionState = trimIncrementalAlertDeliveryState(this.delivery.compactionState, this.delivery.sessionEvents, batch.at);
    this.sequence += 1;
    const watermarkLagMs = Math.max(0, Date.now() - (batch.at + 60_000));
    const preCommitCycleMs = performance.now() - cycleStartedAt;
    const cycleTimings: RuntimeCycleStageTimings = {
      providerFetchMs: batch.stageTimings?.providerFetchMs ?? 0,
      barReconciliationMs: batch.stageTimings?.barReconciliationMs ?? 0,
      baselineResolutionMs: processorTimings.baselineResolutionMs,
      axisComputationMs: processorTimings.axisComputationMs,
      scoringMs: processorTimings.scoringMs,
      stateMachineMs: processorTimings.stateMachineMs,
      episodeEventMs: processorTimings.episodeEventMs,
      checkpointWriteMs: 0,
      snapshotPublishMs: 0,
      totalCycleMs: preCommitCycleMs,
    };
    const cycleBudgetExceeded = preCommitCycleMs > 20_000;
    const lagWarning = preCommitCycleMs > 60_000 || watermarkLagMs > 60_000;

    const snapshot: LiveAttentionSnapshot = {
      schemaVersion: 1,
      engineInstanceId: this.config.identity.engineInstanceId,
      runId: this.config.identity.runId,
      sequence: this.sequence,
      asOf: batch.at,
      tradingDate: batch.tradingDate,
      minuteOfDay: batch.minuteOfDay,
      health: !regular ? "dark_window" : batch.guard.active || !batch.complete || cycleBudgetExceeded || lagWarning ? "degraded" : "ready",
      ready: regular && batch.complete && !batch.guard.active,
      shadow: this.config.shadow,
      liveDeliveryEnabled: deliveryEnabled,
      legacyAlertingEnabled: effective.legacyAlertingEnabled,
      ingestionMode: batch.mode,
      feedMode: "iex_partial",
      feedBadge: "IEX PARTIAL",
      calibrationId: this.config.identity.calibrationId,
      baselineTableId: this.config.identity.baselineTableId,
      darkWindowReason: regular ? null : "unavailable_on_partial_feed",
      guard: structuredClone(batch.guard),
      rankedRows: regular ? result.rows : [],
      eventsDetected: events.length,
      envelopesCreated: envelopes.length,
      detectionStatus: detectionValid ? "ran" : "suppressed",
      detectionSuppressionReason: suppressionReason,
      detectionCounters: structuredClone(this.delivery.detectionCounters),
      statusMessage: this.config.shadow
        ? `SHADOW — ALERTING DISABLED. ${result.statusMessage}`
        : result.statusMessage,
      cycleTimings,
      cycleBudgetExceeded,
      watermarkLagMs,
      lagWarning,
    };
    const unsigned: Omit<RuntimeCheckpoint, "checksum"> = {
      schemaVersion: 1,
      identity: this.config.identity,
      sequence: this.sequence,
      watermarkAt: batch.at,
      createdAt: now,
      ingestionMode: batch.mode,
      guard: structuredClone(batch.guard),
      processorState: this.processorState,
      deliveryState: structuredClone(this.delivery),
    };
    const checkpoint: RuntimeCheckpoint = { ...unsigned, checksum: checkpointChecksum(unsigned) };
    const commitTtl = this.config.leaseTtlMs ?? 90_000;
    if (Date.now() >= this.lease.expiresAt - Math.floor(commitTtl / 2)) {
      this.lease = await this.store.renewLease(this.lease, Date.now(), commitTtl);
    }
    const commitStartedAt = performance.now();
    try {
      await this.store.commitMinute({ lease: this.lease, checkpoint, snapshot, events, envelopes });
    } catch (error) {
      this.sequence = rollback.sequence;
      this.delivery = rollback.delivery;
      this.processorState = rollback.processorState;
      this.processor.restore(rollback.processorState);
      throw error;
    }
    snapshot.cycleTimings.checkpointWriteMs = performance.now() - commitStartedAt;
    snapshot.cycleTimings.totalCycleMs = performance.now() - cycleStartedAt;
    snapshot.cycleBudgetExceeded = snapshot.cycleTimings.totalCycleMs > 20_000;
    snapshot.lagWarning = snapshot.cycleTimings.totalCycleMs > 60_000 || snapshot.watermarkLagMs > 60_000;
    if (snapshot.cycleBudgetExceeded || snapshot.lagWarning) snapshot.health = "degraded";
    return snapshot;
  }
}

export function runtimeIdentityHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
