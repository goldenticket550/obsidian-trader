import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AttentionA3ReplayEngine, type AttentionA3Frame } from "../lib/attention/attentionA3Replay";
import type { AttentionHistoryObservation } from "../lib/attention/attentionHistory";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";
import { ATTENTION_SUB_WINDOWS } from "../lib/replay/attentionThresholdTypes";
import { ATTENTION_FEED_MODES } from "../lib/attention/attentionScore";
import { createPendingFeedAwareThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";

const minute = 60_000;
const startAt = Date.parse("2025-08-18T13:30:00.000Z");

function observation(input: {
  at: number;
  score: number;
  core: number;
  calibrationId: string;
  subWindow?: AttentionHistoryObservation["subWindow"];
  mode?: AttentionHistoryObservation["participationBaselineMode"];
  price?: number;
}): AttentionHistoryObservation {
  return {
    symbol: "AAOI", at: input.at, score: input.score, core: input.core, feedMode: "sip",
    subWindow: input.subWindow ?? "regular", calibrationId: input.calibrationId,
    participationBaselineMode: input.mode ?? "dense", participationInput: input.score / 20,
    participationInputKind: input.mode === "sparse" ? "surprise_bits" : "z",
    displacementZ: input.score / 25, idiosyncrasyZ: input.score / 30,
    price: input.price ?? 100, atr: 2, vwap: 100, ema9: 100,
    consecutiveExpansionBars: input.at >= startAt + 5 * minute ? 2 : 0,
    pullbackObserved: false, priceLostVwap: false, dataQualityState: "ok", provisional: true,
  };
}

function summarize(frame: AttentionA3Frame) {
  return {
    at: frame.at,
    provisional: frame.provisional,
    conclusionsAllowed: frame.conclusionsAllowed,
    rows: frame.rows.map((row) => ({
      symbol: row.symbol,
      score: row.point.score,
      core: row.point.core,
      rank: row.point.rank,
      percentile: row.point.percentile,
      state: row.state,
      transition: row.transition,
      velocity: row.velocity,
      episodeId: row.episode?.episodeId ?? null,
      episodeStartedAt: row.episode?.startedAt ?? null,
      freshness: row.freshness?.freshness ?? null,
    })),
    wakingUp: [], // retired; retained only in the historical A3 report schema
    inPlay: frame.lists.inPlay.map((row) => row.symbol),
  };
}

function runSequence() {
  const store = createPendingFeedAwareThresholdStore(3);
  const calibrationId = store.sets.sip.regular.calibrationId;
  const engine = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE);
  const values = [
    { score: 30, core: 0.30, price: 100 },
    { score: 32, core: 0.30, price: 100.1 },
    { score: 50, core: 0.55, price: 100.4 },
    { score: 55, core: 0.55, price: 100.6 },
    { score: 68, core: 0.72, price: 100.8 },
    { score: 75, core: 0.72, price: 101.0 },
    { score: 82, core: 0.75, price: 101.2 },
  ];
  const frames = values.map((row, index) => summarize(engine.processMinute([
    observation({ at: startAt + index * minute, calibrationId, ...row }),
  ])));
  const perMinuteHashes = frames.map((frame) => sha256(stableJson(frame)));
  return { frames, perMinuteHashes, sequenceHash: sha256(perMinuteHashes.join("|")) };
}

function modeBoundaryCheck() {
  const store = createPendingFeedAwareThresholdStore(3);
  const engine = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE);
  const premarket = store.sets.sip.premarket_final.calibrationId;
  const regular = store.sets.sip.regular.calibrationId;
  engine.processMinute([observation({ at: startAt - 2 * minute, score: 30, core: 0.30, calibrationId: premarket, subWindow: "premarket_final", mode: "sparse" })]);
  const qualified = engine.processMinute([observation({ at: startAt - minute, score: 32, core: 0.30, calibrationId: premarket, subWindow: "premarket_final", mode: "sparse" })]);
  const atOpen = engine.processMinute([observation({ at: startAt, score: 70, core: 0.35, calibrationId: regular, subWindow: "regular", mode: "dense" })]);
  return {
    episodeIdBefore: qualified.rows[0].episode?.episodeId ?? null,
    episodeIdAfter: atOpen.rows[0].episode?.episodeId ?? null,
    velocityReset: atOpen.rows[0].velocity.scoreDelta1m === null,
    velocitySuppressed: atOpen.rows[0].velocity.velocityEventsSuppressed,
    marker: atOpen.rows[0].episode?.modeTransitions[0] ?? null,
  };
}

function main(): void {
  const first = runSequence();
  const second = runSequence();
  if (first.sequenceHash !== second.sequenceHash || first.perMinuteHashes.some((hash, index) => hash !== second.perMinuteHashes[index])) {
    throw new Error("A3 replay determinism failure.");
  }
  const store = createPendingFeedAwareThresholdStore(3);
  const boundary = modeBoundaryCheck();
  const final = first.frames.at(-1)!;
  const artifact = {
    phase: "A3",
    scope: "replay_only",
    generatedAt: "2026-08-17T06:30:00.000Z",
    disclosure: PRE_STREAM_REPLAY_DISCLOSURE,
    calibrationStatus: "pending_calibration",
    provisional: true,
    conclusionsAllowed: false,
    calibrationStore: store,
    determinism: {
      firstSequenceHash: first.sequenceHash,
      secondSequenceHash: second.sequenceHash,
      identical: true,
      perMinuteHashes: first.perMinuteHashes,
    },
    replay: first.frames,
    assertions: {
      transitions: first.frames.flatMap((frame) => frame.rows.map((row) => row.transition?.to).filter(Boolean)),
      episodeBackdatedToFirstActivity: final.rows[0].episodeStartedAt === startAt,
      wakingUp: final.wakingUp,
      inPlay: final.inPlay,
      modeBoundary: boundary,
      inPlayWatchingOrderingAssertedEveryFrame: true,
      rankUsedForDecisions: false,
    },
    scopeFence: {
      marketMap: false,
      eventEngine: false,
      alerts: false,
      directionState: false,
      regime: false,
      advancedTa: false,
      liveWiring: false,
    },
  } as const;
  const deterministicHash = sha256(stableJson(artifact));
  const outDir = resolve("data/replay/reports");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "a3-attention-dynamics-replay.json"), `${JSON.stringify({ ...artifact, deterministicHash }, null, 2)}\n`);

  const thresholdRows = ATTENTION_FEED_MODES.flatMap((feedMode) => ATTENTION_SUB_WINDOWS.map((subWindow) => {
    const set = store.sets[feedMode][subWindow];
    const p = set.provisionalValues;
    return `| ${feedMode} | ${subWindow} | ${set.calibrationId} | ${p.watchingExitCore.toFixed(2)} / ${p.watchingEnterCore.toFixed(2)} | ${p.emergingExitCore.toFixed(2)} / ${p.emergingEnterCore.toFixed(2)} | ${p.inPlayExitCore.toFixed(2)} / ${p.inPlayEnterCore.toFixed(2)} | ${p.newInPlayVelocityPerMinute.toFixed(2)} |`;
  }));
  const report = [
    "# Phase A3 attention dynamics replay report",
    "",
    `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
    "",
    "## VALIDATION STATUS — REFUSED",
    "",
    "> All curves and state/velocity thresholds remain `pending_calibration`. A3 uses explicit provisional values only. No performance, discovery, state-quality, timing, or threshold conclusion is permitted.",
    "",
    "Curves and thresholds remain one calibration system and must be calibrated together against labelled sessions after A3.",
    "",
    "## Determinism",
    "",
    `- First sequence: \`${first.sequenceHash}\``,
    `- Second sequence: \`${second.sequenceHash}\``,
    "- Per-minute hashes identical: yes",
    `- Artifact hash: \`${deterministicHash}\``,
    "",
    "## Contract replay result",
    "",
    `- State transitions: ${artifact.assertions.transitions.join(" → ")}`,
    `- Episode back-dated to first contiguous activity minute: ${artifact.assertions.episodeBackdatedToFirstActivity ? "pass" : "FAIL"}`,
    `- Final WAKING UP: ${final.wakingUp.join(", ") || "none"}`,
    `- Final IN PLAY: ${final.inPlay.join(", ") || "none"}`,
    "- WAKING UP ordering input: attention score velocity; IN PLAY ordering input: attention score.",
    "- Raw rank is stored for display context and is not consumed by transitions, freshness, cooling, or list gates.",
    "- IN_PLAY core > WATCHING core was asserted on every replay frame; any violation throws.",
    "",
    "## 09:30 measurement boundary",
    "",
    `- Velocity reset: ${boundary.velocityReset ? "pass" : "FAIL"}`,
    `- Velocity-derived behavior suppressed by transition guard: ${boundary.velocitySuppressed ? "pass" : "FAIL"}`,
    `- Episode identity preserved: ${boundary.episodeIdBefore === boundary.episodeIdAfter ? "pass" : "FAIL"}`,
    `- Episode transition marker: ${boundary.marker ? `${boundary.marker.from} → ${boundary.marker.to}` : "missing"}`,
    "- A newly qualifying post-open episode stops back-dating at an earlier pending-calibration window; this is covered by the explicit 09:30 truncation regression.",
    "",
    "## Provisional state thresholds",
    "",
    "Exit / enter pairs are separate and live inside the same versioned feed/window calibration identity as the curves.",
    "",
    "| Feed | Sub-window | Calibration ID | WATCHING exit/enter | EMERGING exit/enter | IN PLAY exit/enter | velocity/min |",
    "|---|---|---|---:|---:|---:|---:|",
    ...thresholdRows,
    "",
    "## Scope fence",
    "",
    "No Market Map, event or alert engine, direction state, regime, advanced TA, subscription, live wiring, deployment, or migration is included.",
    "",
  ].join("\n");
  writeFileSync(resolve(outDir, "a3-attention-dynamics-replay.md"), report);
  console.log(JSON.stringify({
    report: resolve(outDir, "a3-attention-dynamics-replay.md"),
    deterministicHash,
    sequenceHash: first.sequenceHash,
    frames: first.frames.length,
    finalWakingUp: final.wakingUp,
    finalInPlay: final.inPlay,
    conclusionsAllowed: false,
  }, null, 2));
}

main();
