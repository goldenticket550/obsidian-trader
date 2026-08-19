import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { replayMinuteByMinute, hashSequence } from "../lib/replay/deterministic";
import { evaluateLegacySetupAtMinute, resetLegacyReplayCache } from "../lib/replay/legacyEvaluator";
import { PRE_STREAM_REPLAY_DISCLOSURE } from "../lib/replay/archive";
import { hitRatesByLabelSource, validateReplayLabels } from "../lib/replay/labelValidation";
import type { RecordedSession, SessionLabels } from "../lib/replay/types";

const value = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

function loadSession(path: string): RecordedSession {
  const bytes = readFileSync(path);
  const json = path.endsWith(".gz") ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  return JSON.parse(json) as RecordedSession;
}

function firstSurface(minutes: ReturnType<typeof replayMinuteByMinute>, symbol: string): number | null {
  return minutes.find((minute) => minute.rows.some((row) => row.symbol === symbol && row.score >= 7))?.at ?? null;
}

function parseLabelTime(date: string, time: string | null): number | null {
  if (time === null) return null;
  const parsed = Date.parse(`${date}T${time}-04:00`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function minutesBetween(from: number | null, to: number | null): string {
  return from === null || to === null ? "unavailable" : ((to - from) / 60).toFixed(1);
}

function main(): void {
  const input = value("input");
  if (!input) throw new Error("Usage: npm run replay:attention -- --input session.json.gz [--labels labels.json]");
  const session = loadSession(resolve(input));
  const first = replayMinuteByMinute(session, evaluateLegacySetupAtMinute);
  resetLegacyReplayCache();
  const second = replayMinuteByMinute(session, evaluateLegacySetupAtMinute);
  const firstSequence = hashSequence(first);
  const secondSequence = hashSequence(second);
  if (first.length !== second.length || first.some((minute, index) => minute.hash !== second[index]?.hash)) {
    throw new Error("Replay determinism failure: per-minute hash sequences differ.");
  }

  const labelsPath = value("labels");
  const labels = labelsPath && existsSync(labelsPath)
    ? JSON.parse(readFileSync(labelsPath, "utf8")) as SessionLabels
    : { tradingDate: session.tradingDate, quietSession: null, reviewCompleted: false, reviewStats: { autoCandidates: 0, accepted: 0, rejected: 0, pending: 0, manualAdds: 0 }, labels: [] };
  const labelRows = labels.labels.map((label) => {
    const surfaced = firstSurface(first, label.symbol);
    return {
      symbol: label.symbol,
      surfaced,
      hindsightLatency: minutesBetween(parseLabelTime(session.tradingDate, label.time_it_became_interesting), surfaced),
      actualNoticeLatency: minutesBetween(parseLabelTime(session.tradingDate, label.time_i_actually_noticed), surfaced),
    };
  });
  const surfacedSymbols = new Set(labelRows.filter((row) => row.surfaced !== null).map((row) => row.symbol));
  const sourceRates = hitRatesByLabelSource(labels.labels, (label) => surfacedSymbols.has(label.symbol));
  const validation = validateReplayLabels(labels);
  const rejectionRate = validation.rejectionRate === null ? "unavailable" : `${(validation.rejectionRate * 100).toFixed(1)}%`;
  const validationBlock = validation.status === "failed"
    ? ["## LABEL VALIDATION — FAILED", "", "> WARNING: This replay cannot validate discovery. " + validation.warnings.join(" ")]
    : validation.status === "not_applicable_quiet"
    ? ["## Label validation — explicitly quiet session", "", "The trader completed review and explicitly marked this session quiet."]
    : ["## Label validation — passed", "", `Trader rejection rate: ${rejectionRate}.`];
  const sourceRows = sourceRates.map((row) => `| ${row.source} | ${row.labels} | ${row.surfaced} | ${row.hitRate === null ? "unavailable" : `${(row.hitRate * 100).toFixed(1)}%`} |`);
  const missed = labels.labels.filter((label) => label.missedByCandidateGenerator);
  const report = [
    `# Replay report — ${session.tradingDate}`,
    "",
    `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
    "",
    "## Determinism",
    "",
    `- Variant: legacy setup baseline (new Attention Engine intentionally not implemented in A-Zero)`,
    `- Minutes: ${first.length}`,
    `- First sequence: \`${firstSequence}\``,
    `- Second sequence: \`${secondSequence}\``,
    `- Identical: yes`,
    "",
    ...validationBlock,
    "",
    `- Review complete: ${labels.reviewCompleted ? "yes" : "no"}`,
    `- Quiet-session judgment: ${labels.quietSession === null ? "unadjudicated" : labels.quietSession ? "quiet" : "not quiet"}`,
    `- Auto-candidate rejection rate: ${rejectionRate} (${labels.reviewStats.rejected}/${labels.reviewStats.autoCandidates})`,
    "",
    "## Hit rate by label source (never pooled)",
    "",
    "| Source | Labels | Surfaced | Hit rate |", "|---|---:|---:|---:|",
    ...sourceRows,
    "",
    `Executed-trade labels are selection-biased and cannot independently validate discovery.`,
    "",
    "## Ground truth",
    "",
    labels.labels.length === 0
      ? "No trader labels were supplied; timing, hit-rate, false-positive, episode, and move-capture statistics are unavailable."
      : labelRows.map((row) => `- ${row.symbol}: surfaced=${row.surfaced ? new Date(row.surfaced * 1000).toISOString() : "not surfaced"}; latency vs hindsight=${row.hindsightLatency}m; latency vs actual notice=${row.actualNoticeLatency}m`).join("\n"),
    "",
    "## Missed by candidate generator",
    "",
    missed.length === 0
      ? "None recorded."
      : missed.map((label) => `- ${label.symbol}: trader-added independent discovery`).join("\n"),
    "",
    "## A/B status",
    "",
    "The legacy baseline is recorded. The Attention Engine side is unavailable until Phase A2/A3 and is not fabricated here.",
    "",
    "## Coverage limitations",
    "",
    "Historical pulls do not cover stream reconnects, batch backfills, halt/resume status messages, or true arrival timing.",
    "",
  ].join("\n");
  const outDir = resolve(value("out") ?? "data/replay/reports");
  mkdirSync(outDir, { recursive: true });
  const reportPath = resolve(outDir, `${session.tradingDate}.md`);
  const hashesPath = resolve(outDir, `${session.tradingDate}.hashes.json`);
  writeFileSync(reportPath, report);
  writeFileSync(hashesPath, JSON.stringify(first.map(({ at, hash }) => ({ at, hash })), null, 2));
  console.log(JSON.stringify({ input: basename(input), reportPath, hashesPath, minutes: first.length, hashSequence: firstSequence }, null, 2));
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
