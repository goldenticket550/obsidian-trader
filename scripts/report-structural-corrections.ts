import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";

const reports = resolve("data/replay/reports");
mkdirSync(reports, { recursive: true });
const smoothing = JSON.parse(readFileSync(resolve(reports, "in-play-liveness-frontier.json"), "utf8"));
const waking = JSON.parse(readFileSync(resolve(reports, "waking-up-usability-calibration.json"), "utf8"));
const fixed = (n: number) => smoothing.smoothingComparison.find((row: any) => row.scenario.stateSmoothingMinutes === n);
const band = (n: number) => smoothing.results.filter((row: any) => {
  const [train, holdout] = row.splits;
  return row.scenario.stateSmoothingMinutes === n && train.coverage >= .15 && train.coverage <= .30 && holdout.coverage >= .15 && holdout.coverage <= .30;
});
const shortest = (n: number) => [...band(n)].sort((a: any, b: any) => a.scenario.exitPersistence - b.scenario.exitPersistence || a.splits[0].scoreDecayAtDisplay.median - b.splits[0].scoreDecayAtDisplay.median)[0] ?? null;
const maxDwell = Object.fromEntries(waking.isolated.map((group: any) => [group.lever, Math.max(...group.results.map((row: any) => row.splits[0].wakingDwellMinutes.median ?? 0))]));
const artifact: any = {
  schemaVersion: 1,
  status: "STRUCTURAL_CORRECTIONS_REJECTED_ON_HOLDOUT",
  groundTruthValidation: "REFUSED",
  disclosure: PRE_STREAM_REPLAY_DISCLOSURE,
  splitHash: waking.splitHash,
  stateSmoothing: {
    testedMinutes: [0, 3, 5],
    mechanismImplemented: true,
    stateUsesSmoothedCoreOnly: true,
    velocityAndDisplayedScoreRemainRaw: true,
    fixedPolicy: [fixed(0), fixed(3), fixed(5)],
    shortestUsableCoveragePolicy: [shortest(0), shortest(3), shortest(5)],
    publishedStateSmoothingMinutes: 0,
    finding: "Three-minute smoothing increased transition churn and still required 30-minute exit persistence; five-minute smoothing produced no train/holdout point in the 15-30% coverage band. Neither setting achieved the correction's purpose."
  },
  wakingUp: {
    decoupledFromStateEpisodeAndFreshness: true,
    reference: "direction inferred from current price versus oldest price in the rolling 15-minute window; extension is distance from the rolling low for rising paths or rolling high for falling paths, in ATR",
    currentDecoupled: waking.current.splits,
    rejectedBestCandidate: waking.selectedCandidate,
    rejectedCandidateResult: waking.final.splits,
    oneLeverMaximumTrainMedianDwell: maxDwell,
    postFixFunnel: waking.postFixFunnel,
    publishedWakingConfig: null,
    finding: "Decoupling restored reachability, but no tested configuration jointly met coverage, five-minute dwell, lead-time, and quiet-session constraints."
  },
  exitRefit: {
    performedAfterCorrections: false,
    reason: "The authorized stopping condition applies because WAKING UP remains unusable after decoupling; no substrate/configuration was published."
  },
  fiveSessionDigest: {
    rerun: false,
    reason: "No accepted configuration exists to compare; publishing a digest as though a fit succeeded would be misleading."
  }
};
artifact.artifactHash = sha256(stableJson(artifact));
writeFileSync(resolve(reports, "structural-corrections-holdout.json"), JSON.stringify(artifact, null, 2) + "\n");
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmt = (v: number | null) => v === null ? "n/a" : v.toFixed(2);
const fixedRow = (row: any) => {
  const [tr, ho] = row.splits;
  return `| ${row.scenario.stateSmoothingMinutes} | ${pct(tr.coverage)} | ${pct(ho.coverage)} | ${pct(tr.settledShare)} | ${pct(ho.settledShare)} | ${fmt(tr.scoreDecayAtDisplay.median)} | ${fmt(ho.scoreDecayAtDisplay.median)} | ${tr.transitionCount} | ${ho.transitionCount} |`;
};
const wakeRow = (label: string, row: any) => `| ${label} | ${pct(row.fractionMinutesWithWakingUp)} | ${fmt(row.wakingDwellMinutes.median)} [${fmt(row.wakingDwellMinutes.p25)}-${fmt(row.wakingDwellMinutes.p75)}] | ${fmt(row.leadTimeToInPlayMinutes.median)} | ${row.quietSessions.length} |`;
const lines = [
  "# Structural corrections — train/holdout result",
  "",
  `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
  "",
  "> Population behavior only. Ground-truth validation remains refused.",
  "",
  "## Outcome",
  "",
  "Neither structural proposal produced an acceptable publishable policy. The mechanisms are implemented and replayable, but active state smoothing remains `0`, no WAKING UP gate is published, and the requested downstream exit refit/digest were stopped by the explicit failure condition.",
  "",
  "## Correction 2 — state-only rolling median",
  "",
  "Velocity and displayed score remain raw. State decisions and I1-I4' use `coreSmoothed`.",
  "",
  "| Minutes | Train coverage | Holdout coverage | Train settled | Holdout settled | Train decay | Holdout decay | Train transitions | Holdout transitions |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ...artifact.stateSmoothing.fixedPolicy.map(fixedRow),
  "",
  "At matched 15-30% train/holdout coverage, 3-minute smoothing still required 30-minute exit persistence. Five-minute smoothing had no point in the coverage band. The 3-minute fixed policy increased transitions; 5 minutes reduced churn only by collapsing coverage. Therefore neither 3 nor 5 minutes is published.",
  "",
  "## Correction 1 — state/episode-independent WAKING UP",
  "",
  "Eligibility uses raw attention velocity, an absolute-score floor, acceptable data quality, rolling price extension, and independent short persistence. State, episode, and freshness are not gates; freshness is display-only and is `n/a` without an episode.",
  "",
  "| Policy / split | Minute coverage | Dwell median [IQR] | Lead median | Quiet sessions |",
  "|---|---:|---:|---:|---:|",
  wakeRow("Original decoupled / train", waking.current.splits[0]),
  wakeRow("Original decoupled / holdout", waking.current.splits[1]),
  wakeRow("Rejected quiet-preserving / train", waking.final.splits[0]),
  wakeRow("Rejected quiet-preserving / holdout", waking.final.splits[1]),
  "",
  `Every isolated lever had a maximum training median dwell of one minute: ${Object.entries(maxDwell).map(([k,v]) => `${k}=${v}`).join(", ")}. The original decoupled gate restored coverage but violated quiet-session preservation and provided one-minute dwell. The quiet-preserving candidate collapsed to ${pct(waking.final.splits[0].fractionMinutesWithWakingUp)} train / ${pct(waking.final.splits[1].fractionMinutesWithWakingUp)} holdout, still with one-minute dwell; holdout lead was ${fmt(waking.final.splits[1].leadTimeToInPlayMinutes.median)} minutes.`,
  "",
  "**Finding:** the early-surfacing thesis is not supported by this corpus under the tested gate family and usability constraints. No WAKING configuration is published.",
  "",
  "## Deliberately not run",
  "",
  "The exit refit and five-session post-fit digest were not run because there is no accepted smoothed substrate or WAKING configuration. This follows the requested stopping condition and avoids presenting a rejected candidate as a fit.",
  "",
  `Artifact: \`${artifact.artifactHash}\`. Ground truth: **REFUSED**.`
];
writeFileSync(resolve(reports, "structural-corrections-holdout.md"), lines.join("\n") + "\n");
console.log(JSON.stringify({ artifactHash: artifact.artifactHash, status: artifact.status }, null, 2));