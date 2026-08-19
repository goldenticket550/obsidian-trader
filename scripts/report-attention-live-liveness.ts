import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { exchangeCalendarDay } from "../lib/attention/exchangeCalendar";
import { getEasternTimeParts } from "../lib/market-data/easternTime";
import type { SupervisorLivenessState } from "../lib/attention-runtime/processLiveness";

interface LogRow {
  at: string;
  type?: string;
  completedMinuteAt?: number;
  sequence?: number;
  reason?: string;
  cycleTimings?: { totalCycleMs?: number };
  watermarkLagMs?: number;
}

function rows(path: string): LogRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as LogRow]; }
    catch { return []; }
  });
}

function longestRun(values: readonly number[]): number {
  let longest = 0, current = 0, prior: number | null = null;
  for (const value of values) {
    current = prior !== null && value === prior + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    prior = value;
  }
  return longest;
}
function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * (index - lower);
}


const directory = resolve("data/runtime-shadow");
const now = new Date();
const requestedDate = process.argv.find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg)) ?? getEasternTimeParts(now).date;
const calendar = exchangeCalendarDay(requestedDate);
if (!calendar.isTradingDay) throw new Error(`${requestedDate} is not a trading session: ${calendar.reason ?? calendar.kind}.`);
const openMinute = calendar.regularOpenMinutes!;
const closeMinute = calendar.regularCloseMinutes!;
const expectedMinutes = closeMinute - openMinute;
const heartbeatRows = rows(resolve(directory, "worker-liveness.log")).filter((row) => {
  if (row.type !== "worker_heartbeat" || typeof row.completedMinuteAt !== "number") return false;
  const parts = getEasternTimeParts(new Date(row.completedMinuteAt));
  return parts.date === requestedDate && parts.minutesSinceMidnight >= openMinute && parts.minutesSinceMidnight < closeMinute;
});
const observedByMinute = new Map<number, LogRow>();
for (const row of heartbeatRows) observedByMinute.set(getEasternTimeParts(new Date(row.completedMinuteAt!)).minutesSinceMidnight, row);
const missing = Array.from({ length: expectedMinutes }, (_, index) => openMinute + index).filter((minute) => !observedByMinute.has(minute));
const latencies = [...observedByMinute.values()].map((row) => Date.parse(row.at) - row.completedMinuteAt!);
const supervisorRows = rows(resolve(directory, "supervisor.log"));
const cycleTimes = [...observedByMinute.values()].flatMap((row) => typeof row.cycleTimings?.totalCycleMs === "number" ? [row.cycleTimings.totalCycleMs] : []);
const loggedWatermarkLags = [...observedByMinute.values()].flatMap((row) => typeof row.watermarkLagMs === "number" ? [row.watermarkLagMs] : []);
const sessionDateRows = supervisorRows.filter((row) => getEasternTimeParts(new Date(row.at)).date === requestedDate);
const sessionChildExits = sessionDateRows.filter((row) => row.type === "child_exit");
const supervisor = existsSync(resolve(directory, "supervisor-state.json"))
  ? JSON.parse(readFileSync(resolve(directory, "supervisor-state.json"), "utf8")) as SupervisorLivenessState
  : null;
const coveragePct = observedByMinute.size / expectedMinutes * 100;
const status = observedByMinute.size === expectedMinutes ? "PASS" : "FAIL_INCOMPLETE_SESSION";
const first = [...observedByMinute.values()].sort((a, b) => a.completedMinuteAt! - b.completedMinuteAt!)[0];
const last = [...observedByMinute.values()].sort((a, b) => b.completedMinuteAt! - a.completedMinuteAt!)[0];
const payload = {
  schemaVersion: 1,
  generatedAt: now.toISOString(),
  tradingDate: requestedDate,
  dayKind: calendar.kind,
  status,
  expectedMinutes,
  heartbeatMinutes: observedByMinute.size,
  coveragePct,
  firstCompletedMinute: first ? new Date(first.completedMinuteAt!).toISOString() : null,
  lastCompletedMinute: last ? new Date(last.completedMinuteAt!).toISOString() : null,
  missingMinutes: missing,
  maximumConsecutiveMissingMinutes: longestRun(missing),
  maximumCompletionLagMs: latencies.length ? Math.max(...latencies) : null,
  sessionChildExitCount: sessionChildExits.length,
  sessionChildExitReasons: sessionChildExits.map((row) => row.reason ?? "unknown"),
  maximumWatermarkLagMs: loggedWatermarkLags.length ? Math.max(...loggedWatermarkLags) : null,
  cycleTimeMs: {
    count: cycleTimes.length,
    p50: quantile(cycleTimes, 0.5),
    p95: quantile(cycleTimes, 0.95),
    max: cycleTimes.length ? Math.max(...cycleTimes) : null,
  },
  persistentRestartCount: supervisor?.restartCount ?? null,
};
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, "full-session-liveness-report.json"), JSON.stringify(payload, null, 2) + "\n");
writeFileSync(resolve(directory, "full-session-liveness-report.md"), `# Attention runtime full-session liveness\n\nThis is an operational liveness report, not ground-truth scanner validation.\n\n- Trading date: ${requestedDate} (${calendar.kind})\n- Status: **${status}**\n- Heartbeat coverage: ${observedByMinute.size}/${expectedMinutes} minutes (${coveragePct.toFixed(2)}%)\n- First completed minute: ${payload.firstCompletedMinute ?? "none"}\n- Last completed minute: ${payload.lastCompletedMinute ?? "none"}\n- Maximum consecutive missing minutes: ${payload.maximumConsecutiveMissingMinutes}\n- Maximum completion lag: ${payload.maximumCompletionLagMs === null ? "unavailable" : `${(payload.maximumCompletionLagMs / 1000).toFixed(1)} seconds`}\n- Maximum logged watermark lag: ${payload.maximumWatermarkLagMs === null ? "unavailable" : `${(payload.maximumWatermarkLagMs / 1000).toFixed(1)} seconds`}\n- Cycle time p50 / p95 / max: ${payload.cycleTimeMs.p50 === null ? "unavailable" : `${payload.cycleTimeMs.p50.toFixed(1)} / ${payload.cycleTimeMs.p95!.toFixed(1)} / ${payload.cycleTimeMs.max!.toFixed(1)} ms`}\n- Worker exits during session: ${sessionChildExits.length}\n- Persistent supervised restart count: ${payload.persistentRestartCount ?? "unavailable"}\n\nA full-session pass requires one heartbeat for every scheduled regular-session minute. Process presence alone does not count as uptime.\n`);
console.log(JSON.stringify(payload, null, 2));
