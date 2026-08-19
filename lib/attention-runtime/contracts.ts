import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import type { AttentionFeedMode } from "@/lib/attention/attentionScore";
import type { AttentionDataQualityState } from "@/lib/attention/dataQuality";
import type { Candle } from "@/types/candle";

export type LiveIngestionMode = "iex_websocket" | "iex_rest_polling" | "mock";
export type RuntimeHealth = "starting" | "ready" | "degraded" | "dark_window" | "stopped";
export type RuntimeAlertEngine = "legacy" | "attention";

export interface RuntimeControls {
  version: number;
  attentionLiveAlertingEnabled: boolean;
  legacyAlertingEnabled: boolean;
  activeAlertEngine: RuntimeAlertEngine;
  updatedAt: number;
  reason: string;
}

export const FAIL_CLOSED_RUNTIME_CONTROLS: RuntimeControls = {
  version: 1,
  attentionLiveAlertingEnabled: false,
  legacyAlertingEnabled: true,
  activeAlertEngine: "legacy",
  updatedAt: 0,
  reason: "missing_or_unreadable_control",
};

export interface RuntimeIdentity {
  engineInstanceId: string;
  runId: string;
  userId: string;
  universeHash: string;
  calibrationId: string;
  configHash: string;
  baselineTableId: string;
  feedMode: AttentionFeedMode;
}

export interface WorkerLease {
  engineInstanceId: string;
  ownerRunId: string;
  fencingToken: number;
  acquiredAt: number;
  expiresAt: number;
}

export type RuntimeDetectionSuppressionReason =
  | Exclude<IngestionGuardState["reason"], "none">
  | "incomplete_batch"
  | "non_regular";

export interface RuntimeDetectionCounters {
  processedMinutes: number;
  detectionRanMinutes: number;
  guardSuppressedByReason: Partial<Record<Exclude<IngestionGuardState["reason"], "none">, number>>;
  incompleteBatchMinutes: number;
  nonRegularMinutes: number;
  eventsDetected: number;
}

export interface IngestionGuardState {
  active: boolean;
  reason:
    | "none"
    | "capability_probe_failed"
    | "stream_disconnected"
    | "poll_failed"
    | "poll_stale"
    | "partial_batch"
    | "gap_reconciliation"
    | "halt_resume_inferred";
  activeSince: number | null;
  contiguousMinutes: number;
  requiredContiguousMinutes: number;
}

export interface LiveMinuteBatch {
  at: number;
  tradingDate: string;
  minuteOfDay: number;
  mode: LiveIngestionMode;
  requestedSymbols: string[];
  barsBySymbol: Record<string, Candle[]>;
  priorSessionRegularBarsBySymbol?: Record<string, Candle[]>;
  latestBarBySymbol: Record<string, Candle | null>;
  responseFeed: "iex" | "mock";
  complete: boolean;
  staleSymbols: string[];
  missingSymbols: string[];
  guard: IngestionGuardState;
  audit: string[];
  stageTimings?: Pick<RuntimeCycleStageTimings, "providerFetchMs" | "barReconciliationMs">;
}
export interface RuntimeCycleStageTimings {
  providerFetchMs: number;
  barReconciliationMs: number;
  baselineResolutionMs: number;
  axisComputationMs: number;
  scoringMs: number;
  stateMachineMs: number;
  episodeEventMs: number;
  checkpointWriteMs: number;
  snapshotPublishMs: number;
  totalCycleMs: number;
}

export interface LiveAttentionRow {
  symbol: string;
  attentionScore: number | null;
  core: number | null;
  state: string | null;
  freshness: string | null;
  rank: number | null;
  dataQualityState: AttentionDataQualityState | "insufficient_reference";
  dataQualityReason: string;
  feedBadge: "IEX PARTIAL";
  pendingTransition: "none" | "promoting" | "exiting";
  pendingTransitionMinutes: number;
}

export interface LiveAttentionSnapshot {
  schemaVersion: 1;
  engineInstanceId: string;
  runId: string;
  sequence: number;
  asOf: number;
  tradingDate: string;
  minuteOfDay: number;
  health: RuntimeHealth;
  ready: boolean;
  shadow: boolean;
  liveDeliveryEnabled: boolean;
  legacyAlertingEnabled: boolean;
  ingestionMode: LiveIngestionMode;
  feedMode: "iex_partial";
  feedBadge: "IEX PARTIAL";
  calibrationId: string;
  baselineTableId: string;
  darkWindowReason: "unavailable_on_partial_feed" | null;
  guard: IngestionGuardState;
  rankedRows: LiveAttentionRow[];
  eventsDetected: number;
  detectionStatus: "ran" | "suppressed";
  detectionSuppressionReason: RuntimeDetectionSuppressionReason | null;
  detectionCounters: RuntimeDetectionCounters;
  envelopesCreated: number;
  statusMessage: string;
  cycleTimings: RuntimeCycleStageTimings;
  cycleBudgetExceeded: boolean;
  watermarkLagMs: number;
  lagWarning: boolean;
}

export interface RuntimeCheckpoint {
  schemaVersion: 1;
  identity: RuntimeIdentity;
  sequence: number;
  watermarkAt: number;
  createdAt: number;
  ingestionMode: LiveIngestionMode;
  guard: IngestionGuardState;
  processorState: unknown;
  deliveryState: unknown;
  checksum: string;
}

export type DeliveryTier = "primary" | "secondary";
export type DeliveryOutboxStatus = "pending" | "leased" | "delivered" | "retrying" | "failed";

export interface RuntimeDeliveryEnvelope {
  id: string;
  idempotencyKey: string;
  engineInstanceId: string;
  tier: DeliveryTier;
  kind: "alert" | "digest";
  createdAt: number;
  expiresAt: number;
  eventIds: string[];
  title: string;
  message: string;
  fullListHref: string;
  status: DeliveryOutboxStatus;
  attemptCount: number;
  nextAttemptAt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  deliveredAt: number | null;
  lastError: string | null;
  providerAcknowledgement: string | null;
}

export interface RuntimeProcessorResult {
  rows: LiveAttentionRow[];
  events: AttentionEvent[];
  processorState: unknown;
  stageTimings?: Pick<RuntimeCycleStageTimings, "baselineResolutionMs" | "axisComputationMs" | "scoringMs" | "stateMachineMs" | "episodeEventMs">;
  statusMessage: string;
}

export interface RuntimeStore {
  setControls(controls: RuntimeControls): Promise<void> | void;
  acquireLease(identity: RuntimeIdentity, now: number, ttlMs: number): Promise<WorkerLease>;
  renewLease(lease: WorkerLease, now: number, ttlMs: number): Promise<WorkerLease>;
  releaseLease(lease: WorkerLease): Promise<void>;
  readControls(engineInstanceId: string): Promise<RuntimeControls | null>;
  loadCheckpoint(identity: RuntimeIdentity): Promise<RuntimeCheckpoint | null>;
  commitMinute(input: {
    lease: WorkerLease;
    checkpoint: RuntimeCheckpoint;
    snapshot: LiveAttentionSnapshot;
    events: readonly AttentionEvent[];
    envelopes: readonly RuntimeDeliveryEnvelope[];
  }): Promise<void>;
  readSnapshot(engineInstanceId: string): Promise<LiveAttentionSnapshot | null>;
  leaseOutbox(consumerId: string, now: number, limit: number, leaseMs: number): Promise<RuntimeDeliveryEnvelope[]>;
  acknowledgeOutbox(id: string, consumerId: string, at: number, acknowledgement: string): Promise<void>;
  failOutbox(id: string, consumerId: string, at: number, error: string, nextAttemptAt: number | null): Promise<void>;
}

