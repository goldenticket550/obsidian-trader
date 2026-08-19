import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PRE_STREAM_REPLAY_DISCLOSURE,
  sha256,
  stableJson,
} from "../lib/replay/archive";

function read(name: string): any {
  return JSON.parse(readFileSync(resolve("data/replay/reports", name), "utf8"));
}
function value(input: number | null): string {
  return input === null ? "n/a" : Number(input).toFixed(4);
}
function pct(input: number | null): string {
  return input === null ? "n/a" : `${(100 * input).toFixed(2)}%`;
}
function dist(input: any): string {
  return `${value(input.p50)}/${value(input.p75)}/${value(input.p90)}/${value(input.p95)}/${value(input.p99)}/${value(input.max)}`;
}
function tails(input: any): string {
  return `${pct(input.above2)}/${pct(input.above4)}/${pct(input.above6)}/${pct(input.wouldHitCap ?? input.fractionAtClamp)}`;
}

function main(): void {
  const reports = resolve("data/replay/reports");
  mkdirSync(reports, { recursive: true });
  const published = read("attention-saturation-diagnosis.json");
  const experiments = read("attention-saturation-experiments.json");
  const candidates = read("attention-saturation-candidate-replay.json");
  const population = read("attention-population-calibration.json");
  const publishedByKey = new Map(
    published.rows.map((row: any) => [
      `${row.feedMode}|${row.subWindow}|${row.baselineMode}`,
      row,
    ]),
  );
  const rawTable = experiments.rawRows.map((row: any) => {
    const presence = row.presenceBits.count
      ? `${dist(row.presenceBits)} / ${pct(row.presenceBits.fractionAtSixBitCap)}`
      : "n/a";
    return `| ${row.feedMode} | ${row.subWindow} | ${row.baselineMode} | ${dist(row.participationRaw)} | ${tails(row.participationRaw)} | ${presence} | ${dist(row.displacementRaw)} | ${tails(row.displacementRaw)} | ${dist(row.idiosyncrasyRaw)} | ${tails(row.idiosyncrasyRaw)} |`;
  });
  const scoreTable = experiments.rawRows.map((raw: any) => {
    const row: any = publishedByKey.get(
      `${raw.feedMode}|${raw.subWindow}|${raw.baselineMode}`,
    );
    return `| ${raw.feedMode} | ${raw.subWindow} | ${raw.baselineMode} | ${dist(row.participationNorm)} | ${dist(row.displacementNorm)} | ${dist(row.idiosyncrasyNorm)} | ${dist(row.core)} | ${pct(row.core.fractionAbove087)} |`;
  });
  const candidateTable = candidates.results.map(
    (row: any) =>
      `| ${row.candidate} | ${row.episodes} | ${dist(row.peakAttention)} | ${row.exactHundred} (${pct(row.fractionExactHundred)}) | ${row.rankOne} (${pct(row.fractionRankOne)}) | ${row.uniquePeaksAtOneDecimal} | ${row.acceptancePeakHundredAtMostTenPercent ? "PASS" : "FAIL"} |`,
  );
  const histogram = population.inPlayCountDistribution;
  const histogramTable = Object.entries(histogram.histogram)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(
      ([count, minutes]) =>
        `| ${count} | ${minutes} | ${pct(Number(minutes) / histogram.evaluatedMinutes)} |`,
    );
  const lines = [
    "# Attention-score saturation diagnosis and candidate evaluation",
    "",
    "> Diagnostic and experimental replay only. No candidate curve, transform, threshold, or final-score rescale in this report has been published to the active calibration.",
    "",
    "> Ground-truth validation remains REFUSED. This report describes score/population behavior, not discovery quality or trading performance.",
    "",
    `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
    "",
    "## Result",
    "",
    "The MAD-tail hypothesis is confirmed for Participation. In SIP regular dense buckets, unclamped participation z is p50 0.0971, p95 5.1467, p99 12.5299, max 494.6853; 2.36% of observations would hit the ±8 clamp. The dollar-volume component is p99 12.7635 and max 511.8272. `log1p` reduces participation p99 to 3.9493 and the would-clamp share to 0.26%.",
    "",
    "It is not symmetric across axes. SIP regular Displacement is p99 3.4697 and only 0.05% would hit ±8; logging range reduces an already much smaller tail. Idiosyncrasy is also heavy-tailed (p99 8.5816; 1.23% would hit ±8) and remains a separate finding.",
    "",
    "A (log participation), B (empirical z50/k from unclamped observations), and their combinations all FAIL the episode-level acceptance test. Their best requested result still has 45/74 (60.8%) episode peaks at exactly 100. Minute-scale tail repair is real, but the hard final clamp remains many-to-one after state thresholds select session maxima.",
    "",
    "An additional control normalizes by the formula's theoretical maximum modifier instead of clipping: `attention = 100 * core * modifier / 1.15`. It changes neither core nor confluence. Alone it produces 0/155 exact-100 peaks. Combined with log participation plus log range it produces 0/74 exact-100 peaks, 70.1713–98.4163 range, and 62 distinct one-decimal peaks. This clears the numerical acceptance condition but is PROPOSED FOR ADJUDICATION, NOT ACTIVE.",
    "",
    "## Empirical unclamped axis inputs",
    "",
    "Distribution cells are p50/p75/p90/p95/p99/max. Tail cells are fractions >2/>4/>6/would-hit-±8. Presence cells add the fraction at the six-bit cap.",
    "",
    "| Feed | Window | Mode | Participation z | Participation tails | Presence bits / cap | Displacement z | Displacement tails | Idiosyncrasy z | Idiosyncrasy tails |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rawTable,
    "",
    "## Published norm and core distributions",
    "",
    "Distribution cells are p50/p75/p90/p95/p99/max. These rows use the currently published curves and post-clamp inputs.",
    "",
    "| Feed | Window | Mode | Participation norm | Displacement norm | Idiosyncrasy norm | Core | Core >0.87 |",
    "|---|---|---|---|---|---|---|---:|",
    ...scoreTable,
    "",
    "## Five-session episode comparison",
    "",
    "| Candidate | Episodes | Peak attention p50/p75/p90/p95/p99/max | Exact 100 | Peak rank 1 | Unique peaks at 0.1 | Acceptance |",
    "|---|---:|---|---:|---:|---:|---|",
    ...candidateTable,
    "",
    "The proposed digest is `attention-session-digest-proposed.md`; its header marks the treatment experimental and unpublished.",
    "",
    "## Digest contradiction resolved",
    "",
    "This was a reporting defect, not an engine state-tracking defect. The old `Duration` mixed episode lifetime with IN PLAY occupancy, and the collector continued advancing `lastAt` on already-completed episodes. The table now has separate `Episode lifetime` and `IN PLAY occupancy` columns and freezes lifetime at completion. GDX now reads: start 10:47 ET, episode lifetime 6 minutes, IN PLAY occupancy 2 minutes. The 14:06–16:00 quiet stretch is therefore consistent.",
    "",
    "## Per-minute IN PLAY population — published SIP regular",
    "",
    `Across ${histogram.evaluatedMinutes} minutes, zero names were IN PLAY for ${histogram.histogram["0"]} minutes (${pct(histogram.histogram["0"] / histogram.evaluatedMinutes)}). The peak was ${histogram.peakSimultaneousInPlay}/61; ${histogram.broadTapeMinutes} minutes had at least ${histogram.broadTapeThreshold}.`,
    "",
    "This is not bimodal. It is a dominant atom at zero with a very thin, extremely right-tailed nonzero distribution. The 30+ rows are broad-tape regime evidence and remain in engine state/logging; a separate 12-row presentation cap prevents the UI from rendering the entire population.",
    "",
    "| Simultaneous IN PLAY | Minutes | Share |",
    "|---:|---:|---:|",
    ...histogramTable,
    "",
  ];
  const base = {
    schemaVersion: 1,
    scope: "diagnosis_and_candidate_evaluation_only",
    activeCalibrationChanged: false,
    proposedForAdjudication: candidates.proposedForAdjudication,
    sourceHashes: {
      publishedDiagnosis: published.artifactHash,
      experiments: experiments.artifactHash,
      candidateReplay: candidates.artifactHash,
      population: population.artifactHash,
    },
  };
  const artifactHash = sha256(stableJson(base));
  lines.push(`Report identity: \`${artifactHash}\`.`);
  writeFileSync(
    resolve(reports, "attention-saturation-resolution.md"),
    `${lines.join("\n")}\n`,
  );
  writeFileSync(
    resolve(reports, "attention-saturation-resolution.json"),
    `${JSON.stringify({ ...base, artifactHash }, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        proposedForAdjudication: candidates.proposedForAdjudication,
        artifactHash,
      },
      null,
      2,
    ),
  );
}

main();
