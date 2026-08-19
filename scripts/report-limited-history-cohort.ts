import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { tradingSessionsSince } from "../lib/attention/exchangeCalendar";
import type { ListingDateResolution } from "../lib/replay/listingDates";

const value = (name: string): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

interface Metadata {
  end: string;
  listingDateDerivations?: Record<string, ListingDateResolution>;
  supplements?: Array<{ discardedPreListingBars?: Record<string, number> }>;
}

function formatRatio(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

function main(): void {
  const metadataPath = resolve(value("metadata") ?? "data/archive/sip-split/metadata.json");
  const output = resolve(value("out") ?? "data/replay/reports/limited-history-cohort.md");
  const minHistorySessions = Number(value("min-history-sessions") ?? 120);
  if (!Number.isInteger(minHistorySessions) || minHistorySessions < 1) throw new Error("min-history-sessions must be positive.");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Metadata;
  const through = metadata.end.slice(0, 10);
  const derivations = metadata.listingDateDerivations ?? {};
  const controlled = ATTENTION_UNIVERSE.filter((entry) => entry.enabled && (entry.listedSince || derivations[entry.symbol]));
  const rows = controlled.map((entry) => {
    const resolution = derivations[entry.symbol];
    if (!resolution) throw new Error(`Missing listing-date provenance for ${entry.symbol}.`);
    if (resolution.authoredListedSince !== (entry.listedSince ?? null)) {
      throw new Error(`Authored listing date changed without archive revalidation for ${entry.symbol}.`);
    }
    const sessions = tradingSessionsSince(resolution.effectiveListedSince, through);
    const discardedArchiveBars = (metadata.supplements ?? []).reduce(
      (sum, supplement) => sum + (supplement.discardedPreListingBars?.[entry.symbol] ?? 0), 0
    );
    return {
      symbol: entry.symbol,
      authored: resolution.authoredListedSince,
      derivedCandidate: resolution.derivedCandidateDate,
      effective: resolution.effectiveListedSince,
      resolutionRule: resolution.resolutionRule,
      sessions,
      state: sessions < minHistorySessions ? "limited_history" : "established",
      isNoGateControl: !entry.listedSince,
      possibleWhenIssued: resolution.whenIssued.possibleWhenIssued,
      observedVolumeRatio: resolution.whenIssued.observedVolumeRatio,
      excludedLeadingSessions: resolution.whenIssued.excludedLeadingSessions,
      discardedArchiveBars,
    };
  }).sort((left, right) => left.symbol.localeCompare(right.symbol));
  const limited = rows.filter((row) => row.state === "limited_history");
  const controlFailures = rows.filter((row) => row.isNoGateControl && row.state === "limited_history");
  if (controlFailures.length > 0) throw new Error(`No-gate listing control unexpectedly classified limited_history: ${controlFailures.map((row) => row.symbol).join(", ")}`);
  const report = [
    "# Limited-history cohort and listing-date provenance", "",
    `- Archive through: ${through}`,
    `- minHistorySessions: ${minHistorySessions}`,
    `- Limited-history cohort: ${limited.length ? limited.map((row) => row.symbol).join(", ") : "none"}`,
    `- No-gate negative controls: ${rows.filter((row) => row.isNoGateControl).map((row) => row.symbol).join(", ") || "none"}`,
    "- Limited-history statistics are reported separately and excluded from threshold calibration.", "",
    "| Symbol | Authored | Derived candidate | Effective | Resolution rule | Sessions | Cohort | Control | When-issued ratio | Leading sessions excluded | Archive bars discarded |",
    "|---|---|---|---|---|---:|---|---|---:|---:|---:|",
    ...rows.map((row) => `| ${row.symbol} | ${row.authored ?? "none"} | ${row.derivedCandidate} | ${row.effective} | ${row.resolutionRule} | ${row.sessions} | ${row.state} | ${row.isNoGateControl ? "no-gate" : "dated"} | ${formatRatio(row.observedVolumeRatio)} | ${row.excludedLeadingSessions} | ${row.discardedArchiveBars} |`),
    "",
  ].join("\n");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, report);
  console.log(JSON.stringify({ output, through, minHistorySessions, limitedHistory: limited.map((row) => row.symbol), noGateControls: rows.filter((row) => row.isNoGateControl).map((row) => row.symbol), rows }, null, 2));
}

main();
