import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AttentionEvent } from "@/lib/attention/attentionEvents";
import type { LiveAttentionSnapshot, RuntimeDetectionCounters } from "./contracts";
import { getEasternTimeParts } from "@/lib/market-data/easternTime";

export const DEFAULT_LOCAL_RUNTIME_STATE_PATH = "data/runtime-shadow/runtime-state-static-v1.json";

export interface LocalRuntimeFileState {
  snapshot: LiveAttentionSnapshot | null;
  events: AttentionEvent[];
}

export interface LocalRuntimeDetectionSummary {
  status: "ran" | "suppressed" | "unknown";
  reason: LiveAttentionSnapshot["detectionSuppressionReason"] | "unknown";
  counters: RuntimeDetectionCounters | null;
}

export function localRuntimeStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.ATTENTION_RUNTIME_STATE_PATH ?? DEFAULT_LOCAL_RUNTIME_STATE_PATH);
}

/**
 * `next start` is intentionally allowed only with the explicit local opt-in used by the
 * Surface runbook. A deployed production environment is never allowed to read a host file.
 */
export function localRuntimeHandoffRefused(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV === "production") return true;
  return env.NODE_ENV === "production" && env.ATTENTION_LOCAL_RUNTIME_HANDOFF_ENABLED !== "true";
}

export function readLocalRuntimeState(path = localRuntimeStatePath()): LocalRuntimeFileState {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<LocalRuntimeFileState>;
  return {
    snapshot: parsed.snapshot ?? null,
    events: Array.isArray(parsed.events) ? parsed.events : [],
  };
}

function addUtcCalendarDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** Convert an Eastern calendar midnight to epoch ms without assuming EST or EDT. */
export function easternMidnightEpoch(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const targetWallClock = Date.UTC(year, month - 1, day);
  let epoch = targetWallClock;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = getEasternTimeParts(new Date(epoch));
    const [partYear, partMonth, partDay] = parts.date.split("-").map(Number);
    const representedWallClock = Date.UTC(
      partYear,
      partMonth - 1,
      partDay,
      Math.floor(parts.minutesSinceMidnight / 60),
      parts.minutesSinceMidnight % 60,
    );
    const correction = targetWallClock - representedWallClock;
    epoch += correction;
    if (correction === 0) break;
  }
  return epoch;
}

export function easternDayRange(now = Date.now()): { tradingDate: string; startAt: number; endAt: number } {
  const tradingDate = getEasternTimeParts(new Date(now)).date;
  return {
    tradingDate,
    startAt: easternMidnightEpoch(tradingDate),
    endAt: easternMidnightEpoch(addUtcCalendarDay(tradingDate)),
  };
}

export function eventsForEasternDay(
  events: readonly AttentionEvent[],
  now = Date.now(),
  requestedLimit = 200,
): AttentionEvent[] {
  const { startAt, endAt } = easternDayRange(now);
  const limit = Math.max(1, Math.min(500, Math.floor(requestedLimit) || 200));
  return events
    .filter((event) => event.qualifiedAt >= startAt && event.qualifiedAt < endAt)
    .sort((left, right) => right.qualifiedAt - left.qualifiedAt || right.eventId.localeCompare(left.eventId))
    .slice(0, limit);
}

export function detectionSummary(snapshot: LiveAttentionSnapshot | null): LocalRuntimeDetectionSummary {
  if (!snapshot) return { status: "unknown", reason: "unknown", counters: null };
  return {
    status: snapshot.detectionStatus ?? "unknown",
    reason: snapshot.detectionSuppressionReason ?? (snapshot.detectionStatus === "ran" ? null : "unknown"),
    counters: snapshot.detectionCounters ?? null,
  };
}
