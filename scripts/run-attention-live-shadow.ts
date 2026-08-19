import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { alpacaCredentials } from "../lib/replay/env";
import { AlpacaProvider } from "../lib/market-data/providers/alpacaProvider";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import { probeIexStreamCapability, RestIexPollingSource } from "../lib/attention-runtime/ingestion";
import { JsonFileRuntimeStore } from "../lib/attention-runtime/jsonFileStore";
import { SupabaseRuntimeStore } from "../lib/attention-runtime/supabaseStore";
import { createAdminClient } from "../lib/supabase/admin";
import type { RuntimeStore } from "../lib/attention-runtime/contracts";
import { StaticBaselineIexAttentionProcessor } from "../lib/attention-runtime/iexStaticProcessor";
import { assertIexBaselineTable, type IexBaselineTable } from "../lib/attention-runtime/iexBaselineTable";
import { ExplicitReferenceQualityProcessor } from "../lib/attention-runtime/referenceQuality";
import { AttentionLiveWorker, runtimeIdentityHash } from "../lib/attention-runtime/worker";
import { PRE_STREAM_REPLAY_DISCLOSURE } from "../lib/replay/archive";
import {
  appendLivenessLog,
  describeExitError,
  writeWorkerLiveness,
  type WorkerExitKind,
  type WorkerLivenessState,
} from "../lib/attention-runtime/processLiveness";

const runtimeDirectory = resolve(process.env.ATTENTION_RUNTIME_DIAGNOSTICS_DIR ?? "data/runtime-shadow");
const livenessPath = resolve(runtimeDirectory, "worker-liveness.json");
const livenessLogPath = resolve(runtimeDirectory, "worker-liveness.log");
let liveness: WorkerLivenessState | null = null;
let stopSignal: NodeJS.Signals | null = null;
let exitRecorded = false;

function logLiveness(event: Record<string, unknown>): void {
  appendLivenessLog(livenessLogPath, { component: "attention-worker", pid: process.pid, runId: liveness?.runId ?? null, ...event });
  console.log(JSON.stringify({ component: "attention-worker", ...event }));
}

function recordExit(kind: WorkerExitKind, reason: string, code: number | null): void {
  if (exitRecorded) return;
  exitRecorded = true;
  if (liveness) {
    liveness = { ...liveness, status: "stopped", exit: { at: Date.now(), kind, reason, code } };
    writeWorkerLiveness(livenessPath, liveness);
  }
  logLiveness({ type: "worker_exit", kind, reason, code, lastSequence: liveness?.lastSequence ?? null });
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    if (stopSignal) return;
    stopSignal = signal;
    logLiveness({ type: "worker_stop_requested", signal });
  });
}
process.on("beforeExit", (code) => recordExit("external_or_unknown", `beforeExit:${code}`, code));
process.on("exit", (code) => recordExit(stopSignal ? "signal" : "external_or_unknown", stopSignal ? `signal:${stopSignal}` : `process_exit:${code}`, code));
process.on("uncaughtException", (error) => {
  recordExit("fatal", `uncaughtException:${describeExitError(error)}`, 1);
  console.error(error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  recordExit("fatal", `unhandledRejection:${describeExitError(error)}`, 1);
  console.error(error);
  process.exit(1);
});

function requiredAttentionUserId(): string {
  const value = process.env.ATTENTION_USER_ID;
  if (!value) throw new Error("ATTENTION_USER_ID_REQUIRED: ATTENTION_RUNTIME_STORE=supabase requires the authenticated trader UUID.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("ATTENTION_USER_ID_INVALID_UUID: ATTENTION_USER_ID must be an auth.users UUID.");
  }
  return value;
}
function loadBaselineTable(): IexBaselineTable {
  const artifactPath = process.env.ATTENTION_BASELINE_TABLE_PATH ?? resolve("data/replay/calibration/iex-live-baseline-table.json");
  const table = JSON.parse(readFileSync(artifactPath, "utf8")) as IexBaselineTable;
  assertIexBaselineTable(table);
  const expected = process.env.ATTENTION_BASELINE_TABLE_ID ?? "0bdc723e1df978fce3842255a31997e0f1b40d4f3f6c4ed85f6024b2eb817775";
  if (table.tableId !== expected) throw new Error(`ATTENTION_BASELINE_ID_MISMATCH: expected ${expected}, received ${table.tableId}.`);
  return table;
}

async function main() {
  const credentials = alpacaCredentials();
  const symbols = ATTENTION_UNIVERSE.map((entry) => entry.symbol);
  const thresholdsPath = process.env.ATTENTION_THRESHOLDS_PATH ?? resolve("data/replay/reports/attention-thresholds.json");
  const thresholds = JSON.parse(readFileSync(thresholdsPath, "utf8")) as FeedAwareAttentionThresholdStore;
  const calibrationId = thresholds.sets.iex_partial.regular.calibrationId;
  const baselineTable = loadBaselineTable();
  let capability;
  try { capability = await probeIexStreamCapability({ symbols, ...credentials, timeoutMs: 12_000 }); }
  catch (error) { capability = { mode: "iex_rest_polling" as const, requestedSymbols: symbols.length, acknowledgedSymbols: 0, complete: false, reason: error instanceof Error ? error.message : String(error), probedAt: Date.now() }; }
  // Free-tier shadow deliberately polls the complete universe. A permissive stream ack is audited,
  // but is not treated as a durable entitlement contract.
  const configuredFeed = process.env.ALPACA_FEED ?? "iex";
  const configuredPaidPlan = process.env.ALPACA_PAID_PLAN ?? "false";
  if (configuredFeed !== "iex" || configuredPaidPlan !== "false") throw new Error("HOST1_SHADOW_REQUIRES_FREE_IEX: ALPACA_FEED=iex and ALPACA_PAID_PLAN=false.");
  const provider = new AlpacaProvider({ ...credentials, feed: "iex", isPaidPlan: false }, undefined, 10_000, 12, 350);
  const pollLookbackMinutes = Number(process.env.ATTENTION_POLL_LOOKBACK_MINUTES ?? 420);
  if (!Number.isFinite(pollLookbackMinutes) || pollLookbackMinutes < 390) throw new Error("ATTENTION_POLL_LOOKBACK_MINUTES must be at least 390.");
  const source = new RestIexPollingSource(provider, symbols, pollLookbackMinutes);
  const runtimeStoreKind = process.env.ATTENTION_RUNTIME_STORE ?? "json";
  if (runtimeStoreKind !== "json" && runtimeStoreKind !== "supabase") throw new Error(`ATTENTION_RUNTIME_STORE_INVALID: ${runtimeStoreKind}`);
  const now = Date.now();
  const identity = {
    engineInstanceId: process.env.ATTENTION_ENGINE_INSTANCE_ID ?? "attention-shadow-iex-static-v1",
    runId: randomUUID(),
    userId: runtimeStoreKind === "supabase" ? requiredAttentionUserId() : "local-shadow",
    universeHash: baselineTable.universeHash,
    calibrationId,
    configHash: runtimeIdentityHash({ feed: "iex_partial", adjustment: "split", regularOnly: true, alerting: false }),
    feedMode: "iex_partial" as const,
    baselineTableId: baselineTable.tableId,
  };
  const fileStore = runtimeStoreKind === "json"
    ? new JsonFileRuntimeStore(process.env.ATTENTION_RUNTIME_STATE_PATH ?? resolve("data/runtime-shadow/runtime-state-static-v1.json"))
    : null;
  const runtimeStore: RuntimeStore = runtimeStoreKind === "supabase"
    ? new SupabaseRuntimeStore(createAdminClient(), identity)
    : fileStore!;
  await runtimeStore.setControls({ version: 1, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true, activeAlertEngine: "legacy", updatedAt: now, reason: "authorized_shadow_alerting_disabled" });
  liveness = { schemaVersion: 1, runId: identity.runId, pid: process.pid, status: "starting", startedAt: now, lastHeartbeatAt: null, lastCompletedMinuteAt: null, lastSequence: null, exit: null };
  writeWorkerLiveness(livenessPath, liveness);
  logLiveness({ type: "worker_started", continuous: process.argv.includes("--continuous"), calibrationId });

  const processor = new ExplicitReferenceQualityProcessor(new StaticBaselineIexAttentionProcessor(thresholds, baselineTable));
  const worker = new AttentionLiveWorker(runtimeStore, source, processor, { identity, shadow: true });
  const continuous = process.argv.includes("--continuous");
  let lastSequence = -1;
  try {
    await worker.start(now);
    liveness = { ...liveness, status: "running" };
    writeWorkerLiveness(livenessPath, liveness);
    do {
      let cycleFailed = false;
      try {
        const cycleAt = Date.now();
        await runtimeStore.setControls({ version: 1, attentionLiveAlertingEnabled: false, legacyAlertingEnabled: true, activeAlertEngine: "legacy", updatedAt: cycleAt, reason: "authorized_shadow_alerting_disabled" });
        const snapshot = await worker.runOnce(cycleAt);
        if (snapshot.sequence !== lastSequence) {
          lastSequence = snapshot.sequence;
          const heartbeatAt = Date.now();
          liveness = { ...liveness!, status: "running", lastHeartbeatAt: heartbeatAt, lastCompletedMinuteAt: snapshot.asOf, lastSequence: snapshot.sequence, exit: null };
          writeWorkerLiveness(livenessPath, liveness);
          logLiveness({ type: "worker_heartbeat", heartbeatAt, sequence: snapshot.sequence, completedMinuteAt: snapshot.asOf, completedMinute: new Date(snapshot.asOf).toISOString(), health: snapshot.health, guard: snapshot.guard.reason, cycleTimings: snapshot.cycleTimings, cycleBudgetExceeded: snapshot.cycleBudgetExceeded, watermarkLagMs: snapshot.watermarkLagMs, lagWarning: snapshot.lagWarning });
          if (snapshot.cycleBudgetExceeded) {
            logLiveness({ type: "cycle_budget_breach", thresholdMs: 20_000, sequence: snapshot.sequence, completedMinuteAt: snapshot.asOf, cycleTimings: snapshot.cycleTimings });
          }
          if (snapshot.lagWarning) {
            logLiveness({ type: "watermark_lag_warning", sequence: snapshot.sequence, completedMinuteAt: snapshot.asOf, watermarkLagMs: snapshot.watermarkLagMs, cycleTimings: snapshot.cycleTimings });
          }
          const report = {
            schemaVersion: 1, status: "SHADOW_RUNNING", ranAt: new Date().toISOString(),
            paidPlan: false, subscriptionPurchased: false, deployed: process.env.VERCEL === "1", migrationApplied: runtimeStoreKind === "supabase",
            selectedIngestionMode: "iex_rest_polling", runtimeStore: runtimeStoreKind, capabilityProbe: capability,
            requestedSymbols: symbols.length, tradeableSymbols: 61, referenceOnlySymbols: 7,
            calibrationId, disclosure: PRE_STREAM_REPLAY_DISCLOSURE, snapshot,
          };
          mkdirSync(resolve("data/runtime-shadow"), { recursive: true });
          writeFileSync(resolve("data/runtime-shadow/last-run.json"), JSON.stringify(report, null, 2) + "\n");
          console.log(JSON.stringify({ status: report.status, selectedIngestionMode: report.selectedIngestionMode, capabilityProbe: capability, snapshot: { sequence: snapshot.sequence, asOf: new Date(snapshot.asOf).toISOString(), health: snapshot.health, ready: snapshot.ready, shadow: snapshot.shadow, liveDeliveryEnabled: snapshot.liveDeliveryEnabled, legacyAlertingEnabled: snapshot.legacyAlertingEnabled, scoredRows: snapshot.rankedRows.filter((row) => row.attentionScore !== null).length, unavailableRows: snapshot.rankedRows.filter((row) => row.attentionScore === null).length, eventsDetected: snapshot.eventsDetected, envelopesCreated: snapshot.envelopesCreated, statusMessage: snapshot.statusMessage } }, null, 2));
        }
      } catch (error) {
        cycleFailed = true;
        console.error("[attention-worker] cycle failed; state remains at the prior durable watermark:", error);
        logLiveness({ type: "worker_cycle_failed", reason: describeExitError(error), lastSequence });
        throw error;
      }
      if (continuous && !stopSignal) {
        const retryAt = cycleFailed
          ? Date.now() + 5_000
          : (Math.floor(Date.now() / 60_000) + 1) * 60_000 + 1_000;
        await new Promise((resolveWait) => setTimeout(resolveWait, Math.max(1_000, retryAt - Date.now())));
      }
    } while (continuous && !stopSignal);
  } finally {
    try { await worker.stop(); }
    catch (error) { logLiveness({ type: "worker_stop_failed", reason: describeExitError(error) }); }
  }
  recordExit(stopSignal ? "signal" : "clean", stopSignal ? `signal:${stopSignal}` : continuous ? "continuous_loop_completed_unexpectedly" : "single_cycle_complete", 0);
}

main().catch((error) => {
  recordExit("fatal", `main_rejected:${describeExitError(error)}`, 1);
  console.error(error);
  process.exitCode = 1;
});
