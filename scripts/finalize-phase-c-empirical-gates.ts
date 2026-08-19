import { readFileSync, writeFileSync } from "node:fs";
import { sha256, stableJson } from "../lib/replay/archive";

const jsonPath = "data/replay/reports/phase-c-empirical-gate-diagnostics.json";
const markdownPath = "data/replay/reports/phase-c-empirical-gate-diagnostics.md";
const artifact = JSON.parse(readFileSync(jsonPath, "utf8"));
delete artifact.artifactHash;
artifact.recommendations.acceleration = {
  status: "VIABLE_AS_RARE_TWO_MINUTE_D1_CANDIDATE",
  definition: "D1_EMA9_ONLY",
  persistenceMinutes: 2,
  potentialEventsAcrossFiveSessions: 4,
  oneMinuteCandidateEvents: 52,
  oneMinuteRecommendation: "do_not_publish_without_labels",
  published: false,
};
artifact.artifactHash = sha256(stableJson(artifact));
writeFileSync(jsonPath, JSON.stringify(artifact, null, 2) + "\n");

let markdown = readFileSync(markdownPath, "utf8");
markdown = markdown.replace(
  "Active policy is unchanged: D3, key-level floor 90, acceleration persistence 2 minutes. Recommendations remain pending trader adjudication.",
  [
    "## Recommendations — not published",
    "",
    "- Freshness: D1 (EMA9-only) for trader adjudication. VWAP distance and expansion run remain separate factual badges.",
    "- Key levels: p90 / 84.11 as the conservative distribution-derived starting point.",
    "- ACCELERATION: 2-minute+D1 is population-viable as a rare secondary event (4 candidates across five sessions). One-minute+D1 yields 52 and is not publishable without labels. Retirement is not justified yet, but neither is activation.",
    "",
    "Active policy remains unchanged: D3, key-level floor 90, acceleration persistence 2 minutes.",
  ].join("\n"),
);
markdown = markdown.replace(/Artifact: `[^`]+`\./, `Artifact: \`${artifact.artifactHash}\`.`);
writeFileSync(markdownPath, markdown);
console.log(artifact.artifactHash);
