import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { AttentionA3ReplayEngine } from "../lib/attention/attentionA3Replay";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import type { AttentionFeedMode } from "../lib/attention/attentionScore";
import type { AttentionNormalizationCurves } from "../lib/attention/attentionAxes";
import type { AttentionHistoryObservation } from "../lib/attention/attentionHistory";
import { SipSessionDigestCollector } from "../lib/replay/sessionDigest";
import {
  PRE_STREAM_REPLAY_DISCLOSURE,
  sha256,
  stableJson,
} from "../lib/replay/archive";
import {
  ATTENTION_SUB_WINDOWS,
  type AttentionSubWindow,
  type ResolvedAttentionThresholdValues,
} from "../lib/replay/attentionThresholdTypes";
import {
  applyPopulationCalibration,
  createPendingFeedAwareThresholdStore,
  markCalibrationUnavailableByConstruction,
  type FeedAwareAttentionThresholdStore,
} from "../lib/replay/feedAwareAttentionThresholds";
import {
  MINIMUM_IN_PLAY_PARTNER_Z,
  POPULATION_TARGETS,
  assertCalibrationConfluence,
  derivePopulationThresholds,
  partnerInputRequired,
  quantile,
  scoreRawCalibrationPoint,
  type RawCalibrationPoint,
} from "../lib/replay/populationCalibration";

type Tuple = [
  number,
  number,
  number,
  number,
  number,
  0 | 1,
  0 | 1 | 2,
  number,
  number,
  number,
  number,
  number | null,
  number | null,
  number,
  0 | 1,
  0 | 1,
  0 | 1,
];
type SaturationTuple = [
  number,
  number,
  number,
  0 | 1,
  0 | 1 | 2,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];
interface Corpus {
  splitHash: string;
  dates: string[];
  symbols: string[];
  feeds: { sip: Tuple[]; iex_partial: Tuple[] };
}
interface Session {
  tradingDate: string;
  split: "train" | "holdout";
  primaryRegime: string;
  tags: string[];
  earlyClose: boolean;
}
interface Manifest {
  sessions: Session[];
}
interface SaturationFile {
  path: string;
  sha256: string;
  rows: number;
}
interface SaturationIndex {
  dates: string[];
  files: Record<AttentionFeedMode, SaturationFile[]>;
}
interface SaturationChunk {
  tradingDate: string;
  rows: SaturationTuple[];
}
interface PublishedArtifact {
  calibrationStore: FeedAwareAttentionThresholdStore;
}
interface ExperimentArtifact {
  curveRows: Array<{
    variant: Candidate;
    feedMode: AttentionFeedMode;
    subWindow: AttentionSubWindow;
    normalization: AttentionNormalizationCurves;
  }>;
}

type Candidate =
  | "published"
  | "log_participation"
  | "log_participation_and_range"
  | "empirical_curves"
  | "log_participation_empirical_curves"
  | "log_participation_range_empirical_curves"
  | "theoretical_max_rescale"
  | "log_participation_theoretical_max_rescale"
  | "log_participation_range_theoretical_max_rescale";
const CANDIDATES: Candidate[] = [
  "published",
  "log_participation",
  "log_participation_and_range",
  "empirical_curves",
  "log_participation_empirical_curves",
  "log_participation_range_empirical_curves",
  "theoretical_max_rescale",
  "log_participation_theoretical_max_rescale",
  "log_participation_range_theoretical_max_rescale",
];
const SELECTED_DATES = new Set([
  "2025-10-01",
  "2025-10-10",
  "2025-11-04",
  "2025-11-28",
  "2026-02-13",
]);
const MODE_NAMES = ["dense", "sparse", "dead"] as const;

function windowAt(minute: number): AttentionSubWindow {
  if (minute < 420) return "premarket_early";
  if (minute < 540) return "premarket_core";
  if (minute < 570) return "premarket_final";
  if (minute < 960) return "regular";
  if (minute < 1080) return "after_hours_core";
  return "after_hours_late";
}
function configured(session: Session, minute: number): boolean {
  return !(session.earlyClose && minute >= 780 && minute < 960);
}
function clampZ(value: number): number {
  return Math.max(-8, Math.min(8, value));
}
function logistic(z: number, curve: { z50: number; k: number }): number {
  return 1 / (1 + Math.exp(-curve.k * (z - curve.z50)));
}
function preserveConfluence(
  curves: AttentionNormalizationCurves,
  values: ResolvedAttentionThresholdValues,
): ResolvedAttentionThresholdValues {
  const required = Math.max(
    Math.sqrt(
      logistic(6, curves.participationDense) *
        logistic(MINIMUM_IN_PLAY_PARTNER_Z, curves.displacement),
    ),
    Math.sqrt(
      logistic(6, curves.displacement) *
        logistic(MINIMUM_IN_PLAY_PARTNER_Z, curves.participationDense),
    ),
  );
  const confluenceFloor = Number(
    (Math.ceil(required * 10_000) / 10_000 + 0.0001).toFixed(4),
  );
  const inPlayEnterCore = Number(
    Math.max(values.inPlayEnterCore, confluenceFloor).toFixed(4),
  );
  const gap = Math.max(0.005, values.inPlayEnterCore - values.inPlayExitCore);
  return {
    ...values,
    inPlayEnterCore,
    inPlayExitCore: Number(
      Math.max(values.emergingEnterCore + 0.002, inPlayEnterCore - gap).toFixed(
        4,
      ),
    ),
  };
}
function transformed(
  row: Tuple,
  diagnostic: Float64Array,
  offset: number,
  candidate: Candidate,
) {
  const participationKind =
    row[5] === 0 ? ("z" as const) : ("surprise_bits" as const);
  const pRaw = diagnostic[offset + 0],
    pLog = diagnostic[offset + 1],
    dRaw = diagnostic[offset + 2],
    dLog = diagnostic[offset + 3],
    iRaw = diagnostic[offset + 4];
  const empirical = candidate.includes("empirical_curves"),
    logParticipation = candidate.includes("log_participation"),
    logRange = candidate.includes("range");
  return {
    participationInput:
      participationKind === "surprise_bits"
        ? row[4]
        : logParticipation
          ? empirical
            ? pLog
            : clampZ(pLog)
          : empirical
            ? pRaw
            : row[4],
    participationInputKind: participationKind,
    displacementZ: logRange
      ? empirical
        ? dLog
        : clampZ(dLog)
      : empirical
        ? dRaw
        : row[7],
    idiosyncrasyZ: empirical ? iRaw : row[8],
  };
}
function rawPoint(
  row: Tuple,
  diagnostic: Float64Array,
  offset: number,
  corpus: Corpus,
  candidate: Candidate,
): RawCalibrationPoint {
  return {
    tradingDate: corpus.dates[row[0]],
    symbol: corpus.symbols[row[1]],
    minuteOfDay: row[3],
    feedMode: "sip",
    subWindow: windowAt(row[3]),
    ...transformed(row, diagnostic, offset, candidate),
    limitedHistory: row[16] === 1,
  };
}
function candidateScore(
  point: RawCalibrationPoint,
  curves: AttentionNormalizationCurves,
  candidate: Candidate,
) {
  const scored = scoreRawCalibrationPoint(point, curves);
  if (!candidate.includes("theoretical_max_rescale")) return scored;
  const modifier =
    1 + (0.15 * Math.max(-3, Math.min(3, point.idiosyncrasyZ))) / 3;
  return { ...scored, attention: (100 * scored.core * modifier) / 1.15 };
}

function observation(
  row: Tuple,
  diagnostic: Float64Array,
  offset: number,
  corpus: Corpus,
  candidate: Candidate,
  store: FeedAwareAttentionThresholdStore,
): AttentionHistoryObservation {
  const point = rawPoint(row, diagnostic, offset, corpus, candidate),
    set = store.sets.sip[point.subWindow],
    score = candidateScore(point, set.normalization, candidate);
  return {
    symbol: point.symbol,
    at: row[2],
    score: score.attention,
    core: score.core,
    feedMode: "sip",
    subWindow: point.subWindow,
    calibrationId: set.calibrationId,
    participationBaselineMode: MODE_NAMES[row[6]],
    participationInput: point.participationInput,
    participationInputKind: point.participationInputKind,
    displacementZ: point.displacementZ,
    idiosyncrasyZ: point.idiosyncrasyZ,
    price: row[9],
    atr: row[10],
    vwap: row[11],
    ema9: row[12],
    consecutiveExpansionBars: row[13],
    pullbackObserved: row[14] === 1,
    priceLostVwap: row[15] === 1,
    dataQualityState: row[16] === 1 ? "limited_history" : "ok",
    provisional: false,
  };
}
function stats(values: readonly number[]) {
  if (!values.length)
    return {
      count: 0,
      p50: null,
      p75: null,
      p90: null,
      p95: null,
      p99: null,
      min: null,
      max: null,
    };
  let minimum = Number.POSITIVE_INFINITY,
    maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const q = (at: number) => Number(quantile(values, at).toFixed(4));
  return {
    count: values.length,
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    p95: q(0.95),
    p99: q(0.99),
    min: Number(minimum.toFixed(4)),
    max: Number(maximum.toFixed(4)),
  };
}

function main(): void {
  const root = resolve("data/replay/calibration"),
    reports = resolve("data/replay/reports");
  mkdirSync(reports, { recursive: true });
  const corpus = JSON.parse(
    gunzipSync(readFileSync(resolve(root, "raw-features.json.gz"))).toString(
      "utf8",
    ),
  ) as Corpus;
  const manifest = JSON.parse(
    readFileSync(resolve(root, "session-manifest.json"), "utf8"),
  ) as Manifest;
  const saturationIndex = JSON.parse(
    readFileSync(resolve(root, "saturation-features-index.json"), "utf8"),
  ) as SaturationIndex;
  const published = JSON.parse(
    readFileSync(
      resolve(reports, "attention-population-calibration.json"),
      "utf8",
    ),
  ) as PublishedArtifact;
  const experiments = JSON.parse(
    readFileSync(
      resolve(reports, "attention-saturation-experiments.json"),
      "utf8",
    ),
  ) as ExperimentArtifact;
  const rawByDate = Array.from(
    { length: corpus.dates.length },
    () => [] as Tuple[],
  );
  for (const row of corpus.feeds.sip) rawByDate[row[0]].push(row);
  const diagnosticByDate = new Map<string, Float64Array>();
  for (const file of saturationIndex.files.sip) {
    const bytes = readFileSync(resolve(root, file.path));
    if (sha256(bytes) !== file.sha256)
      throw new Error(`Diagnostic checksum mismatch: ${file.path}`);
    const chunk = JSON.parse(
      gunzipSync(bytes).toString("utf8"),
    ) as SaturationChunk;
    const dateIndex = corpus.dates.indexOf(chunk.tradingDate),
      rawRows = rawByDate[dateIndex];
    if (rawRows.length !== chunk.rows.length)
      throw new Error(
        `Raw/diagnostic row-count mismatch on ${chunk.tradingDate}.`,
      );
    const packed = new Float64Array(chunk.rows.length * 5);
    for (let index = 0; index < chunk.rows.length; index += 1) {
      const diagnostic = chunk.rows[index],
        raw = rawRows[index];
      if (
        diagnostic[0] !== raw[0] ||
        diagnostic[1] !== raw[1] ||
        diagnostic[2] !== raw[3]
      )
        throw new Error(
          `Raw/diagnostic row alignment failed on ${chunk.tradingDate} row ${index}.`,
        );
      packed.set(
        [
          diagnostic[6],
          diagnostic[7],
          diagnostic[9],
          diagnostic[10],
          diagnostic[12],
        ],
        index * 5,
      );
    }
    diagnosticByDate.set(chunk.tradingDate, packed);
  }

  const curveByCandidate = new Map(
    experiments.curveRows.map((row) => [
      `${row.variant}|${row.feedMode}|${row.subWindow}`,
      row.normalization,
    ]),
  );
  const stores = new Map<Candidate, FeedAwareAttentionThresholdStore>();
  stores.set("published", published.calibrationStore);
  const fitRows: Array<Record<string, unknown>> = [];
  for (const candidate of CANDIDATES.filter((value) => value !== "published")) {
    let store = createPendingFeedAwareThresholdStore(3);
    for (const subWindow of ATTENTION_SUB_WINDOWS) {
      const points: RawCalibrationPoint[] = [];
      for (let dateIndex = 0; dateIndex < corpus.dates.length; dateIndex += 1) {
        const session = manifest.sessions[dateIndex];
        if (session.split !== "train") continue;
        const diagnostic = diagnosticByDate.get(session.tradingDate)!;
        for (let index = 0; index < rawByDate[dateIndex].length; index += 1) {
          const row = rawByDate[dateIndex][index];
          if (
            windowAt(row[3]) !== subWindow ||
            row[16] === 1 ||
            !configured(session, row[3])
          )
            continue;
          points.push(rawPoint(row, diagnostic, index * 5, corpus, candidate));
        }
      }
      const curves = candidate.includes("empirical_curves")
        ? curveByCandidate.get(`${candidate}|sip|${subWindow}`)!
        : published.calibrationStore.sets.sip[subWindow].normalization;
      const scored = points.map((point) =>
        candidateScore(point, curves, candidate),
      );
      const values = preserveConfluence(
        curves,
        derivePopulationThresholds(
          scored,
          POPULATION_TARGETS[subWindow],
          "mean",
        ),
      );
      assertCalibrationConfluence({
        feedMode: "sip",
        curves,
        thresholds: values,
      });
      store = applyPopulationCalibration(store, {
        feedMode: "sip",
        subWindow,
        normalizationVersion: 900,
        normalization: curves,
        thresholdVersion: 900,
        values,
        corpusHash: sha256(`${corpus.splitHash}:experimental:${candidate}`),
      });
      fitRows.push({
        candidate,
        subWindow,
        curves,
        values,
        trainingRows: points.length,
        status: "experimental_not_published",
      });
    }
    for (const subWindow of ATTENTION_SUB_WINDOWS)
      store = markCalibrationUnavailableByConstruction(store, {
        feedMode: "iex_partial",
        subWindow,
        reason: "insufficient_reference",
      });
    stores.set(candidate, store);
  }

  const results: Array<Record<string, unknown>> = [];
  const digests = new Map<Candidate, string>();
  for (const candidate of CANDIDATES) {
    const store = stores.get(candidate)!,
      collector = new SipSessionDigestCollector(SELECTED_DATES);
    for (const date of SELECTED_DATES) {
      const dateIndex = corpus.dates.indexOf(date),
        session = manifest.sessions[dateIndex],
        diagnostic = diagnosticByDate.get(date)!,
        engine = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE),
        byMinute = new Map<number, AttentionHistoryObservation[]>();
      for (let index = 0; index < rawByDate[dateIndex].length; index += 1) {
        const row = rawByDate[dateIndex][index];
        if (!configured(session, row[3])) continue;
        const list = byMinute.get(row[3]) ?? [];
        list.push(
          observation(row, diagnostic, index * 5, corpus, candidate, store),
        );
        byMinute.set(row[3], list);
      }
      for (let minute = 240; minute < 1200; minute += 1) {
        const rows = byMinute.get(minute);
        if (!rows?.length) continue;
        collector.observe(session, minute, engine.processMinute(rows));
      }
    }
    const episodes = collector.reachedInPlayEpisodes(),
      peaks = episodes.map((row) => row.peakAttention),
      ranks = episodes.map((row) => row.peakRank);
    const exactHundred = peaks.filter((value) => value >= 100 - 1e-9).length;
    results.push({
      candidate,
      episodes: episodes.length,
      peakAttention: stats(peaks),
      exactHundred,
      fractionExactHundred: episodes.length
        ? exactHundred / episodes.length
        : null,
      rankOne: ranks.filter((value) => value === 1).length,
      fractionRankOne: ranks.length
        ? ranks.filter((value) => value === 1).length / ranks.length
        : null,
      uniquePeaksAtOneDecimal: new Set(peaks.map((value) => value.toFixed(1)))
        .size,
      acceptancePeakHundredAtMostTenPercent:
        episodes.length > 0 && exactHundred / episodes.length <= 0.1,
    });
    const digest = collector
      .markdown()
      .replace(
        "# Attention Engine — five-session human-readable digest",
        `# Attention Engine — five-session digest (${candidate})`,
      )
      .replace(
        "Feed: `sip`.",
        `Feed: \`sip\`. Saturation treatment: \`${candidate}\`; ${candidate === "published" ? "active published calibration" : "EXPERIMENTAL, NOT PUBLISHED"}.`,
      );
    digests.set(candidate, digest);
    writeFileSync(
      resolve(reports, `attention-session-digest-${candidate}.md`),
      digest,
    );
  }
  const eligible = results.filter(
    (row) => row.acceptancePeakHundredAtMostTenPercent,
  ) as Array<any>;
  const proposed = eligible.sort(
    (a, b) =>
      b.peakAttention.p90 -
        b.peakAttention.p50 -
        (a.peakAttention.p90 - a.peakAttention.p50) ||
      b.uniquePeaksAtOneDecimal - a.uniquePeaksAtOneDecimal,
  )[0]?.candidate as Candidate | undefined;
  if (proposed)
    writeFileSync(
      resolve(reports, "attention-session-digest-proposed.md"),
      digests.get(proposed)!,
    );
  const base = {
    schemaVersion: 1,
    scope: "candidate_replay_only_not_published",
    groundTruthValidation: "REFUSED",
    disclosure: PRE_STREAM_REPLAY_DISCLOSURE,
    selectedDates: [...SELECTED_DATES],
    results,
    fitRows,
    proposedForAdjudication: proposed ?? null,
  };
  const artifactHash = sha256(stableJson(base));
  writeFileSync(
    resolve(reports, "attention-saturation-candidate-replay.json"),
    `${JSON.stringify({ ...base, artifactHash }, null, 2)}\n`,
  );
  const lines = [
    "# Attention saturation candidate replay",
    "",
    "> Experimental comparison only. The proposed row is not adopted or published; ground-truth conclusions remain refused.",
    "",
    `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
    "",
    "| Candidate | Episodes | Peak p50/p75/p90/p95/p99/min/max | Exact 100 | Peak-rank 1 | Unique peaks (0.1) | Acceptance |",
    "|---|---:|---|---:|---:|---:|---|",
    ...results.map(
      (row: any) =>
        `| ${row.candidate} | ${row.episodes} | ${row.peakAttention.p50}/${row.peakAttention.p75}/${row.peakAttention.p90}/${row.peakAttention.p95}/${row.peakAttention.p99}/${row.peakAttention.min}/${row.peakAttention.max} | ${row.exactHundred} (${(100 * row.fractionExactHundred).toFixed(1)}%) | ${row.rankOne} (${(100 * row.fractionRankOne).toFixed(1)}%) | ${row.uniquePeaksAtOneDecimal} | ${row.acceptancePeakHundredAtMostTenPercent ? "PASS" : "FAIL"} |`,
    ),
    "",
    `Proposed for trader adjudication: ${proposed ? `\`${proposed}\`` : "none"}. This is a replay comparison, not an active calibration change.`,
    "",
    `Artifact hash: \`${artifactHash}\`.`,
  ];
  writeFileSync(
    resolve(reports, "attention-saturation-candidate-replay.md"),
    `${lines.join("\n")}\n`,
  );
  console.log(
    JSON.stringify(
      { proposedForAdjudication: proposed ?? null, results, artifactHash },
      null,
      2,
    ),
  );
}

main();
