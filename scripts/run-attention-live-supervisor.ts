import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendLivenessLog,
  nextSupervisorStateAfterSpawn,
  readWorkerLiveness,
  writeSupervisorLiveness,
  type SupervisorLivenessState,
} from "../lib/attention-runtime/processLiveness";

const directory = resolve(process.env.ATTENTION_RUNTIME_DIAGNOSTICS_DIR ?? "data/runtime-shadow");
const statePath = resolve(directory, "supervisor-state.json");
const childStatePath = resolve(directory, "worker-liveness.json");
const logPath = resolve(directory, "supervisor.log");
const restartDelayMs = Math.max(1_000, Number(process.env.ATTENTION_WORKER_RESTART_DELAY_MS ?? 5_000));
const leaseConflictDelayMs = Math.max(restartDelayMs, Number(process.env.ATTENTION_LEASE_CONFLICT_DELAY_MS ?? 95_000));
const stallTimeoutMs = Math.max(90_000, Number(process.env.ATTENTION_WORKER_STALL_TIMEOUT_MS ?? 180_000));
const startupGraceMs = Math.max(stallTimeoutMs, Number(process.env.ATTENTION_WORKER_STARTUP_GRACE_MS ?? 600_000));
const repeatedFailureLimit = Math.max(2, Number(process.env.ATTENTION_REPEATED_FAILURE_LIMIT ?? 3));
const port = Number(process.env.PORT ?? process.env.ATTENTION_HEALTH_PORT ?? 8080);

function priorSupervisorState(): SupervisorLivenessState | null {
  if (!existsSync(statePath)) return null;
  try { return JSON.parse(readFileSync(statePath, "utf8")) as SupervisorLivenessState; }
  catch { return null; }
}
const previous = priorSupervisorState();
let state: SupervisorLivenessState = {
  schemaVersion: 1, supervisorPid: process.pid, supervisorStartedAt: Date.now(),
  status: "running", childPid: null, childStartedAt: null,
  childStartCount: previous?.childStartCount ?? 0, restartCount: previous?.restartCount ?? 0,
  lastChildExit: previous?.lastChildExit ?? null,
};
let child: ChildProcess | null = null;
let stopping = false;
let restartTimer: NodeJS.Timeout | null = null;
let supervisorExitLogged = false;
let priorFailureSignature: string | null = null;
let identicalFailureCount = 0;
let escalation: { at: number; signature: string; count: number } | null = null;

function persist(): void { writeSupervisorLiveness(statePath, state); }
function log(event: Record<string, unknown>, severe = false): void {
  appendLivenessLog(logPath, { component: "attention-supervisor", supervisorPid: process.pid, ...event });
  const line = JSON.stringify({ component: "attention-supervisor", ...event });
  if (severe) console.error(line); else console.log(line);
}
function recordSupervisorExit(reason: string): void {
  if (supervisorExitLogged) return;
  supervisorExitLogged = true;
  state = { ...state, status: "stopped", childPid: null };
  persist();
  log({ type: "supervisor_exit", reason, restartCount: state.restartCount });
}
function startChild(): void {
  if (stopping) return;
  child = spawn(process.execPath, [
    "--require", resolve("node_modules/tsx/dist/preflight.cjs"),
    "--import", pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
    "scripts/run-attention-live-shadow.ts", "--continuous",
  ], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
  const startedAt = Date.now();
  state = nextSupervisorStateAfterSpawn(state, child.pid ?? -1, startedAt);
  persist();
  log({ type: "child_started", childPid: child.pid ?? null, childStartCount: state.childStartCount, restartCount: state.restartCount });
  child.once("error", (error) => log({ type: "child_spawn_error", error: error.message }, true));
  child.once("exit", (code, signal) => {
    const workerState = readWorkerLiveness(childStatePath);
    const reason = workerState?.exit?.reason ?? (signal ? `child_signal:${signal}` : `child_exit_code:${code ?? "null"}`);
    const signature = reason.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>").replace(/\d{4}-\d\d-\d\dT\S+/g, "<time>");
    identicalFailureCount = signature === priorFailureSignature ? identicalFailureCount + 1 : 1;
    priorFailureSignature = signature;
    if (identicalFailureCount >= repeatedFailureLimit) {
      escalation = { at: Date.now(), signature, count: identicalFailureCount };
      log({ type: "REPEATED_WORKER_FAILURE_ESCALATION", signature, identicalFailureCount, message: "Worker is restart-looping and is not completing minutes." }, true);
    }
    const leaseConflict = reason.includes("Runtime lease is held") || reason.includes("attention runtime lease already held");
    const nextRestartDelayMs = leaseConflict ? leaseConflictDelayMs : restartDelayMs;
    state = { ...state, childPid: null, lastChildExit: { at: Date.now(), code, signal, reason } };
    persist();
    log({ type: "child_exit", code, signal, reason, identicalFailureCount, nextRestartDelayMs }, identicalFailureCount >= repeatedFailureLimit);
    child = null;
    if (!stopping) restartTimer = setTimeout(startChild, nextRestartDelayMs);
  });
}
function health() {
  const now = Date.now();
  const worker = readWorkerLiveness(childStatePath);
  const childAlive = child !== null && child.exitCode === null;
  const heartbeatAgeMs = worker?.lastHeartbeatAt === null || worker?.lastHeartbeatAt === undefined ? null : now - worker.lastHeartbeatAt;
  const startupAgeMs = state.childStartedAt === null ? null : now - state.childStartedAt;
  const withinStartupGrace = worker?.lastHeartbeatAt == null && startupAgeMs !== null && startupAgeMs <= startupGraceMs;
  const productive = heartbeatAgeMs !== null && heartbeatAgeMs <= stallTimeoutMs;
  const healthy = !stopping && childAlive && escalation === null && (withinStartupGrace || productive);
  return { healthy, processAlive: childAlive, supervisorPid: process.pid, childPid: child?.pid ?? null,
    lastCompletedMinuteAt: worker?.lastCompletedMinuteAt ?? null, lastHeartbeatAt: worker?.lastHeartbeatAt ?? null,
    heartbeatAgeMs, stallTimeoutMs, withinStartupGrace, identicalFailureCount, escalation };
}
const server = createServer((request, response) => {
  if (request.url !== "/healthz") { response.writeHead(404).end("not found"); return; }
  const body = health();
  response.writeHead(body.healthy ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
});
server.listen(port, "0.0.0.0", () => log({ type: "health_server_started", port, stallTimeoutMs, startupGraceMs }));

const monitor = setInterval(() => {
  const status = health();
  if (!status.healthy && status.processAlive && !status.withinStartupGrace && status.heartbeatAgeMs !== null && status.heartbeatAgeMs > stallTimeoutMs) {
    log({ type: "WORKER_STALLED", lastCompletedMinuteAt: status.lastCompletedMinuteAt, heartbeatAgeMs: status.heartbeatAgeMs }, true);
    child?.kill("SIGTERM");
  }
}, 15_000);
monitor.unref();

function stop(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  state = { ...state, status: "stopping" };
  persist();
  log({ type: "supervisor_stop_requested", signal });
  if (restartTimer) clearTimeout(restartTimer);
  clearInterval(monitor);
  server.close();
  if (child?.pid) child.kill(signal);
  else { recordSupervisorExit(`signal:${signal}`); process.exitCode = 0; }
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stop(signal));
process.on("beforeExit", (code) => recordSupervisorExit(stopping ? `clean_before_exit:${code}` : `unexpected_event_loop_drain:${code}`));
process.on("exit", (code) => recordSupervisorExit(stopping ? `clean_exit:${code}` : `unexpected_exit:${code}`));
process.on("uncaughtException", (error) => { log({ type: "supervisor_fatal", reason: `uncaughtException:${error.message}` }, true); recordSupervisorExit(`uncaughtException:${error.message}`); process.exit(1); });
process.on("unhandledRejection", (reason) => { log({ type: "supervisor_fatal", reason: `unhandledRejection:${String(reason)}` }, true); recordSupervisorExit(`unhandledRejection:${String(reason)}`); process.exit(1); });

persist();
log({ type: "supervisor_started", restartDelayMs, leaseConflictDelayMs, repeatedFailureLimit, recoveredExternallyTerminatedSupervisor: previous?.status === "running" });
startChild();
