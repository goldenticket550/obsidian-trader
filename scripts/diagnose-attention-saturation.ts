import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { AttentionFeedMode } from "../lib/attention/attentionScore";
import { normalizeAttentionAxis } from "../lib/attention/attentionAxes";
import {
  scoreRawCalibrationPoint,
  quantile,
} from "../lib/replay/populationCalibration";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import type { AttentionSubWindow } from "../lib/replay/attentionThresholdTypes";
import {
  PRE_STREAM_REPLAY_DISCLOSURE,
  sha256,
  stableJson,
} from "../lib/replay/archive";

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
interface Corpus {
  splitHash: string;
  dates: string[];
  symbols: string[];
  feeds: { sip: Tuple[]; iex_partial: Tuple[] };
}
interface CalibrationArtifact {
  calibrationStore: FeedAwareAttentionThresholdStore;
}

const WINDOWS: AttentionSubWindow[] = [
  "premarket_early",
  "premarket_core",
  "premarket_final",
  "regular",
  "after_hours_core",
  "after_hours_late",
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

function distribution(values: readonly number[]) {
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
  const at = (q: number) => Number(quantile(values, q).toFixed(4));
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) maximum = Math.max(maximum, value);
  return {
    count: values.length,
    p50: at(0.5),
    p75: at(0.75),
    p90: at(0.9),
    p95: at(0.95),
    p99: at(0.99),
    max: Number(maximum.toFixed(4)),
  };
}

function fractions(values: readonly number[], thresholds: readonly number[]) {
  return Object.fromEntries(
    thresholds.map((threshold) => [
      `above${threshold}`,
      values.length
        ? values.filter((value) => value > threshold).length / values.length
        : null,
    ]),
  );
}

function percent(value: number | null): string {
  return value === null ? "n/a" : `${(100 * value).toFixed(2)}%`;
}
function fmt(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

function main(): void {
  const root = resolve("data/replay/calibration");
  const reports = resolve("data/replay/reports");
  mkdirSync(reports, { recursive: true });
  const featureBytes = readFileSync(resolve(root, "raw-features.json.gz"));
  const corpus = JSON.parse(
    gunzipSync(featureBytes).toString("utf8"),
  ) as Corpus;
  const published = JSON.parse(
    readFileSync(
      resolve(reports, "attention-population-calibration.json"),
      "utf8",
    ),
  ) as CalibrationArtifact;
  const rows: Array<Record<string, unknown>> = [];

  for (const feedMode of ["sip", "iex_partial"] as const) {
    for (const subWindow of WINDOWS) {
      const set = published.calibrationStore.sets[feedMode][subWindow];
      const tuples = corpus.feeds[feedMode].filter(
        (tuple) => windowAt(tuple[3]) === subWindow,
      );
      for (let modeCode = 0; modeCode < MODES.length; modeCode += 1) {
        const mode = MODES[modeCode];
        const modeTuples = tuples.filter((tuple) => tuple[6] === modeCode);
        if (!modeTuples.length) continue;
        const participationZ = modeTuples
          .filter((tuple) => tuple[5] === 0)
          .map((tuple) => tuple[4]);
        const presenceBits = modeTuples
          .filter((tuple) => tuple[5] === 1)
          .map((tuple) => tuple[4]);
        const displacementZ = modeTuples.map((tuple) => tuple[7]);
        const idiosyncrasyZ = modeTuples.map((tuple) => tuple[8]);
        const participationNorm = modeTuples.map((tuple) =>
          normalizeAttentionAxis(
            tuple[4],
            tuple[5] === 0
              ? set.normalization.participationDense
              : set.normalization.participationPresence,
          ),
        );
        const displacementNorm = modeTuples.map((tuple) =>
          normalizeAttentionAxis(tuple[7], set.normalization.displacement),
        );
        const idiosyncrasyNorm = modeTuples.map((tuple) =>
          normalizeAttentionAxis(tuple[8], set.normalization.idiosyncrasy),
        );
        const cores = modeTuples.map(
          (tuple) =>
            scoreRawCalibrationPoint(
              {
                tradingDate: corpus.dates[tuple[0]],
                symbol: corpus.symbols[tuple[1]],
                minuteOfDay: tuple[3],
                feedMode,
                subWindow,
                participationInput: tuple[4],
                participationInputKind: tuple[5] === 0 ? "z" : "surprise_bits",
                displacementZ: tuple[7],
                idiosyncrasyZ: tuple[8],
                limitedHistory: tuple[16] === 1,
              },
              set.normalization,
            ).core,
        );
        rows.push({
          feedMode,
          subWindow,
          baselineMode: mode,
          observations: modeTuples.length,
          participationZ: {
            ...distribution(participationZ),
            ...fractions(participationZ, [2, 4, 6]),
            fractionAtClamp: participationZ.length
              ? participationZ.filter((value) => Math.abs(value) >= 8 - 1e-12)
                  .length / participationZ.length
              : null,
          },
          presenceBits: {
            ...distribution(presenceBits),
            fractionAtSixBitCap: presenceBits.length
              ? presenceBits.filter((value) => value >= 6 - 1e-12).length /
                presenceBits.length
              : null,
          },
          displacementZ: {
            ...distribution(displacementZ),
            ...fractions(displacementZ, [2, 4, 6]),
            fractionAtClamp:
              displacementZ.filter((value) => Math.abs(value) >= 8 - 1e-12)
                .length / displacementZ.length,
          },
          idiosyncrasyZ: {
            ...distribution(idiosyncrasyZ),
            ...fractions(idiosyncrasyZ, [2, 4, 6]),
            fractionAtClamp:
              idiosyncrasyZ.filter((value) => Math.abs(value) >= 8 - 1e-12)
                .length / idiosyncrasyZ.length,
          },
          participationNorm: distribution(participationNorm),
          displacementNorm: distribution(displacementNorm),
          idiosyncrasyNorm: distribution(idiosyncrasyNorm),
          core: {
            ...distribution(cores),
            fractionAbove087:
              cores.filter((value) => value > 0.87).length / cores.length,
          },
        });
      }
    }
  }
  const base = {
    schemaVersion: 1,
    scope: "published_calibration_saturation_diagnosis",
    groundTruthValidation: "REFUSED",
    disclosure: PRE_STREAM_REPLAY_DISCLOSURE,
    corpusSha256: sha256(featureBytes),
    corpusSplitHash: corpus.splitHash,
    caveat:
      "The v1 raw-feature corpus stores axis inputs after the +/-8 z clamp. Clamp fractions are exact, but percentiles above the clamp and unclamped maxima require the separate experimental corpus.",
    rows,
  };
  const artifactHash = sha256(stableJson(base));
  const artifact = { ...base, artifactHash };
  writeFileSync(
    resolve(reports, "attention-saturation-diagnosis.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );

  const lines = [
    "# Attention-score saturation diagnosis — published calibration",
    "",
    "> Population-shape diagnosis only. This does not measure hit rate, discovery quality, latency, or move capture.",
    "",
    `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
    "",
    "The stored v1 corpus contains post-clamp axis inputs. The clamp fractions below are exact; values beyond ±8 and unclamped maxima are intentionally deferred to the experimental raw-scale corpus.",
    "",
    "| Feed | Window | Mode | n | Part. z p50/p90/p99/max | Part. >2/>4/>6/clamp | Presence bits p50/p90/p99/max/cap | Displ. z p50/p90/p99/max | Displ. >2/>4/>6/clamp | Idio z p50/p90/p99/max | Idio >2/>4/>6/clamp | Core p50/p90/p99/max | Core >0.87 |",
    "|---|---|---|---:|---|---|---|---|---|---|---|---|---:|",
  ];
  for (const row of rows as any[]) {
    const d = (value: any) =>
      `${fmt(value.p50)}/${fmt(value.p90)}/${fmt(value.p99)}/${fmt(value.max)}`;
    const f = (value: any) =>
      `${percent(value.above2)}/${percent(value.above4)}/${percent(value.above6)}/${percent(value.fractionAtClamp)}`;
    lines.push(
      `| ${row.feedMode} | ${row.subWindow} | ${row.baselineMode} | ${row.observations} | ${d(row.participationZ)} | ${f(row.participationZ)} | ${d(row.presenceBits)}/${percent(row.presenceBits.fractionAtSixBitCap)} | ${d(row.displacementZ)} | ${f(row.displacementZ)} | ${d(row.idiosyncrasyZ)} | ${f(row.idiosyncrasyZ)} | ${d(row.core)} | ${percent(row.core.fractionAbove087)} |`,
    );
  }
  lines.push(
    "",
    "The JSON companion contains p75 and p95 plus participation, displacement, and idiosyncrasy norm distributions for every row.",
    "",
    `Artifact hash: \`${artifactHash}\`.`,
  );
  writeFileSync(
    resolve(reports, "attention-saturation-diagnosis.md"),
    `${lines.join("\n")}\n`,
  );
  console.log(JSON.stringify({ rows: rows.length, artifactHash }, null, 2));
}

main();
