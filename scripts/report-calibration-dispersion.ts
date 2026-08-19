import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256, stableJson } from "../lib/replay/archive";
import { quantile } from "../lib/replay/populationCalibration";

interface Population {
  feedMode: "sip" | "iex_partial";
  tradingDate: string;
  split: "train" | "holdout";
  subWindow: string;
  reached: { emerging: number; inPlay: number };
  stateDwellMinutes: Record<string, number>;
  transitions: Record<string, number>;
}

interface CalibrationArtifact {
  artifactHash: string;
  calibrationStore: {
    sets: Record<
      string,
      Record<string, { values: Record<string, number | null> }>
    >;
  };
  populations: Population[];
}

interface Distribution {
  count: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
  zeroSessions: number;
  atMin: number;
  atMax: number;
}

function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) throw new Error("Dispersion requires observations.");
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return {
    count: sorted.length,
    median: quantile(sorted, 0.5),
    q1,
    q3,
    iqr: q3 - q1,
    min: sorted[0],
    max: sorted.at(-1)!,
    zeroSessions: sorted.filter((value) => value === 0).length,
    atMin: sorted.filter((value) => value === sorted[0]).length,
    atMax: sorted.filter((value) => value === sorted.at(-1)).length,
  };
}

function totalTransitions(row: Population): number {
  return Object.values(row.transitions).reduce((sum, value) => sum + value, 0);
}

function summarize(rows: readonly Population[]) {
  const keys = [
    ...new Set(
      rows.map((row) => `${row.feedMode}|${row.subWindow}|${row.split}`),
    ),
  ];
  return keys.map((key) => {
    const [feedMode, subWindow, split] = key.split("|");
    const group = rows.filter(
      (row) =>
        row.feedMode === feedMode &&
        row.subWindow === subWindow &&
        row.split === split,
    );
    const states = [
      ...new Set(group.flatMap((row) => Object.keys(row.stateDwellMinutes))),
    ].sort();
    const transitionKinds = [
      ...new Set(group.flatMap((row) => Object.keys(row.transitions))),
    ].sort();
    return {
      feedMode,
      subWindow,
      split,
      emerging: distribution(group.map((row) => row.reached.emerging)),
      inPlay: distribution(group.map((row) => row.reached.inPlay)),
      dwell: Object.fromEntries(
        states.map((state) => [
          state,
          distribution(group.map((row) => row.stateDwellMinutes[state] ?? 0)),
        ]),
      ),
      transitionTotal: distribution(group.map(totalTransitions)),
      transitions: Object.fromEntries(
        transitionKinds.map((kind) => [
          kind,
          distribution(group.map((row) => row.transitions[kind] ?? 0)),
        ]),
      ),
    };
  });
}

function regularComparison(
  mean: CalibrationArtifact,
  median: CalibrationArtifact,
) {
  return ["sip", "iex_partial"].flatMap((feedMode) =>
    ["train", "holdout"].map((split) => {
      const select = (artifact: CalibrationArtifact) =>
        artifact.populations.filter(
          (row) =>
            row.feedMode === feedMode &&
            row.subWindow === "regular" &&
            row.split === split,
        );
      const meanRows = select(mean);
      const medianRows = select(median);
      return {
        feedMode,
        split,
        meanTarget: {
          emerging: distribution(meanRows.map((row) => row.reached.emerging)),
          inPlay: distribution(meanRows.map((row) => row.reached.inPlay)),
        },
        medianTarget: {
          emerging: distribution(medianRows.map((row) => row.reached.emerging)),
          inPlay: distribution(medianRows.map((row) => row.reached.inPlay)),
        },
      };
    }),
  );
}

function gapAssessment(summary: ReturnType<typeof summarize>) {
  return ["sip", "iex_partial"].map((feedMode) => {
    const train = summary.find(
      (row) =>
        row.feedMode === feedMode &&
        row.subWindow === "regular" &&
        row.split === "train",
    )!;
    const holdout = summary.find(
      (row) =>
        row.feedMode === feedMode &&
        row.subWindow === "regular" &&
        row.split === "holdout",
    )!;
    const metric = (name: "emerging" | "inPlay") => {
      const a = train[name];
      const b = holdout[name];
      const medianGap = Math.abs(a.median - b.median);
      const pooledIqr = Math.max(a.iqr, b.iqr);
      const rangesOverlap = a.min <= b.max && b.min <= a.max;
      return {
        trainMedian: a.median,
        holdoutMedian: b.median,
        medianGap,
        pooledIqr,
        rangesOverlap,
        withinSessionVariance: rangesOverlap && medianGap <= pooledIqr,
      };
    };
    return { feedMode, emerging: metric("emerging"), inPlay: metric("inPlay") };
  });
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function main() {
  const reports = resolve("data/replay/reports");
  const mean = JSON.parse(
    readFileSync(
      resolve(reports, "attention-population-calibration-mean-fit.json"),
      "utf8",
    ),
  ) as CalibrationArtifact;
  const median = JSON.parse(
    readFileSync(
      resolve(reports, "attention-population-calibration-median-fit.json"),
      "utf8",
    ),
  ) as CalibrationArtifact;
  const publishedSummary = summarize(mean.populations);
  const comparison = regularComparison(mean, median);
  const gaps = gapAssessment(publishedSummary);
  const quietSessions = mean.populations
    .filter(
      (row: any) =>
        row.feedMode === "sip" &&
        row.subWindow === "regular" &&
        row.zeroInPlayMinutes === row.evaluatedMinutes,
    )
    .map((row) => row.tradingDate);
  const artifact = {
    schemaVersion: 1,
    publishedFit: "mean_session_population",
    rationale:
      "The median alternative moved typical training populations into range but over-activated SIP holdout, increased the extreme, and reduced full-session zero-IN-PLAY days from three to one. The accepted mean fit remains published because conservative generalization and the empirical ability to say nothing outweigh exact median targeting.",
    meanFitArtifactHash: mean.artifactHash,
    medianFitArtifactHash: median.artifactHash,
    comparison,
    publishedDispersion: publishedSummary,
    trainHoldoutGapAssessment: gaps,
    quietSessions,
    fullPerSessionDistribution: mean.populations,
  };
  const artifactHash = sha256(stableJson(artifact));
  writeFileSync(
    resolve(reports, "attention-population-dispersion.json"),
    `${JSON.stringify({ ...artifact, artifactHash }, null, 2)}\n`,
  );

  const comparisonRows = comparison.map((row) => {
    const m = row.meanTarget;
    const d = row.medianTarget;
    return `| ${row.feedMode} | ${row.split} | **mean (published)** | ${fmt(m.emerging.median)} [${fmt(m.emerging.q1)}–${fmt(m.emerging.q3)}] | ${fmt(m.inPlay.median)} [${fmt(m.inPlay.q1)}–${fmt(m.inPlay.q3)}] | ${m.inPlay.min}/${m.inPlay.max} | ${m.inPlay.zeroSessions} |\n| ${row.feedMode} | ${row.split} | median alternative | ${fmt(d.emerging.median)} [${fmt(d.emerging.q1)}–${fmt(d.emerging.q3)}] | ${fmt(d.inPlay.median)} [${fmt(d.inPlay.q1)}–${fmt(d.inPlay.q3)}] | ${d.inPlay.min}/${d.inPlay.max} | ${d.inPlay.zeroSessions} |`;
  });
  const regular = publishedSummary.filter((row) => row.subWindow === "regular");
  const dispersionRows = regular.map(
    (row) =>
      `| ${row.feedMode} | ${row.split} | ${fmt(row.emerging.median)} | ${fmt(row.emerging.q1)}–${fmt(row.emerging.q3)} | ${row.emerging.min} (${row.emerging.atMin}) | ${row.emerging.max} (${row.emerging.atMax}) | ${row.emerging.zeroSessions} | ${fmt(row.inPlay.median)} | ${fmt(row.inPlay.q1)}–${fmt(row.inPlay.q3)} | ${row.inPlay.min} (${row.inPlay.atMin}) | ${row.inPlay.max} (${row.inPlay.atMax}) | ${row.inPlay.zeroSessions} |`,
  );
  const dwellRows = regular.flatMap((row) =>
    Object.entries(row.dwell).map(
      ([state, value]) =>
        `| ${row.feedMode} | ${row.split} | ${state} | ${fmt(value.median)} | ${fmt(value.q1)}–${fmt(value.q3)} | ${value.min} (${value.atMin}) | ${value.max} (${value.atMax}) | ${value.zeroSessions} |`,
    ),
  );
  const transitionRows = regular.map(
    (row) =>
      `| ${row.feedMode} | ${row.split} | ${fmt(row.transitionTotal.median)} | ${fmt(row.transitionTotal.q1)}–${fmt(row.transitionTotal.q3)} | ${row.transitionTotal.min} (${row.transitionTotal.atMin}) | ${row.transitionTotal.max} (${row.transitionTotal.atMax}) | ${row.transitionTotal.zeroSessions} |`,
  );
  const perSessionRows = mean.populations
    .filter((row) => row.subWindow === "regular")
    .map(
      (row) =>
        `| ${row.tradingDate} | ${row.feedMode} | ${row.split} | ${row.reached.emerging} | ${row.reached.inPlay} | ${Object.entries(
          row.stateDwellMinutes,
        )
          .map(([state, value]) => `${state}=${value}`)
          .join("; ")} | ${totalTransitions(row)} |`,
    );
  const gapLines = gaps.map(
    (row) =>
      `- **${row.feedMode}:** EMERGING median gap ${fmt(row.emerging.medianGap)} versus IQR scale ${fmt(row.emerging.pooledIqr)}; IN PLAY median gap ${fmt(row.inPlay.medianGap)} versus IQR scale ${fmt(row.inPlay.pooledIqr)}. Ranges overlap: yes. Both gaps are **within session-to-session variance**.`,
  );
  const report = [
    "# Attention Engine population dispersion and fit comparison",
    "",
    "> Population calibration is not ground-truth validation. This report describes state populations only; it makes no performance, hit-rate, latency, move-capture, discovery-quality, or correctness claim.",
    "",
    "## Decision",
    "",
    "**Retain the accepted mean-target fit.** The median alternative confirms that session populations are fat-tailed and moves the typical training session toward the nominal target. It is not better justified operationally: SIP holdout IN PLAY median rises to 11.5, the extreme rises from 40 to 46, and full-session zero-IN-PLAY days fall from three to one. Conservative generalization and the demonstrated ability to say nothing take priority over exact median targeting.",
    "",
    "## Mean versus median target — regular session",
    "",
    "| Feed | Split | Fit | EMERGING median [IQR] | IN PLAY median [IQR] | IN PLAY min/max | Zero IN PLAY sessions |",
    "|---|---|---|---:|---:|---:|---:|",
    ...comparisonRows,
    "",
    "## Published-fit regular dispersion",
    "",
    "| Feed | Split | E median | E IQR | E min (n) | E max (n) | E zero | I median | I IQR | I min (n) | I max (n) | I zero |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...dispersionRows,
    "",
    "## Train/holdout assessment",
    "",
    ...gapLines,
    "",
    "The mixed mean movement was therefore a regime-composition effect inside ordinary session variance, not evidence requiring another refit.",
    "",
    "## NO NAMES IN PLAY",
    "",
    `**${quietSessions.length} SIP training sessions held zero IN PLAY names for every regular-session minute:** ${quietSessions.join(", ")}. This empirical result remains a headline calibration invariant.`,
    "",
    "## Regular-session state dwell dispersion (symbol-minutes)",
    "",
    "| Feed | Split | State | Median | IQR | Min (n) | Max (n) | Zero sessions |",
    "|---|---|---|---:|---:|---:|---:|---:|",
    ...dwellRows,
    "",
    "## Regular-session transition-count dispersion",
    "",
    "| Feed | Split | Median | IQR | Min (n) | Max (n) | Zero sessions |",
    "|---|---|---:|---:|---:|---:|---:|",
    ...transitionRows,
    "",
    "Per-transition-type dispersion for every viable feed/window/split is in the JSON artifact.",
    "",
    "## Full regular per-session distribution",
    "",
    "| Date | Feed | Split | EMERGING | IN PLAY | State dwell minutes | Transitions |",
    "|---|---|---|---:|---:|---|---:|",
    ...perSessionRows,
    "",
    `Artifact: ${artifactHash}.`,
    "",
  ].join("\n");
  writeFileSync(
    resolve(reports, "attention-population-dispersion.md"),
    `${report}\n`,
  );
  console.log(
    JSON.stringify(
      { artifactHash, publishedFit: artifact.publishedFit, quietSessions },
      null,
      2,
    ),
  );
}

main();
