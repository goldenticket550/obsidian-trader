import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  appendLivenessLog,
  nextSupervisorStateAfterSpawn,
  readWorkerLiveness,
  writeSupervisorLiveness,
  type SupervisorLivenessState,
} from "../lib/attention-runtime/processLiveness";

const directory = resolve("data/runtime-shadow");
const statePath = resolve(directory, "supervisor-state.json");
const childStatePath = resolve(directory, "worker-liveness.json");
const logPath = resolve(directory, "supervisor.log");
const restartDelayMs = Math.max(1_000, Number(process.env.ATTENTION_WORKER_RESTART_DELAY_MS ?? 5_000));
function priorSupervisorState(): SupervisorLivenessState | null {
  if (!existsSync(statePath)) return null;
  try { return JSON.parse(readFileSync(statePath, "utf8")) as SupervisorLivenessState; }
  catch { return null; }
}
const previous = priorSupervisorState();

let state: SupervisorLivenessState = {
  schemaVersion: 1,
  supervisorPid: process.pid,
  supervisorStartedAt: Date.now(),
  status: "running",
  childPid: null,
  childStartedAt: null,
  childStartCount: previous?.childStartCount ?? 0,
  restartCount: previous?.restartCount ?? 0,
  lastChildExit: previous?.lastChildExit ?? null,
};
let child: ChildProcess | null = null;
let stopping = false;
let restartTimer: NodeJS.Timeout | null = null;
let supervisorExitLogged = false;

function persist(): void { writeSupervisorLiveness(statePath, state); }
function log(event: Record<string, unknown>): void {
  appendLivenessLog(logPath, { component: "attention-supervisor", supervisorPid: process.pid, ...event });
  console.log(JSON.stringify({ component: "attention-supervisor", ...event }));
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
    "--require",
    resolve("node_modules/tsx/dist/preflight.cjs"),
    "--import",
    pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href,
    "scripts/run-attention-live-shadow.ts",
    "--continuous",
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  const startedAt = Date.now();
  state = nextSupervisorStateAfterSpawn(state, child.pid ?? -1, startedAt);
  persist();
  log({ type: "child_started", childPid: child.pid ?? null, childStartCount: state.childStartCount, restartCount: state.restartCount });

  child.once("error", (error) => log({ type: "child_spawn_error", error: error.message }));
  child.once("exit", (code, signal) => {
    const workerState = readWorkerLiveness(childStatePath);
    const reason = workerState?.exit?.reason ?? (signal ? `child_signal:${signal}` : `child_exit_code:${code ?? "null"}`);
    const leaseConflict = reason.includes("Runtime lease is held") || reason.includes("attention runtime lease already held");
    const nextRestartDelayMs = leaseConflict ? 95_000 : restartDelayMs;
    state = { ...state, childPid: null, lastChildExit: { at: Date.now(), code, signal, reason } };
    persist();
    log({ type: "child_exit", code, signal, reason, restartCount: state.restartCount, nextRestartDelayMs });
    child = null;
    if (!stopping) restartTimer = setTimeout(startChild, nextRestartDelayMs);
  });
}

function stop(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  state = { ...state, status: "stopping" };
  persist();
  log({ type: "supervisor_stop_requested", signal });
  if (restartTimer) clearTimeout(restartTimer);
  if (child?.pid) child.kill(signal);
  else { recordSupervisorExit(`signal:${signal}`); process.exitCode = 0; }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stop(signal));
process.on("beforeExit", (code) => recordSupervisorExit(stopping ? `clean_before_exit:${code}` : `unexpected_event_loop_drain:${code}`));
process.on("exit", (code) => recordSupervisorExit(stopping ? `clean_exit:${code}` : `unexpected_exit:${code}`));
process.on("uncaughtException", (error) => {
  log({ type: "supervisor_fatal", reason: `uncaughtException:${error.message}` });
  recordSupervisorExit(`uncaughtException:${error.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log({ type: "supervisor_fatal", reason: `unhandledRejection:${String(reason)}` });
  recordSupervisorExit(`unhandledRejection:${String(reason)}`);
  process.exit(1);
});

persist();
log({ type: "supervisor_started", restartDelayMs, recoveredExternallyTerminatedSupervisor: previous?.status === "running" });
startChild();
