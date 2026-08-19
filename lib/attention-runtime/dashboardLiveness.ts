import { exchangeSessionForTimestamp } from "@/lib/attention/exchangeCalendar";
import type { LiveAttentionSnapshot } from "./contracts";

export const WORKER_STALE_AFTER_MS = 2 * 60_000;

export interface DashboardWorkerLiveness {
  ageMs: number | null;
  regularSession: boolean;
  workerDown: boolean;
  label: "NO SNAPSHOT" | "WORKER DOWN" | "CURRENT" | "LAST SNAPSHOT";
}

export function dashboardWorkerLiveness(
  snapshot: Pick<LiveAttentionSnapshot, "asOf"> | null,
  now = Date.now(),
  staleAfterMs = WORKER_STALE_AFTER_MS,
): DashboardWorkerLiveness {
  const regularSession = exchangeSessionForTimestamp(new Date(now)) === "regular";
  if (!snapshot) return { ageMs: null, regularSession, workerDown: regularSession, label: "NO SNAPSHOT" };
  const ageMs = Math.max(0, now - snapshot.asOf);
  const workerDown = regularSession && ageMs > staleAfterMs;
  return { ageMs, regularSession, workerDown, label: workerDown ? "WORKER DOWN" : regularSession ? "CURRENT" : "LAST SNAPSHOT" };
}

export function formatSnapshotAge(ageMs: number | null): string {
  if (ageMs === null) return "no completed minute has been published";
  if (ageMs < 60_000) return "less than one minute old";
  const minutes = Math.floor(ageMs / 60_000);
  return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
}
