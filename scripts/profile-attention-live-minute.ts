import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { JsonFileRuntimeStore } from "../lib/attention-runtime/jsonFileStore";
import { RestIexPollingSource } from "../lib/attention-runtime/ingestion";
import { CalibratedIexAttentionProcessor, type IexHistoricalSessionBars } from "../lib/attention-runtime/iexProcessor";
import { checkpointChecksum } from "../lib/attention-runtime/inMemoryStore";
import type { LiveAttentionSnapshot, RuntimeCheckpoint, RuntimeControls, RuntimeCycleStageTimings } from "../lib/attention-runtime/contracts";
import { runtimeIdentityHash } from "../lib/attention-runtime/worker";
import { AlpacaProvider } from "../lib/market-data/providers/alpacaProvider";
import { alpacaCredentials } from "../lib/replay/env";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";

function loadHistory(): IexHistoricalSessionBars[] {
  const directory = resolve("data/replay/calibration/sessions/iex_partial");
  return readdirSync(directory).filter((name) => name.endsWith(".json.gz")).sort().map((name) => {
    const payload = JSON.parse(gunzipSync(readFileSync(resolve(directory, name))).toString("utf8"));
    if (payload.feed !== "iex" || payload.adjustment !== "split") throw new Error(`Invalid IEX calibration session ${name}.`);
    return { tradingDate: payload.tradingDate, bars: payload.bars } as IexHistoricalSessionBars;
  });
}

function round(value: number): number { return Math.round(value * 100) / 100; }

async function main(): Promise<void> {
  const startedAt = performance.now();
  const now = Date.now();
  const symbols = ATTENTION_UNIVERSE.map((entry) => entry.symbol);
  const thresholds = JSON.parse(readFileSync(resolve("data/replay/reports/attention-thresholds.json"), "utf8")) as FeedAwareAttentionThresholdStore;
  const calibrationId = thresholds.sets.iex_partial.regular.calibrationId;
  const credentials = alpacaCredentials();
  const provider = new AlpacaProvider({ ...credentials, feed: "iex", isPaidPlan: false }, undefined, 10_000, 12, 350);
  const source = new RestIexPollingSource(provider, symbols, 120);
  const processor = new CalibratedIexAttentionProcessor(thresholds, loadHistory());
  const controls: RuntimeControls = { version: 1, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true, activeAlertEngine: "legacy", updatedAt: now, reason: "unoptimized_profile" };

  const batch = await source.readCompletedMinute(now);
  const result = await processor.process(batch, controls);
  const identity = {
    engineInstanceId: "attention-profile-unoptimized",
    runId: randomUUID(),
    userId: "local-profile",
    universeHash: runtimeIdentityHash(symbols),
    calibrationId,
    configHash: runtimeIdentityHash({ feed: "iex_partial", adjustment: "split", profile: "unoptimized" }),
    feedMode: "iex_partial" as const,
    baselineTableId: "unoptimized-dynamic",
  };
  const storePath = resolve("data/runtime-shadow", `profile-unoptimized-state-${identity.runId}.json`);
  const runtimeStore = new JsonFileRuntimeStore(storePath);
  const lease = await runtimeStore.acquireLease(identity, now, 15 * 60_000);
  const snapshot: LiveAttentionSnapshot = {
    schemaVersion: 1, engineInstanceId: identity.engineInstanceId, runId: identity.runId, sequence: 1,
    asOf: batch.at, tradingDate: batch.tradingDate, minuteOfDay: batch.minuteOfDay, health: "ready", ready: true,
    shadow: true, liveDeliveryEnabled: false, legacyAlertingEnabled: true, ingestionMode: batch.mode,
    feedMode: "iex_partial", feedBadge: "IEX PARTIAL", calibrationId, baselineTableId: identity.baselineTableId, darkWindowReason: null,
    guard: batch.guard, rankedRows: result.rows, eventsDetected: 0, envelopesCreated: 0,
    detectionStatus: "ran", detectionSuppressionReason: null,
    detectionCounters: { processedMinutes: 1, detectionRanMinutes: 1, guardSuppressedByReason: {}, incompleteBatchMinutes: 0, nonRegularMinutes: 0, eventsDetected: 0 },
    statusMessage: `UNOPTIMIZED PROFILE. ${result.statusMessage}`,
    cycleTimings: { providerFetchMs: 0, barReconciliationMs: 0, baselineResolutionMs: 0, axisComputationMs: 0, scoringMs: 0, stateMachineMs: 0, episodeEventMs: 0, checkpointWriteMs: 0, snapshotPublishMs: 0, totalCycleMs: 0 },
    cycleBudgetExceeded: false,
    watermarkLagMs: 0,
    lagWarning: false,
  };
  const unsigned: Omit<RuntimeCheckpoint, "checksum"> = {
    schemaVersion: 1, identity, sequence: 1, watermarkAt: batch.at, createdAt: now,
    ingestionMode: batch.mode, guard: batch.guard, processorState: result.processorState,
    deliveryState: { sessionEvents: [] },
  };
  const checkpoint: RuntimeCheckpoint = { ...unsigned, checksum: checkpointChecksum(unsigned) };
  const persistenceStartedAt = performance.now();
  await runtimeStore.commitMinute({ lease, checkpoint, snapshot, events: [], envelopes: [] });
  const checkpointWriteMs = performance.now() - persistenceStartedAt;
  await runtimeStore.releaseLease(lease);

  const stages: RuntimeCycleStageTimings = {
    providerFetchMs: batch.stageTimings?.providerFetchMs ?? 0,
    barReconciliationMs: batch.stageTimings?.barReconciliationMs ?? 0,
    baselineResolutionMs: result.stageTimings?.baselineResolutionMs ?? 0,
    axisComputationMs: result.stageTimings?.axisComputationMs ?? 0,
    scoringMs: result.stageTimings?.scoringMs ?? 0,
    stateMachineMs: result.stageTimings?.stateMachineMs ?? 0,
    episodeEventMs: result.stageTimings?.episodeEventMs ?? 0,
    checkpointWriteMs,
    snapshotPublishMs: 0,
    totalCycleMs: performance.now() - startedAt,
  };
  const measuredStageMs = Object.entries(stages).filter(([key]) => key !== "totalCycleMs").reduce((sum, [, value]) => sum + value, 0);
  const report = {
    schemaVersion: 1,
    profile: "unoptimized_live_iex_minute",
    measuredAt: new Date().toISOString(),
    completedMinute: new Date(batch.at).toISOString(),
    symbolsRequested: batch.requestedSymbols.length,
    historicalSessions: loadHistory().length,
    scoredSymbols: result.rows.filter((row) => row.attentionScore !== null).length,
    stagesMs: Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, round(value)])),
    unattributedSetupAndOrchestrationMs: round(stages.totalCycleMs - measuredStageMs),
    persistenceNote: "checkpointWriteMs is the atomic JsonFileRuntimeStore checkpoint+snapshot commit; snapshotPublishMs is zero because there is no separate physical publish operation.",
    acceleratedSoakStatus: "sequencing_only_not_acceptance_evidence",
    stateArtifact: storePath,
  };
  writeFileSync(resolve("data/runtime-shadow/unoptimized-cycle-profile.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
