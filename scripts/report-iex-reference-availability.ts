import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Candle } from "../types/candle";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { rankableUniverse } from "../lib/attention/universePolicy";
import { tradingSessionsSince } from "../lib/attention/exchangeCalendar";
import { getEasternTimePartsForCandleTime } from "../lib/market-data/easternTime";
import { ATTENTION_SUB_WINDOWS, type AttentionSubWindow } from "../lib/replay/attentionThresholdTypes";

interface SessionPayload { bars: Record<string, Candle[]> }
interface Manifest { sessions: Array<{ tradingDate: string; split: "train" | "holdout" }> }
interface CorpusIndex { inputAvailability: { iex_partial: Record<string, Record<string, Record<string, number>>> } }

const rankable = rankableUniverse(ATTENTION_UNIVERSE);

function windowAt(minute: number): AttentionSubWindow | null {
  if (minute >= 240 && minute < 420) return "premarket_early";
  if (minute >= 420 && minute < 540) return "premarket_core";
  if (minute >= 540 && minute < 570) return "premarket_final";
  if (minute >= 570 && minute < 960) return "regular";
  if (minute >= 960 && minute < 1080) return "after_hours_core";
  if (minute >= 1080 && minute < 1200) return "after_hours_late";
  return null;
}

function main(): void {
  const root = resolve("data/replay/calibration");
  const manifest = JSON.parse(readFileSync(resolve(root, "session-manifest.json"), "utf8")) as Manifest;
  const index = JSON.parse(readFileSync(resolve(root, "corpus-index.json"), "utf8")) as CorpusIndex;
  const train = manifest.sessions.filter((row) => row.split === "train");
  const counts = Object.fromEntries(ATTENTION_SUB_WINDOWS.map((window) => [window, {
    evaluated: 0, targetBarPresent: 0, benchmarkCurrentBarPresent: 0, benchmarkRolling5mPresent: 0,
    sectorCurrentBarPresent: 0, sectorRolling5mPresent: 0, allCurrentReferencesPresent: 0,
    allRolling5mReferencesPresent: 0, targetPresentBenchmarkRollingMissing: 0, scoreable: 0,
    sequentialRejections: {} as Record<string, number>,
  }])) as Record<AttentionSubWindow, {
    evaluated: number; targetBarPresent: number; benchmarkCurrentBarPresent: number; benchmarkRolling5mPresent: number;
    sectorCurrentBarPresent: number; sectorRolling5mPresent: number; allCurrentReferencesPresent: number;
    allRolling5mReferencesPresent: number; targetPresentBenchmarkRollingMissing: number; scoreable: number;
    sequentialRejections: Record<string, number>;
  }>;

  for (const session of train) {
    const path = resolve(root, "sessions", "iex_partial", `${session.tradingDate}.json.gz`);
    const payload = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as SessionPayload;
    const minutes = new Map<string, Set<number>>();
    for (const [symbol, bars] of Object.entries(payload.bars)) {
      minutes.set(symbol, new Set(bars.map((bar) => getEasternTimePartsForCandleTime(bar.time).minutesSinceMidnight)));
    }
    const established = rankable.filter((entry) => !entry.listedSince || tradingSessionsSince(entry.listedSince, session.tradingDate) >= 120);
    for (let minute = 240; minute < 1200; minute += 1) {
      const window = windowAt(minute);
      if (!window) continue;
      for (const entry of established) {
        const row = counts[window];
        row.evaluated += 1;
        const target = minutes.get(entry.symbol) ?? new Set<number>();
        if (!target.has(minute)) continue;
        row.targetBarPresent += 1;
        const benchmark = minutes.get(entry.benchmark) ?? new Set<number>();
        const sector = entry.sectorEtf ? minutes.get(entry.sectorEtf) ?? new Set<number>() : null;
        const benchmarkCurrent = benchmark.has(minute);
        const sectorCurrent = sector === null || sector.has(minute);
        const benchmarkRolling = [0, 1, 2, 3, 4].some((offset) => benchmark.has(minute - offset));
        const sectorRolling = sector === null || [0, 1, 2, 3, 4].some((offset) => sector.has(minute - offset));
        if (benchmarkCurrent) row.benchmarkCurrentBarPresent += 1;
        if (benchmarkRolling) row.benchmarkRolling5mPresent += 1;
        if (sectorCurrent) row.sectorCurrentBarPresent += 1;
        if (sectorRolling) row.sectorRolling5mPresent += 1;
        if (benchmarkCurrent && sectorCurrent) row.allCurrentReferencesPresent += 1;
        if (benchmarkRolling && sectorRolling) row.allRolling5mReferencesPresent += 1;
        if (!benchmarkRolling) row.targetPresentBenchmarkRollingMissing += 1;
      }
    }
    for (const window of ATTENTION_SUB_WINDOWS) {
      const reasons = index.inputAvailability.iex_partial[session.tradingDate]?.[window] ?? {};
      for (const [reason, value] of Object.entries(reasons)) {
        counts[window].sequentialRejections[reason] = (counts[window].sequentialRejections[reason] ?? 0) + value;
      }
      counts[window].scoreable += reasons.scoreable ?? 0;
    }
  }

  const windows = ATTENTION_SUB_WINDOWS.map((subWindow) => {
    const row = counts[subWindow];
    return {
      subWindow, ...row,
      targetCoveragePct: row.evaluated ? 100 * row.targetBarPresent / row.evaluated : 0,
      benchmarkRollingAvailabilityPctOfTarget: row.targetBarPresent ? 100 * row.benchmarkRolling5mPresent / row.targetBarPresent : 0,
      allRollingReferenceAvailabilityPctOfTarget: row.targetBarPresent ? 100 * row.allRolling5mReferencesPresent / row.targetBarPresent : 0,
      scoreablePctOfTarget: row.targetBarPresent ? 100 * row.scoreable / row.targetBarPresent : 0,
    };
  });
  const artifact = {
    schemaVersion: 1, feedMode: "iex_partial",
    sessions: { train: train.length, holdoutExcluded: manifest.sessions.length - train.length },
    population: "reference-bar census uses established rankable symbols; sequential rejection counters cover all rankable symbols and retain limited-history rows for audit",
    rollingReferenceDefinition: "at least one provider bar in the current causal 5-minute return window",
    windows,
  };
  writeFileSync(resolve("data/replay/reports/iex-reference-availability.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify(artifact, null, 2));
}

main();
