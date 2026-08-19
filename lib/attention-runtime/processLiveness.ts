import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type WorkerExitKind = "running" | "clean" | "signal" | "fatal" | "external_or_unknown";

export interface WorkerLivenessState {
  schemaVersion: 1;
  runId: string;
  pid: number;
  status: "starting" | "running" | "stopped";
  startedAt: number;
  lastHeartbeatAt: number | null;
  lastCompletedMinuteAt: number | null;
  lastSequence: number | null;
  exit: null | { at: number; kind: WorkerExitKind; reason: string; code: number | null };
}

export interface SupervisorLivenessState {
  schemaVersion: 1;
  supervisorPid: number;
  supervisorStartedAt: number;
  status: "running" | "stopping" | "stopped";
  childPid: number | null;
  childStartedAt: number | null;
  childStartCount: number;
  restartCount: number;
  lastChildExit: null | { at: number; code: number | null; signal: string | null; reason: string };
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
}

export function writeWorkerLiveness(path: string, state: WorkerLivenessState): void {
  atomicWrite(path, state);
}

export function readWorkerLiveness(path: string): WorkerLivenessState | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as WorkerLivenessState; }
  catch { return null; }
}

export function writeSupervisorLiveness(path: string, state: SupervisorLivenessState): void {
  atomicWrite(path, state);
}

export function appendLivenessLog(path: string, event: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

export function describeExitError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export function nextSupervisorStateAfterSpawn(
  state: SupervisorLivenessState,
  childPid: number,
  at: number,
): SupervisorLivenessState {
  return {
    ...state,
    status: "running",
    childPid,
    childStartedAt: at,
    childStartCount: state.childStartCount + 1,
    restartCount: Math.max(0, state.childStartCount),
  };
}
