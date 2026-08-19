import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeAttentionAxis,
  type AttentionAxisResult,
  type AxisNormalizationConfig,
  type IdiosyncrasyAxisResult,
  type ParticipationAxisResult,
} from "../lib/attention/attentionAxes";
import {
  ATTENTION_FEED_MODES,
  ATTENTION_SCORE_CALIBRATION_GUARDS,
  scoreAttention,
  type AttentionFeedMode,
} from "../lib/attention/attentionScore";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";
import {
  ATTENTION_SUB_WINDOWS,
  type AttentionSubWindow,
} from "../lib/replay/attentionThresholdTypes";
import {
  calibrationSetForScore,
  createPendingFeedAwareThresholdStore,
  type FeedAwareAttentionThresholdSet,
  type FeedAwareAttentionThresholdStore,
} from "../lib/replay/feedAwareAttentionThresholds";

const CURVE_INPUTS = [0, 1, 2, 3, 4, 6] as const;

function participation(z: number, curve: AxisNormalizationConfig): ParticipationAxisResult {
  return {
    axis: "participation", status: "ok", value: z, normalizationInput: z, normalizationInputKind: "z",
    z50: curve.z50, k: curve.k, normalized: normalizeAttentionAxis(z, curve),
    baselineMode: "dense", unavailableReason: null, firstObservedActivity: false,
    requiresDisplacementConfluence: false, currentVolume: 3_000_000, currentDollarVolume: 450_000_000,
    components: [
      { name: "volume", baselineTransform: "log1p", rawValue: 3_000_000, baselineMedian: 1_000_000, baselineMad: 449_667, pPresent: null, surpriseBits: null, signalKind: "median_mad_z", baselineMode: "dense", baselineState: "ok", z },
      { name: "dollar_volume", baselineTransform: "log1p", rawValue: 450_000_000, baselineMedian: 150_000_000, baselineMad: 67_450_000, pPresent: null, surpriseBits: null, signalKind: "median_mad_z", baselineMode: "continuous", baselineState: "ok", z },
    ],
  };
}

function displacement(z: number, curve: AxisNormalizationConfig): AttentionAxisResult {
  return {
    axis: "displacement", status: "ok", value: z, normalizationInput: z, normalizationInputKind: "z",
    z50: curve.z50, k: curve.k, normalized: normalizeAttentionAxis(z, curve),
    baselineMode: "continuous", unavailableReason: null,
    components: [
      { name: "range_atr", baselineTransform: "log1p", rawValue: 1.5, baselineMedian: 0.5, baselineMad: 0.27, pPresent: null, surpriseBits: null, signalKind: "median_mad_z", baselineMode: "continuous", baselineState: "ok", z },
      { name: "path_efficiency", baselineTransform: "linear", rawValue: 0.8, baselineMedian: 0.45, baselineMad: 0.094, pPresent: null, surpriseBits: null, signalKind: "median_mad_z", baselineMode: "continuous", baselineState: "ok", z },
    ],
  };
}

function idiosyncrasy(z: number, curve: AxisNormalizationConfig): IdiosyncrasyAxisResult {
  return {
    axis: "idiosyncrasy", status: "ok", value: z, normalizationInput: z, normalizationInputKind: "z",
    z50: curve.z50, k: curve.k, normalized: normalizeAttentionAxis(z, curve),
    baselineMode: "continuous", unavailableReason: null, stockReturn: 0.02, benchmarkReturn: 0.01,
    sectorReturn: 0.011, stockVsBenchmark: 0.01, sectorVsBenchmark: 0.001,
    classification: "stock_specific",
    components: [
      { name: "stock_vs_benchmark", baselineTransform: "linear", rawValue: 0.01, baselineMedian: 0.008, baselineMad: 0.0067, pPresent: null, surpriseBits: null, signalKind: "median_mad_z", baselineMode: "continuous", baselineState: "ok", z },
      { name: "sector_vs_benchmark", baselineTransform: "linear", rawValue: 0.001, baselineMedian: 0.001, baselineMad: 0.0008, pPresent: null, surpriseBits: null, signalKind: "median_mad_z", baselineMode: "continuous", baselineState: "ok", z },
    ],
  };
}

function axesFor(set: FeedAwareAttentionThresholdSet, values: { participation: number; displacement: number; idiosyncrasy: number }) {
  return {
    participation: participation(values.participation, set.normalization.participationDense),
    displacement: displacement(values.displacement, set.normalization.displacement),
    idiosyncrasy: idiosyncrasy(values.idiosyncrasy, set.normalization.idiosyncrasy),
  };
}

function scoreFor(
  store: FeedAwareAttentionThresholdStore,
  feedMode: AttentionFeedMode,
  subWindow: AttentionSubWindow,
  values: { participation: number; displacement: number; idiosyncrasy: number }
) {
  const calibrationSet = calibrationSetForScore(store, subWindow, feedMode);
  return scoreAttention({ feedMode, subWindow, calibrationSet, ...axesFor(calibrationSet, values) });
}

function curveRows(store: FeedAwareAttentionThresholdStore) {
  const rows: Array<{
    feedMode: AttentionFeedMode;
    subWindow: AttentionSubWindow;
    axis: string;
    inputKind: "z" | "surprise_bits";
    normalizationVersion: number;
    z50: number;
    k: number;
    values: Record<string, number>;
  }> = [];
  for (const feedMode of ATTENTION_FEED_MODES) {
    for (const subWindow of ATTENTION_SUB_WINDOWS) {
      const set = store.sets[feedMode][subWindow];
      const curves: Array<[string, "z" | "surprise_bits", AxisNormalizationConfig]> = [
        ["participation_dense", "z", set.normalization.participationDense],
        ["participation_presence", "surprise_bits", set.normalization.participationPresence],
        ["displacement", "z", set.normalization.displacement],
        ["idiosyncrasy", "z", set.normalization.idiosyncrasy],
      ];
      for (const [axis, inputKind, curve] of curves) {
        rows.push({
          feedMode,
          subWindow,
          axis,
          inputKind,
          normalizationVersion: set.normalizationVersion,
          z50: curve.z50,
          k: curve.k,
          values: Object.fromEntries(CURVE_INPUTS.map((value) => [String(value), normalizeAttentionAxis(value, curve)])),
        });
      }
    }
  }
  return rows;
}

function main(): void {
  const outDir = resolve("data/replay/reports");
  mkdirSync(outDir, { recursive: true });
  const calibrationStore = createPendingFeedAwareThresholdStore(3);
  const scenarioValues = { participation: 3, displacement: 2.5, idiosyncrasy: 0.2 };
  const pathA = scoreFor(calibrationStore, "sip", "regular", scenarioValues);
  const pathB = scoreFor(calibrationStore, "iex_partial", "regular", scenarioValues);
  const unremarkable = Object.fromEntries(ATTENTION_FEED_MODES.map((feedMode) => [
    feedMode,
    scoreFor(calibrationStore, feedMode, "regular", { participation: 0, displacement: 0, idiosyncrasy: 0 }),
  ]));
  const saturated = Object.fromEntries(ATTENTION_FEED_MODES.map((feedMode) => [
    feedMode,
    scoreFor(calibrationStore, feedMode, "regular", { participation: 6, displacement: 6, idiosyncrasy: 6 }),
  ]));
  const curves = curveRows(calibrationStore);
  const artifact = {
    phase: "A2",
    scope: "replay_only",
    generatedAt: "2026-08-17T05:30:00.000Z",
    disclosure: PRE_STREAM_REPLAY_DISCLOSURE,
    calibrationStatus: "pending_calibration",
    conclusionsAllowed: false,
    calibrationStore,
    normalizationCurves: curves,
    scenario20: {
      inputs: { participationZ: 3, displacementZ: 2.5, idiosyncrasyZ: 0.2 },
      statedCurve: { participationDense: { z50: 2, k: 1.2 }, displacement: { z50: 2, k: 1.2 } },
      expectedPathAAttentionFourDecimals: 61.8662,
      pathA,
      pathB,
    },
    invariants: {
      ...ATTENTION_SCORE_CALIBRATION_GUARDS,
      unremarkable,
      saturated,
    },
    firstBarMeaning: "first bar in provider history; not an asserted exchange listing date",
  } as const;
  const deterministicHash = sha256(stableJson(artifact));
  writeFileSync(resolve(outDir, "a2-attention-score-replay.json"), `${JSON.stringify({ ...artifact, deterministicHash }, null, 2)}\n`);
  writeFileSync(resolve(outDir, "attention-thresholds.json"), `${JSON.stringify(calibrationStore, null, 2)}\n`);

  const curveTable = curves.map((row) =>
    `| ${row.feedMode} | ${row.subWindow} | ${row.axis} (${row.inputKind}) | ${row.normalizationVersion} | ${row.z50.toFixed(2)} | ${row.k.toFixed(2)} | ${CURVE_INPUTS.map((value) => row.values[String(value)].toFixed(4)).join(" | ")} |`
  );
  const report = [
    "# Phase A2 Attention Score replay report",
    "",
    `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
    "",
    "## VALIDATION STATUS — REFUSED",
    "",
    "> All 12 calibration sets—including normalization curves and thresholds—are `pending_calibration`. These provisional values and contract scenarios cannot support performance, threshold, latency, or discovery conclusions.",
    "",
    "Normalization curves and thresholds are one calibration system. They must be calibrated together against the same labelled post-A3 sessions; changing a curve invalidates that set's thresholds and calibration identity.",
    "",
    "## Feed-mode contract replay",
    "",
    "| Feed mode | Core | Participation weight | Volume acceleration | Raw modifier | Applied scale | Attention |",
    "|---|---|---:|---|---:|---:|---:|",
    `| sip | participation × displacement | 1 | enabled | ${pathA.explanation.modifier.toFixed(4)} | ${pathA.explanation.modifierScale.toFixed(4)} | ${pathA.attention?.toFixed(4)} |`,
    `| iex_partial | displacement × idiosyncrasy | 0 (display-only) | disabled | ${pathB.explanation.modifier.toFixed(4)} | ${pathB.explanation.modifierScale.toFixed(4)} | ${pathB.attention?.toFixed(4)} |`,
    "",
    "Identical axis observations intentionally produce different scores because the feed modes use different two-axis cores. Path B applies no modifier because Idiosyncrasy is already inside its core.",
    "",
    "## §11.1 scenario 20 — exact regression",
    "",
    `With participation and displacement curves pinned inline to z50=2.0, k=1.2, Path A inputs participationZ=3.0, displacementZ=2.5, idiosyncrasyZ=0.2 produce attention=${pathA.attention?.toFixed(4)}; exact four-decimal expectation=61.8662 (${Number(pathA.attention?.toFixed(4)) === 61.8662 ? "pass" : "FAIL"}).`,
    "",
    "## Arithmetic guards",
    "",
    "| Feed mode | z=0 attention | z=0 core | Below deadStockCeiling=15 | Below provisional WATCHING core=0.25 | z=6 attention | <=100 |",
    "|---|---:|---:|---|---|---:|---|",
    ...ATTENTION_FEED_MODES.map((feedMode) => {
      const zero = unremarkable[feedMode];
      const high = saturated[feedMode];
      return `| ${feedMode} | ${zero.attention?.toFixed(4)} | ${zero.explanation.core?.toFixed(4)} | ${(zero.attention ?? Infinity) < ATTENTION_SCORE_CALIBRATION_GUARDS.deadStockCeiling ? "pass" : "FAIL"} | ${(zero.explanation.core ?? Infinity) < ATTENTION_SCORE_CALIBRATION_GUARDS.provisionalWatchingCoreFloor ? "pass" : "FAIL"} | ${high.attention?.toFixed(4)} | ${(high.attention ?? Infinity) <= 100 ? "pass" : "FAIL"} |`;
    }),
    "",
    "## Published provisional normalization curves",
    "",
    "Each row is the exact versioned curve stored beside its feed/window thresholds. `participation_presence` consumes surprise bits; the other rows consume z.",
    "",
    "| Feed mode | Sub-window | Axis/input | Curve v | z50 | k | norm(0) | norm(1) | norm(2) | norm(3) | norm(4) | norm(6) |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...curveTable,
    "",
    "## Explainability and provenance",
    "",
    `- Deterministic artifact hash: \`${deterministicHash}\``,
    "- Every result contains calibrationId, normalizationVersion/status, feedMode, sub-window, raw axis inputs, baseline statistics, normalization parameters, normalized values, core, raw/max/applied modifier, and final.",
    "- Path B volume presentation is labelled `IEX PARTIAL`.",
    "- `first_bar` means first bar in provider history; it is not presented as an exchange listing date.",
    "",
    "## Scope fence",
    "",
    "No history, velocity, state machine, episode, WAKING UP, event, or live-scanner wiring is present in this A2 replay.",
    "",
  ].join("\n");
  writeFileSync(resolve(outDir, "a2-attention-score-replay.md"), report);
  console.log(JSON.stringify({
    report: resolve(outDir, "a2-attention-score-replay.md"),
    deterministicHash,
    pathAAttention: pathA.attention,
    pathBAttention: pathB.attention,
    unremarkableSipAttention: unremarkable.sip.attention,
    unremarkableIexAttention: unremarkable.iex_partial.attention,
    thresholdSets: 12,
    publishedCurveRows: curves.length,
  }, null, 2));
}

main();
