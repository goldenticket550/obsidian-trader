import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import {
  normalizeAttentionAxis,
  type AttentionNormalizationCurves,
  type AxisNormalizationConfig,
} from "../lib/attention/attentionAxes";
import type { AttentionFeedMode } from "../lib/attention/attentionScore";
import { tradingSessionsSince } from "../lib/attention/exchangeCalendar";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import { quantile } from "../lib/replay/populationCalibration";
import type { AttentionSubWindow } from "../lib/replay/attentionThresholdTypes";
import {
  PRE_STREAM_REPLAY_DISCLOSURE,
  sha256,
  stableJson,
} from "../lib/replay/archive";

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
interface SaturationFile {
  path: string;
  sha256: string;
  rows: number;
}
interface SaturationIndex {
  splitHash: string;
  dates: string[];
  symbols: string[];
  artifactHash: string;
  files: Record<AttentionFeedMode, SaturationFile[]>;
}
interface Chunk {
  tradingDate: string;
  feedMode: AttentionFeedMode;
  rows: SaturationTuple[];
}
interface Manifest {
  sessions: Array<{ tradingDate: string; split: "train" | "holdout" }>;
}
interface CalibrationArtifact {
  calibrationStore: FeedAwareAttentionThresholdStore;
}

type Variant =
  | "published"
  | "log_participation"
  | "log_range_only"
  | "log_participation_and_range"
  | "empirical_curves"
  | "log_participation_empirical_curves"
  | "log_participation_range_empirical_curves"
  | "theoretical_max_rescale"
  | "log_participation_theoretical_max_rescale"
  | "log_participation_range_theoretical_max_rescale";
const VARIANTS: Variant[] = [
  "published",
  "log_participation",
  "log_range_only",
  "log_participation_and_range",
  "empirical_curves",
  "log_participation_empirical_curves",
  "log_participation_range_empirical_curves",
  "theoretical_max_rescale",
  "log_participation_theoretical_max_rescale",
  "log_participation_range_theoretical_max_rescale",
];
const MODES = ["dense", "sparse", "dead"] as const;
const QUANTILES = [0.5, 0.75, 0.9, 0.95, 0.99] as const;

function windowAt(minute: number): AttentionSubWindow {
  if (minute < 420) return "premarket_early";
  if (minute < 540) return "premarket_core";
  if (minute < 570) return "premarket_final";
  if (minute < 960) return "regular";
  if (minute < 1080) return "after_hours_core";
  return "after_hours_late";
}
function clampZ(value: number): number {
  return Math.max(-8, Math.min(8, value));
}
function percentileRecord(values: readonly number[]) {
  if (!values.length)
    return {
      count: 0,
      p50: null,
      p75: null,
      p90: null,
      p95: null,
      p99: null,
      max: null,
    };
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) maximum = Math.max(maximum, value);
  const q = (at: number) => Number(quantile(values, at).toFixed(4));
  return {
    count: values.length,
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    p95: q(0.95),
    p99: q(0.99),
    max: Number(maximum.toFixed(4)),
  };
}
function tailRecord(values: readonly number[], cap: number) {
  const fraction = (predicate: (value: number) => boolean) =>
    values.length ? values.filter(predicate).length / values.length : null;
  return {
    above2: fraction((value) => value > 2),
    above4: fraction((value) => value > 4),
    above6: fraction((value) => value > 6),
    wouldHitCap: fraction((value) => Math.abs(value) >= cap),
  };
}

class UnitHistogram {
  private readonly bins = new Uint32Array(10_001);
  count = 0;
  maximum = 0;
  above087 = 0;
  add(value: number): void {
    const bounded = Math.max(0, Math.min(1, value));
    this.bins[Math.round(bounded * 10_000)] += 1;
    this.count += 1;
    this.maximum = Math.max(this.maximum, bounded);
    if (bounded > 0.87) this.above087 += 1;
  }
  private at(q: number): number | null {
    if (!this.count) return null;
    const target = Math.ceil(q * this.count);
    let seen = 0;
    for (let index = 0; index < this.bins.length; index += 1) {
      seen += this.bins[index];
      if (seen >= target) return index / 10_000;
    }
    return 1;
  }
  result(scale = 1) {
    const scaled = (value: number | null) =>
      value === null ? null : Number((value * scale).toFixed(4));
    return {
      count: this.count,
      p50: scaled(this.at(0.5)),
      p75: scaled(this.at(0.75)),
      p90: scaled(this.at(0.9)),
      p95: scaled(this.at(0.95)),
      p99: scaled(this.at(0.99)),
      max: Number((this.maximum * scale).toFixed(4)),
      fractionAbove087: this.count ? this.above087 / this.count : null,
    };
  }
}

interface TrainingValues {
  participationRaw: number[];
  participationLog: number[];
  presence: number[];
  displacementRaw: number[];
  displacementLog: number[];
  idiosyncrasyRaw: number[];
}
function emptyTraining(): TrainingValues {
  return {
    participationRaw: [],
    participationLog: [],
    presence: [],
    displacementRaw: [],
    displacementLog: [],
    idiosyncrasyRaw: [],
  };
}
function logit(value: number): number {
  return Math.log(value / (1 - value));
}
function empiricalCurve(
  values: readonly number[],
  fallback: AxisNormalizationConfig,
): AxisNormalizationConfig {
  const usable = values.filter(Number.isFinite);
  if (usable.length < 30) return { ...fallback };
  const lower = quantile(usable, 0.5),
    upper = quantile(usable, 0.99);
  if (!(upper > lower + 1e-9)) return { ...fallback };
  // Anchor the observed median at norm=.03 and p99 at norm=.85. A p99/p99
  // pair therefore remains below score saturation even with the +15% SIP
  // modifier. This is an
  // explicit candidate, not an adopted calibration rule.
  const k = (logit(0.85) - logit(0.03)) / (upper - lower);
  const z50 = lower - logit(0.03) / k;
  return { z50: Number(z50.toFixed(4)), k: Number(k.toFixed(4)) };
}
function inputFor(row: SaturationTuple, variant: Variant) {
  const presence = row[3] === 1;
  const participation = presence
    ? row[5]
    : variant.includes("log_participation")
      ? clampZ(row[7])
      : variant === "empirical_curves"
        ? row[6]
        : row[5];
  const displacement = variant.includes("range")
    ? clampZ(row[10])
    : variant.includes("empirical_curves")
      ? row[9]
      : row[8];
  const idiosyncrasy = variant.includes("empirical_curves") ? row[12] : row[11];
  return { participation, displacement, idiosyncrasy, presence };
}
function empiricalCurves(
  values: TrainingValues,
  fallback: AttentionNormalizationCurves,
  variant: Variant,
): AttentionNormalizationCurves {
  const usesLogParticipation = variant.includes("log_participation");
  const usesLogRange = variant.includes("range");
  return {
    participationDense: empiricalCurve(
      usesLogParticipation ? values.participationLog : values.participationRaw,
      fallback.participationDense,
    ),
    participationPresence: empiricalCurve(
      values.presence,
      fallback.participationPresence,
    ),
    displacement: empiricalCurve(
      usesLogRange ? values.displacementLog : values.displacementRaw,
      fallback.displacement,
    ),
    idiosyncrasy: empiricalCurve(values.idiosyncrasyRaw, fallback.idiosyncrasy),
  };
}
function format(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}
function percent(value: number | null): string {
  return value === null ? "n/a" : `${(100 * value).toFixed(2)}%`;
}

function main(): void {
  const root = resolve("data/replay/calibration"),
    reports = resolve("data/replay/reports");
  mkdirSync(reports, { recursive: true });
  const indexBytes = readFileSync(
    resolve(root, "saturation-features-index.json"),
  );
  const index = JSON.parse(indexBytes.toString("utf8")) as SaturationIndex;
  const manifest = JSON.parse(
    readFileSync(resolve(root, "session-manifest.json"), "utf8"),
  ) as Manifest;
  const published = JSON.parse(
    readFileSync(
      resolve(reports, "attention-population-calibration.json"),
      "utf8",
    ),
  ) as CalibrationArtifact;
  const splitByDate = new Map(
    manifest.sessions.map((row) => [row.tradingDate, row.split]),
  );
  const universeBySymbol = new Map(
    ATTENTION_UNIVERSE.map((row) => [row.symbol, row]),
  );
  const limited = new Set<string>();
  for (const date of index.dates)
    for (const symbol of index.symbols) {
      const listedSince = universeBySymbol.get(symbol)?.listedSince;
      if (listedSince && tradingSessionsSince(listedSince, date) < 120)
        limited.add(`${date}|${symbol}`);
    }
  const training = new Map<string, TrainingValues>();
  const rawGroups = new Map<string, Record<string, number[]>>();
  const files = (["sip", "iex_partial"] as const).flatMap((feedMode) =>
    index.files[feedMode].map((file) => ({ feedMode, file })),
  );
  for (const { feedMode, file } of files) {
    const bytes = readFileSync(resolve(root, file.path));
    if (sha256(bytes) !== file.sha256)
      throw new Error(`Diagnostic checksum mismatch: ${file.path}`);
    const chunk = JSON.parse(gunzipSync(bytes).toString("utf8")) as Chunk;
    for (const row of chunk.rows) {
      const subWindow = windowAt(row[2]),
        mode = MODES[row[4]],
        groupKey = `${feedMode}|${subWindow}|${mode}`;
      const group = rawGroups.get(groupKey) ?? {
        participationRaw: [],
        participationLog: [],
        presenceBits: [],
        displacementRaw: [],
        displacementLog: [],
        idiosyncrasyRaw: [],
        volumeRaw: [],
        dollarVolumeRaw: [],
        volumeLog: [],
        dollarVolumeLog: [],
        rangeRaw: [],
        rangeLog: [],
      };
      if (row[3] === 0) {
        group.participationRaw.push(row[6]);
        group.participationLog.push(row[7]);
      } else group.presenceBits.push(row[5]);
      group.displacementRaw.push(row[9]);
      group.displacementLog.push(row[10]);
      group.idiosyncrasyRaw.push(row[12]);
      if (row[13] !== null) group.volumeRaw.push(row[13]);
      if (row[14] !== null) group.dollarVolumeRaw.push(row[14]);
      if (row[15] !== null) group.volumeLog.push(row[15]);
      if (row[16] !== null) group.dollarVolumeLog.push(row[16]);
      if (row[17] !== null) group.rangeRaw.push(row[17]);
      if (row[18] !== null) group.rangeLog.push(row[18]);
      rawGroups.set(groupKey, group);
      const symbol = index.symbols[row[1]];
      if (
        splitByDate.get(chunk.tradingDate) !== "train" ||
        limited.has(`${chunk.tradingDate}|${symbol}`)
      )
        continue;
      const setKey = `${feedMode}|${subWindow}`,
        values = training.get(setKey) ?? emptyTraining();
      if (row[3] === 0) {
        values.participationRaw.push(row[6]);
        values.participationLog.push(row[7]);
      } else values.presence.push(row[5]);
      values.displacementRaw.push(row[9]);
      values.displacementLog.push(row[10]);
      values.idiosyncrasyRaw.push(row[12]);
      training.set(setKey, values);
    }
  }

  const rawRows = [...rawGroups.entries()].map(([key, values]) => {
    const [feedMode, subWindow, baselineMode] = key.split("|");
    return {
      feedMode,
      subWindow,
      baselineMode,
      participationRaw: {
        ...percentileRecord(values.participationRaw),
        ...tailRecord(values.participationRaw, 8),
      },
      participationLog: {
        ...percentileRecord(values.participationLog),
        ...tailRecord(values.participationLog, 8),
      },
      presenceBits: {
        ...percentileRecord(values.presenceBits),
        fractionAtSixBitCap: values.presenceBits.length
          ? values.presenceBits.filter((value) => value >= 6).length /
            values.presenceBits.length
          : null,
      },
      displacementRaw: {
        ...percentileRecord(values.displacementRaw),
        ...tailRecord(values.displacementRaw, 8),
      },
      displacementLog: {
        ...percentileRecord(values.displacementLog),
        ...tailRecord(values.displacementLog, 8),
      },
      idiosyncrasyRaw: {
        ...percentileRecord(values.idiosyncrasyRaw),
        ...tailRecord(values.idiosyncrasyRaw, 8),
      },
      components: {
        volumeRaw: percentileRecord(values.volumeRaw),
        dollarVolumeRaw: percentileRecord(values.dollarVolumeRaw),
        volumeLog: percentileRecord(values.volumeLog),
        dollarVolumeLog: percentileRecord(values.dollarVolumeLog),
        rangeRaw: percentileRecord(values.rangeRaw),
        rangeLog: percentileRecord(values.rangeLog),
      },
    };
  });
  rawGroups.clear();

  const curves = new Map<string, AttentionNormalizationCurves>();
  for (const feedMode of ["sip", "iex_partial"] as const)
    for (const subWindow of Object.keys(
      published.calibrationStore.sets[feedMode],
    ) as AttentionSubWindow[]) {
      const set = published.calibrationStore.sets[feedMode][subWindow],
        values = training.get(`${feedMode}|${subWindow}`) ?? emptyTraining();
      for (const variant of VARIANTS)
        curves.set(
          `${variant}|${feedMode}|${subWindow}`,
          variant.includes("empirical_curves")
            ? empiricalCurves(values, set.normalization, variant)
            : structuredClone(set.normalization),
        );
    }
  training.clear();

  const scoreGroups = new Map<
    string,
    {
      participationNorm: UnitHistogram;
      displacementNorm: UnitHistogram;
      idiosyncrasyNorm: UnitHistogram;
      core: UnitHistogram;
      attention: UnitHistogram;
    }
  >();
  for (const { feedMode, file } of files) {
    const chunk = JSON.parse(
      gunzipSync(readFileSync(resolve(root, file.path))).toString("utf8"),
    ) as Chunk;
    for (const row of chunk.rows) {
      const subWindow = windowAt(row[2]),
        set = published.calibrationStore.sets[feedMode][subWindow];
      if (set.calibrationStatus !== "calibrated") continue;
      for (const variant of VARIANTS) {
        const inputs = inputFor(row, variant),
          curve = curves.get(`${variant}|${feedMode}|${subWindow}`)!;
        const p = normalizeAttentionAxis(
            inputs.participation,
            inputs.presence
              ? curve.participationPresence
              : curve.participationDense,
          ),
          d = normalizeAttentionAxis(inputs.displacement, curve.displacement),
          i = normalizeAttentionAxis(inputs.idiosyncrasy, curve.idiosyncrasy);
        const core = feedMode === "sip" ? Math.sqrt(p * d) : Math.sqrt(d * i);
        const modifier =
          feedMode === "sip"
            ? 1 + (0.15 * Math.max(-3, Math.min(3, inputs.idiosyncrasy))) / 3
            : 1;
        const preClampAttention = 100 * core * modifier;
        const attention = variant.includes("theoretical_max_rescale")
          ? preClampAttention / 1.15
          : Math.max(0, Math.min(100, preClampAttention));
        const key = `${variant}|${feedMode}|${subWindow}|${MODES[row[4]]}`;
        const group = scoreGroups.get(key) ?? {
          participationNorm: new UnitHistogram(),
          displacementNorm: new UnitHistogram(),
          idiosyncrasyNorm: new UnitHistogram(),
          core: new UnitHistogram(),
          attention: new UnitHistogram(),
        };
        group.participationNorm.add(p);
        group.displacementNorm.add(d);
        group.idiosyncrasyNorm.add(i);
        group.core.add(core);
        group.attention.add(attention / 100);
        scoreGroups.set(key, group);
      }
    }
  }
  const scoreRows = [...scoreGroups.entries()].map(([key, group]) => {
    const [variant, feedMode, subWindow, baselineMode] = key.split("|");
    return {
      variant,
      feedMode,
      subWindow,
      baselineMode,
      participationNorm: group.participationNorm.result(),
      displacementNorm: group.displacementNorm.result(),
      idiosyncrasyNorm: group.idiosyncrasyNorm.result(),
      core: group.core.result(),
      attention: group.attention.result(100),
    };
  });
  const curveRows = [...curves.entries()].map(([key, normalization]) => {
    const [variant, feedMode, subWindow] = key.split("|");
    return { variant, feedMode, subWindow, normalization };
  });
  const base = {
    schemaVersion: 1,
    scope: "candidate_evaluation_only_not_published",
    groundTruthValidation: "REFUSED",
    disclosure: PRE_STREAM_REPLAY_DISCLOSURE,
    diagnosticIndexHash: index.artifactHash,
    empiricalCurveCandidate: {
      lowerQuantile: 0.5,
      lowerNorm: 0.03,
      upperQuantile: 0.99,
      upperNorm: 0.85,
      status: "experimental_not_adopted",
      theoreticalMaxRescaleControl:
        "attention = 100 * core * modifier / 1.15; experimental only",
    },
    rawRows,
    curveRows,
    scoreRows,
  };
  const artifactHash = sha256(stableJson(base));
  writeFileSync(
    resolve(reports, "attention-saturation-experiments.json"),
    `${JSON.stringify({ ...base, artifactHash }, null, 2)}\n`,
  );

  const denseRegular = rawRows.filter(
    (row) => row.subWindow === "regular" && row.baselineMode === "dense",
  );
  const scoreRegular = scoreRows.filter(
    (row) => row.subWindow === "regular" && row.baselineMode === "dense",
  );
  const lines = [
    "# Attention-score saturation experiments",
    "",
    "> Candidate evaluation only. No curve or threshold in this report is published or active.",
    "",
    `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
    "",
    "## Unclamped regular-session inputs",
    "",
    "| Feed | Axis | Raw p50/p75/p90/p95/p99/max | >2 | >4 | >6 | Would hit ±8 | Log p50/p75/p90/p95/p99/max | Log would hit ±8 |",
    "|---|---|---|---:|---:|---:|---:|---|---:|",
  ];
  for (const row of denseRegular as any[])
    for (const [axis, raw, log] of [
      ["participation", row.participationRaw, row.participationLog],
      ["displacement", row.displacementRaw, row.displacementLog],
    ]) {
      const dist = (v: any) =>
        `${format(v.p50)}/${format(v.p75)}/${format(v.p90)}/${format(v.p95)}/${format(v.p99)}/${format(v.max)}`;
      lines.push(
        `| ${row.feedMode} | ${axis} | ${dist(raw)} | ${percent(raw.above2)} | ${percent(raw.above4)} | ${percent(raw.above6)} | ${percent(raw.wouldHitCap)} | ${dist(log)} | ${percent(log.wouldHitCap)} |`,
      );
    }
  lines.push(
    "",
    "## Regular-session score-shape comparison",
    "",
    "| Variant | Feed | Mode | Core p50/p75/p90/p95/p99/max | Core >0.87 | Attention p50/p75/p90/p95/p99/max |",
    "|---|---|---|---|---:|---|",
  );
  for (const row of scoreRegular as any[]) {
    const dist = (v: any) =>
      `${format(v.p50)}/${format(v.p75)}/${format(v.p90)}/${format(v.p95)}/${format(v.p99)}/${format(v.max)}`;
    lines.push(
      `| ${row.variant} | ${row.feedMode} | ${row.baselineMode} | ${dist(row.core)} | ${percent(row.core.fractionAbove087)} | ${dist(row.attention)} |`,
    );
  }
  lines.push(
    "",
    "The JSON companion contains every feed × sub-window × baseline-mode row, all axis norm distributions, component-level volume/dollar-volume/range tails, and every experimental curve.",
    "",
    `Artifact hash: \`${artifactHash}\`.`,
  );
  writeFileSync(
    resolve(reports, "attention-saturation-experiments.md"),
    `${lines.join("\n")}\n`,
  );
  console.log(
    JSON.stringify(
      { rawRows: rawRows.length, scoreRows: scoreRows.length, artifactHash },
      null,
      2,
    ),
  );
}

main();
