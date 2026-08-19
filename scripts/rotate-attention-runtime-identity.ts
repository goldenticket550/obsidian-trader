import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RuntimeCheckpoint, RuntimeIdentity } from "../lib/attention-runtime/contracts";
import type { IexBaselineTable } from "../lib/attention-runtime/iexBaselineTable";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import { runtimeIdentityHash } from "../lib/attention-runtime/worker";

const statePath = resolve("data/runtime-shadow/runtime-state-static-v1.json");
const backupPath = resolve("data/runtime-shadow/runtime-state-static-v1.pre-open-coverage.json");
const reportPath = resolve("data/runtime-shadow/open-coverage-identity-rotation.json");
const state = JSON.parse(readFileSync(statePath, "utf8")) as {
  schemaVersion: 1; fencingToken: number; lease: unknown; controls: { attentionLiveAlertingEnabled: boolean; activeAlertEngine: string } | null;
  checkpoint: RuntimeCheckpoint | null; snapshot: unknown; events: unknown[]; outbox: unknown[];
};
const table = JSON.parse(readFileSync(resolve("data/replay/calibration/iex-live-baseline-table.json"), "utf8")) as IexBaselineTable;
const thresholds = JSON.parse(readFileSync(resolve("data/replay/reports/attention-thresholds.json"), "utf8")) as FeedAwareAttentionThresholdStore;
if (state.controls?.attentionLiveAlertingEnabled !== false || state.controls.activeAlertEngine !== "legacy") throw new Error("Refusing identity rotation unless alerting is disabled and legacy remains active.");
const expected: Omit<RuntimeIdentity, "runId"> = {
  engineInstanceId: "attention-shadow-iex-static-v1",
  userId: "local-shadow",
  universeHash: table.universeHash,
  calibrationId: thresholds.sets.iex_partial.regular.calibrationId,
  configHash: runtimeIdentityHash({ feed: "iex_partial", adjustment: "split", regularOnly: true, alerting: false }),
  feedMode: "iex_partial",
  baselineTableId: table.tableId,
};
const mismatchFields = state.checkpoint ? (["engineInstanceId", "userId", "universeHash", "calibrationId", "configHash", "feedMode", "baselineTableId"] as const)
  .filter((key) => state.checkpoint!.identity[key] !== expected[key]) : [];
if (state.checkpoint && mismatchFields.length === 0) throw new Error("Runtime checkpoint is already compatible; rotation is unnecessary.");
copyFileSync(statePath, backupPath);
const next = { ...state, lease: null, checkpoint: null, snapshot: null, events: [], outbox: [] };
const temporary = `${statePath}.tmp`;
writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
renameSync(temporary, statePath);
const report = {
  rotatedAt: new Date().toISOString(), backupPath, mismatchFields,
  priorSequence: state.checkpoint?.sequence ?? null,
  priorIdentity: state.checkpoint?.identity ?? null,
  expectedIdentity: expected,
  cleared: { checkpoint: true, snapshot: true, events: state.events.length, outbox: state.outbox.length },
  controlsPreserved: state.controls,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
