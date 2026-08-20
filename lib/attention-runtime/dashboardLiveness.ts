import { exchangeSessionForTimestamp } from "@/lib/attention/exchangeCalendar";
import type { LiveAttentionSnapshot } from "./contracts";

export const SNAPSHOT_DELAY_AFTER_MS = 2 * 60_000;
export const WORKER_HEARTBEAT_STALE_AFTER_MS = 3 * 60_000;

export interface DashboardWorkerLiveness {
  ageMs: number | null;
  regularSession: boolean;
  workerDown: boolean;
  dataDelayed: boolean;
  heartbeatAgeMs: number | null;
  label: "NO SNAPSHOT" | "WORKER DOWN" | "DATA DELAYED" | "CURRENT" | "LAST SNAPSHOT";
}

export interface WorkerHeartbeat {
  heartbeatAt: number | null;
  health: string | null;
}

export function dashboardWorkerLiveness(
  snapshot: Pick<LiveAttentionSnapshot, "asOf"> | null,
  now = Date.now(),
  worker: WorkerHeartbeat | null = null,
  heartbeatStaleAfterMs = WORKER_HEARTBEAT_STALE_AFTER_MS,
  snapshotDelayAfterMs = SNAPSHOT_DELAY_AFTER_MS,
): DashboardWorkerLiveness {
  const regularSession = exchangeSessionForTimestamp(new Date(now)) === "regular";
  const heartbeatAgeMs = worker?.heartbeatAt === null || worker?.heartbeatAt === undefined
    ? null
    : Math.max(0, now - worker.heartbeatAt);
  const heartbeatFailed = worker?.health === "failed";
  const heartbeatStale = heartbeatAgeMs !== null && heartbeatAgeMs > heartbeatStaleAfterMs;
  const workerDown = regularSession && (heartbeatFailed || heartbeatStale);
  if (!snapshot) return {
    ageMs: null, heartbeatAgeMs, regularSession, workerDown, dataDelayed: false,
    label: workerDown ? "WORKER DOWN" : "NO SNAPSHOT",
  };
  const ageMs = Math.max(0, now - snapshot.asOf);
  const dataDelayed = regularSession && ageMs > snapshotDelayAfterMs;
  return {
    ageMs, heartbeatAgeMs, regularSession, workerDown, dataDelayed,
    label: workerDown ? "WORKER DOWN" : dataDelayed ? "DATA DELAYED" : regularSession ? "CURRENT" : "LAST SNAPSHOT",
  };
}

export function formatSnapshotAge(ageMs: number | null): string {
  if (ageMs === null) return "no completed minute has been published";
  if (ageMs < 60_000) return "less than one minute old";
  const minutes = Math.floor(ageMs / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
}
