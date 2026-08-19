import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { defaultStrategyConfig } from "../lib/strategies/config";
import {
  changedModeCacheKeys,
  classifyStickyBaselineMode,
  diffBaselineModeMaps,
  DEFAULT_DENSE_ENTER_THRESHOLD,
  DEFAULT_DENSE_LEAVE_THRESHOLD,
  type BaselineMode,
  type BaselineModeRecord,
} from "../lib/replay/baselineModes";
import {
  assertFeedAwareAttentionThresholdStore,
  createPendingFeedAwareThresholdStore,
  type FeedAwareAttentionThresholdStore,
} from "../lib/replay/feedAwareAttentionThresholds";
import { sha256 } from "../lib/replay/archive";
import type { Candle } from "../types/candle";

type SubWindow = "premarket_early" | "premarket_core" | "premarket_final" | "regular" | "after_hours_core" | "after_hours_late";
type ArchiveChunk = { bars: Record<string, Candle[]> };

interface WindowDefinition { id: SubWindow; start: number; end: number; }
const WINDOWS: WindowDefinition[] = [
  { id: "premarket_early", start: 240, end: 420 },
  { id: "premarket_core", start: 420, end: 540 },
  { id: "premarket_final", start: 540, end: 570 },
  { id: "regular", start: 570, end: 960 },
  { id: "after_hours_core", start: 960, end: 1080 },
  { id: "after_hours_late", start: 1080, end: 1200 },
];
const SESSION_START = 240;
const SESSION_END = 1200;

interface BaselineModeMapPayload {
  formatVersion: number;
  mapVersion?: number;
  archiveCreatedAt: string;
  archive: string;
  totalSessions: number;
  densePresenceThreshold?: number;
  hysteresis?: { enterDenseAtOrAbove: number; leaveDenseAtOrBelow: number };
  records: BaselineModeRecord[];
}

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const offsetByUtcDay = new Map<number, number>();

function value(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function eastern(candle: Candle): { date: string; minute: number } {
  const utcDay = Math.floor(candle.time / 86_400);
  let offset = offsetByUtcDay.get(utcDay);
  if (offset === undefined) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candle.time * 1000)).map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) / 1000;
    offset = localAsUtc - candle.time;
    offsetByUtcDay.set(utcDay, offset);
  }
  const local = new Date((candle.time + offset) * 1000);
  return { date: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

function minuteLabel(minute: number): string {
  return `${Math.floor(minute / 60).toString().padStart(2, "0")}:${(minute % 60).toString().padStart(2, "0")}`;
}

function recordKey(record: Pick<BaselineModeRecord, "symbol" | "minuteEt">): string {
  return `${record.symbol}|${record.minuteEt}`;
}

interface WindowSummary {
  viableBuckets: number;
  totalBuckets: number;
  minimumPresent: number;
  displacementFullyViable: boolean;
  participationFullyApplicable: boolean;
  modes: Record<BaselineMode, number>;
  nearDenseBoundary: number;
}

interface SymbolSummary { symbol: string; windows: Record<SubWindow, WindowSummary>; }

function main(): void {
  const archive = resolve(value("archive") ?? "data/archive/sip-split");
  const metadata = JSON.parse(readFileSync(resolve(archive, "metadata.json"), "utf8")) as { symbols: string[]; adjustment: string; feed: string; createdAt: string };
  const minimum = Number(value("minimum") ?? defaultStrategyConfig.premarketExpansion.minBaselineSessions);
  const denseEnter = Number(value("dense-enter") ?? value("dense-threshold") ?? DEFAULT_DENSE_ENTER_THRESHOLD);
  const denseLeave = Number(value("dense-leave") ?? DEFAULT_DENSE_LEAVE_THRESHOLD);
  if (!Number.isInteger(minimum) || minimum < 1) throw new Error("minimum must be a positive integer");
  if (!(denseEnter > 0 && denseEnter <= 1)) throw new Error("dense-enter must be in (0, 1]");
  if (!(denseLeave >= 0 && denseLeave < denseEnter)) throw new Error("dense-leave must be below dense-enter");

  const output = resolve(value("out") ?? "data/replay/reports/baseline-coverage.md");
  mkdirSync(dirname(output), { recursive: true });
  const detailPath = output.replace(/\.md$/, ".csv.gz");
  const modesPath = resolve(dirname(output), "baseline-modes.json.gz");
  const modesChecksumPath = resolve(dirname(output), "baseline-modes.sha256");
  const modeDiffPath = resolve(dirname(output), "baseline-mode-diff.json");
  const syntheticDiffPath = resolve(dirname(output), "baseline-mode-diff-synthetic-check.json");
  const thresholdPath = resolve(dirname(output), "attention-threshold-sets.json");
  const universePath = resolve(dirname(output), "universe-candidates.md");
  const previousPayload = existsSync(modesPath)
    ? JSON.parse(gunzipSync(readFileSync(modesPath)).toString("utf8")) as BaselineModeMapPayload
    : null;
  const previousByKey = new Map((previousPayload?.records ?? []).map((record) => [recordKey(record), record]));
  const previousMapVersion = previousPayload?.mapVersion ?? 1;

  const counts = new Map(metadata.symbols.map((symbol) => [symbol, new Uint16Array(SESSION_END - SESSION_START)]));
  const totalSessions = new Set<string>();
  const minuteFiles = readdirSync(archive).filter((name) => name.startsWith("1m-") && name.endsWith(".json.gz")).sort();
  for (const name of minuteFiles) {
    const chunk = JSON.parse(gunzipSync(readFileSync(resolve(archive, name))).toString("utf8")) as ArchiveChunk;
    for (const [symbol, bars] of Object.entries(chunk.bars)) {
      const symbolCounts = counts.get(symbol);
      if (!symbolCounts) continue;
      for (const candle of bars) {
        const local = eastern(candle);
        if (local.minute >= 570 && local.minute < 960) totalSessions.add(local.date);
        if (local.minute < SESSION_START || local.minute >= SESSION_END) continue;
        symbolCounts[local.minute - SESSION_START] += 1;
      }
    }
  }
  const sessionCount = totalSessions.size;
  if (sessionCount === 0) throw new Error("Archive contained no regular-session trading dates.");

  const detail = ["symbol,sub_window,minute_et,sessions_with_bar,total_sessions,p_present,mode,participation_observations,participation_zero_observations,displacement_observations,displacement_viable"];
  const modeRecords: BaselineModeRecord[] = [];
  const summary: SymbolSummary[] = [];
  for (const symbol of [...metadata.symbols].sort()) {
    const symbolCounts = counts.get(symbol)!;
    const windows = {} as Record<SubWindow, WindowSummary>;
    for (const window of WINDOWS) {
      let viableBuckets = 0;
      let minimumPresent = Number.POSITIVE_INFINITY;
      let nearDenseBoundary = 0;
      const modes: Record<BaselineMode, number> = { dense: 0, sparse: 0, dead: 0 };
      for (let minute = window.start; minute < window.end; minute += 1) {
        const present = symbolCounts[minute - SESSION_START];
        const minuteEt = minuteLabel(minute);
        const previous = previousByKey.get(`${symbol}|${minuteEt}`);
        const mode = classifyStickyBaselineMode(present, sessionCount, previous?.mode ?? null, {
          enterDenseAtOrAbove: denseEnter,
          leaveDenseAtOrBelow: denseLeave,
        });
        const pPresent = present / sessionCount;
        const displacementViable = present >= minimum;
        if (displacementViable) viableBuckets += 1;
        if (Math.abs(pPresent - denseEnter) <= 0.05) nearDenseBoundary += 1;
        minimumPresent = Math.min(minimumPresent, present);
        modes[mode] += 1;
        detail.push(`${symbol},${window.id},${minuteEt},${present},${sessionCount},${pPresent.toFixed(6)},${mode},${sessionCount},${sessionCount - present},${present},${displacementViable}`);
        modeRecords.push({ symbol, minuteEt, subWindow: window.id, sessionsWithBar: present, totalSessions: sessionCount, pPresent, mode });
      }
      const totalBuckets = window.end - window.start;
      windows[window.id] = {
        viableBuckets,
        totalBuckets,
        minimumPresent,
        displacementFullyViable: viableBuckets === totalBuckets,
        participationFullyApplicable: modes.dead === 0,
        modes,
        nearDenseBoundary,
      };
    }
    summary.push({ symbol, windows });
  }

  const changes = diffBaselineModeMaps(previousPayload?.records ?? [], modeRecords);
  const mapVersion = previousPayload === null ? 1 : previousMapVersion + (changes.length > 0 ? 1 : 0);
  const modeFlips = changes.filter((change) => change.modeChanged);
  const addedBuckets = changes.filter((change) => change.changeKind === "added").length;
  const removedBuckets = changes.filter((change) => change.changeKind === "removed").length;

  writeFileSync(detailPath, gzipSync(Buffer.from(`${detail.join("\n")}\n`), { level: 9 }));
  const modesPayload: BaselineModeMapPayload & Record<string, unknown> = {
    formatVersion: 2,
    mapVersion,
    archiveCreatedAt: metadata.createdAt,
    archive: basename(archive),
    totalSessions: sessionCount,
    hysteresis: { enterDenseAtOrAbove: denseEnter, leaveDenseAtOrBelow: denseLeave },
    instabilityBand: { boundary: denseEnter, radius: 0.05 },
    absentBarSemantics: { participation: "zero_observation", displacement: "missing_observation", idiosyncrasy: "missing_observation" },
    deadBucketActivity: { currentBar: "saturated_6_bit_surprise", flag: "firstObservedActivity", newInPlayRequires: "displacement_confluence" },
    records: modeRecords,
  };
  const modesBytes = gzipSync(Buffer.from(JSON.stringify(modesPayload)), { level: 9 });
  writeFileSync(modesPath, modesBytes);
  writeFileSync(modesChecksumPath, `${sha256(modesBytes)}  ${basename(modesPath)}\n`);
  const diffPayload = {
    formatVersion: 1,
    archiveCreatedAt: metadata.createdAt,
    previousMapVersion: previousPayload ? previousMapVersion : null,
    mapVersion,
    changedBuckets: changes.length,
    modeFlips: modeFlips.length,
    addedBuckets,
    removedBuckets,
    invalidatedCacheKeys: changedModeCacheKeys(changes, previousMapVersion),
    changes,
  };
  writeFileSync(modeDiffPath, `${JSON.stringify(diffPayload, null, 2)}\n`);
  const historyDiffPath = previousPayload !== null && changes.length > 0
    ? resolve(dirname(output), `baseline-mode-diff-v${previousMapVersion}-to-v${mapVersion}.json`)
    : null;
  if (historyDiffPath) writeFileSync(historyDiffPath, `${JSON.stringify(diffPayload, null, 2)}\n`);

  const syntheticCommon = { symbol: "SYNTHETIC", minuteEt: "09:29", subWindow: "premarket_final", totalSessions: 100 };
  const syntheticChanges = diffBaselineModeMaps(
    [{ ...syntheticCommon, sessionsWithBar: 59, pPresent: 0.59, mode: "sparse" }],
    [{ ...syntheticCommon, sessionsWithBar: 61, pPresent: 0.61, mode: "dense" }]
  );
  const syntheticPassed = syntheticChanges.length === 1 && syntheticChanges[0].changeKind === "mode_flip" && syntheticChanges[0].cacheInvalidationRequired;
  if (!syntheticPassed) throw new Error("Synthetic mode-diff flip verification failed.");
  writeFileSync(syntheticDiffPath, `${JSON.stringify({ passed: true, oldMapVersion: mapVersion, invalidatedCacheKeys: changedModeCacheKeys(syntheticChanges, mapVersion), changes: syntheticChanges }, null, 2)}\n`);

  let thresholdStore: FeedAwareAttentionThresholdStore;
  if (existsSync(thresholdPath)) {
    const existing = JSON.parse(readFileSync(thresholdPath, "utf8")) as Partial<FeedAwareAttentionThresholdStore>;
    thresholdStore = existing.schemaVersion === 5 && existing.modeMapVersion === mapVersion
      ? existing as FeedAwareAttentionThresholdStore
      : createPendingFeedAwareThresholdStore(mapVersion);
  } else {
    thresholdStore = createPendingFeedAwareThresholdStore(mapVersion);
  }
  assertFeedAwareAttentionThresholdStore(thresholdStore);
  writeFileSync(thresholdPath, `${JSON.stringify(thresholdStore, null, 2)}\n`);

  const windowRows = WINDOWS.map((window) => {
    const displacementFull = summary.filter((row) => row.windows[window.id].displacementFullyViable).length;
    const participationFull = summary.filter((row) => row.windows[window.id].participationFullyApplicable).length;
    const anyDisplacement = summary.filter((row) => row.windows[window.id].viableBuckets > 0).length;
    return `| ${window.id} | ${minuteLabel(window.start)}-${minuteLabel(window.end)} | ${displacementFull}/${summary.length} | ${participationFull}/${summary.length} | ${anyDisplacement}/${summary.length} |`;
  });
  const modeRows = WINDOWS.map((window) => {
    const modes = summary.reduce((acc, row) => {
      for (const mode of ["dense", "sparse", "dead"] as const) acc[mode] += row.windows[window.id].modes[mode];
      return acc;
    }, { dense: 0, sparse: 0, dead: 0 });
    const total = modes.dense + modes.sparse + modes.dead;
    return `| ${window.id} | ${modes.dense} (${(modes.dense / total * 100).toFixed(1)}%) | ${modes.sparse} (${(modes.sparse / total * 100).toFixed(1)}%) | ${modes.dead} (${(modes.dead / total * 100).toFixed(1)}%) |`;
  });
  const instabilityRows = WINDOWS.map((window) => {
    const count = summary.reduce((total, row) => total + row.windows[window.id].nearDenseBoundary, 0);
    const total = summary.length * (window.end - window.start);
    return `| ${window.id} | ${count} | ${(count / total * 100).toFixed(2)}% |`;
  });
  const instabilityTotal = summary.reduce((total, row) => total + WINDOWS.reduce((sum, window) => sum + row.windows[window.id].nearDenseBoundary, 0), 0);
  const symbolRows = summary.map((row) => `| ${row.symbol} | ${WINDOWS.map((window) => `${row.windows[window.id].viableBuckets}/${row.windows[window.id].totalBuckets}`).join(" | ")} |`);
  const coreFinalViable = summary.filter((row) => row.windows.premarket_core.displacementFullyViable && row.windows.premarket_final.displacementFullyViable).length;
  const earlyViable = summary.filter((row) => row.windows.premarket_early.displacementFullyViable).length;
  const report = [
    "# Archive baseline coverage", "",
    `- Archive: ${basename(archive)}`,
    `- Feed / adjustment: ${metadata.feed} / ${metadata.adjustment}`,
    `- Known market sessions: ${sessionCount}`,
    `- Displacement minimum present sessions: ${minimum}`,
    `- Dense hysteresis: enter at >= ${(denseEnter * 100).toFixed(0)}%; leave dense at <= ${(denseLeave * 100).toFixed(0)}%`,
    `- Mode-map version: ${mapVersion}; regeneration changed ${changes.length} buckets (${addedBuckets} added, ${removedBuckets} removed, ${modeFlips.length} mode flips)`,
    `- Instability surface: ${instabilityTotal} buckets within 0.05 of the ${(denseEnter * 100).toFixed(0)}% dense-entry boundary`,
    `- Detail: ${basename(detailPath)}`,
    `- Stored modes: ${basename(modesPath)} (SHA-256 ${sha256(modesBytes)})`,
    `- Regeneration diff: ${basename(modeDiffPath)}${historyDiffPath ? `; immutable copy ${basename(historyDiffPath)}` : ""}`,
    `- Synthetic flip check: ${basename(syntheticDiffPath)} (passed)`,
    `- Per-window threshold slots: ${basename(thresholdPath)} (pending calibration; no cross-window fallback)`, "",
    "## Axis-specific absent-bar treatment", "",
    "- Participation (volume and dollar volume): an absent bar is a known ZERO observation. All known market sessions remain in the distribution.",
    "- Displacement (range, ATR-normalized range, path efficiency): an absent bar is MISSING and is excluded; zero range is never imputed.",
    "- Idiosyncrasy is price-derived and follows displacement: absent is MISSING.", "",
    "## Sub-window viability", "",
    "Displacement is fully viable only when every minute bucket has at least the configured number of printed-bar sessions. Participation is fully applicable when no bucket is dead; sparse buckets use presence surprise rather than z-scores.", "",
    "| Sub-window | ET | Fully viable displacement symbols | Fully applicable participation symbols | Symbols with any displacement-viable bucket |", "|---|---|---:|---:|---:|",
    ...windowRows, "",
    "## Baseline mode distribution", "",
    "Dense buckets use median/MAD z. Sparse buckets use presence surprise (-log2 p_present) and its own normalization curve. A dead bucket with no bar is expected absence; its first observed bar saturates at 6 bits, carries firstObservedActivity, and requires displacement confluence for NOW IN PLAY.", "",
    "| Sub-window | Dense buckets | Sparse buckets | Dead buckets |", "|---|---:|---:|---:|",
    ...modeRows, "",
    "## Dense-boundary instability surface", "",
    "Buckets shown here sit within +/-0.05 of the dense-entry boundary. Sticky hysteresis prevents an existing dense bucket from leaving until p_present <= 0.50.", "",
    "| Sub-window | Buckets near boundary | Share of sub-window buckets |", "|---|---:|---:|",
    ...instabilityRows, "",
    "## Symbol displacement coverage", "",
    `| Symbol | ${WINDOWS.map((window) => window.id).join(" | ")} |`, `|---|${WINDOWS.map(() => "---:").join("|")}|`,
    ...symbolRows, "",
    "## Configuration implication", "",
    `Phase A2 baseline-dependent premarket scoring is configured for premarket_core plus premarket_final (07:00-09:30 ET): ${coreFinalViable}/${summary.length} symbols are fully displacement-viable across that combined window, versus ${earlyViable}/${summary.length} from 04:00. Premarket_early is excluded from universe-wide displacement scoring unless later calibration supports an explicit per-symbol policy. Thresholds are stored separately for every sub-window and remain pending until replay calibration; the runtime contract throws instead of borrowing another window's thresholds. This report does not select the trading universe.`, "",
  ].join("\n");
  writeFileSync(output, report);

  const premarketWindows: SubWindow[] = ["premarket_early", "premarket_core", "premarket_final"];
  const universeCandidates = summary.filter((row) => premarketWindows.every((window) => row.windows[window].displacementFullyViable));
  const universe = [
    "# Premarket universe candidates", "",
    `These ${universeCandidates.length} symbols have displacement-viable coverage in every premarket minute from 04:00-09:30 at the configured ${minimum}-session minimum.`,
    "This is research input only. The trader must decide universe membership, benchmark, sectorEtf, cluster, and optionsTier.", "",
    "| Symbol | premarket_early | premarket_core | premarket_final | Dense / sparse / dead buckets |", "|---|---:|---:|---:|---:|",
    ...universeCandidates.map((row) => {
      const modes = premarketWindows.reduce((acc, window) => {
        for (const mode of ["dense", "sparse", "dead"] as const) acc[mode] += row.windows[window].modes[mode];
        return acc;
      }, { dense: 0, sparse: 0, dead: 0 });
      return `| ${row.symbol} | ${row.windows.premarket_early.viableBuckets}/180 | ${row.windows.premarket_core.viableBuckets}/120 | ${row.windows.premarket_final.viableBuckets}/30 | ${modes.dense} / ${modes.sparse} / ${modes.dead} |`;
    }), "",
  ].join("\n");
  writeFileSync(universePath, universe);
  console.log(JSON.stringify({
    output, detailPath, modesPath, modesChecksumPath, modeDiffPath, historyDiffPath, syntheticDiffPath, thresholdPath, universePath,
    symbols: summary.length, totalSessions: sessionCount, minimum, denseEnter, denseLeave,
    mapVersion, changedBuckets: changes.length, addedBuckets, removedBuckets,
    modeFlips: modeFlips.length,
    instabilitySurfaceBuckets: instabilityTotal, universeCandidates: universeCandidates.length,
  }, null, 2));
}

main();
