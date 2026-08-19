import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  AttentionA3ReplayEngine,
  type AttentionA3Frame,
} from "../lib/attention/attentionA3Replay";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import type { AttentionHistoryObservation } from "../lib/attention/attentionHistory";
import type { AttentionFeedMode } from "../lib/attention/attentionScore";
import type { AttentionNormalizationCurves } from "../lib/attention/attentionAxes";
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
  deriveCalibrationCurve,
  derivePopulationThresholds,
  inverseNormalizedValue,
  partnerInputRequired,
  quantile,
  scoreRawCalibrationPoint,
  type PopulationTargetStatistic,
  type RawCalibrationPoint,
} from "../lib/replay/populationCalibration";
import { SipSessionDigestCollector } from "../lib/replay/sessionDigest";

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
interface Session {
  tradingDate: string;
  split: "train" | "holdout";
  primaryRegime: string;
  tags: string[];
  earlyClose: boolean;
  holidayAdjacent: boolean;
  haltCandidate: unknown | null;
}
interface Manifest {
  splitHash: string;
  fetchedSymbols: number;
  rankedSymbols: number;
  referenceOnlySymbols: number;
  sessions: Session[];
}
interface Population {
  feedMode: AttentionFeedMode;
  tradingDate: string;
  split: "train" | "holdout";
  subWindow: AttentionSubWindow;
  reached: { watching: number; emerging: number; inPlay: number };
  coreDeciles: number[];
  zeroInPlayMinutes: number;
  minutesWithInPlay: number;
  minutesWithWakingUp: number;
  evaluatedMinutes: number;
  inPlayMinuteHistogram: Record<string, number>;
  peakSimultaneousInPlay: number;
  inPlayOccupancyDurations: number[];
  emergingOccupancyDurations: number[];
  gapsBetweenInPlayPeriods: number[];
  inPlayScoreSpreadByMinute: Array<{
    minuteOfDay: number;
    count: number;
    min: number;
    q25: number;
    median: number;
    q75: number;
    max: number;
    iqr: number;
    distinctExact: number;
    distinctDisplayed: number;
  }>;
  stateDwellMinutes: Record<string, number>;
  transitions: Record<string, number>;
  velocity: {
    count: number;
    p10: number | null;
    p50: number | null;
    p90: number | null;
    p95: number | null;
  };
  scoreableRows: number;
}
const feedModes: AttentionFeedMode[] = ["sip", "iex_partial"],
  modeName = ["dense", "sparse", "dead"] as const;
function windowAt(m: number): AttentionSubWindow | null {
  if (m >= 240 && m < 420) return "premarket_early";
  if (m < 540 && m >= 420) return "premarket_core";
  if (m < 570 && m >= 540) return "premarket_final";
  if (m < 960 && m >= 570) return "regular";
  if (m < 1080 && m >= 960) return "after_hours_core";
  if (m < 1200 && m >= 1080) return "after_hours_late";
  return null;
}
function configured(s: Session, m: number) {
  return !(s.earlyClose && m >= 780 && m < 960) && windowAt(m) !== null;
}
function raw(t: Tuple, c: Corpus, f: AttentionFeedMode): RawCalibrationPoint {
  return {
    tradingDate: c.dates[t[0]],
    symbol: c.symbols[t[1]],
    minuteOfDay: t[3],
    feedMode: f,
    subWindow: windowAt(t[3])!,
    participationInput: t[4],
    participationInputKind: t[5] === 0 ? "z" : "surprise_bits",
    displacementZ: t[7],
    idiosyncrasyZ: t[8],
    limitedHistory: t[16] === 1,
  };
}
function logistic(z: number, c: { z50: number; k: number }) {
  return 1 / (1 + Math.exp(-c.k * (z - c.z50)));
}
function preserveConfluence(
  curves: AttentionNormalizationCurves,
  feedMode: AttentionFeedMode,
  v: ResolvedAttentionThresholdValues,
) {
  const a =
      feedMode === "sip" ? curves.participationDense : curves.displacement,
    b = feedMode === "sip" ? curves.displacement : curves.idiosyncrasy;
  const required = Math.max(
    Math.sqrt(logistic(6, a) * logistic(MINIMUM_IN_PLAY_PARTNER_Z, b)),
    Math.sqrt(logistic(6, b) * logistic(MINIMUM_IN_PLAY_PARTNER_Z, a)),
  );
  const enter = Number(Math.max(v.inPlayEnterCore, required).toFixed(4));
  const calibratedGap = Math.max(0.005, v.inPlayEnterCore - v.inPlayExitCore);
  return {
    ...v,
    inPlayEnterCore: enter,
    inPlayExitCore: Number(
      Math.max(v.emergingEnterCore + 0.002, enter - calibratedGap).toFixed(4),
    ),
  };
}
function fit(
  c: Corpus,
  m: Manifest,
  targetStatistic: PopulationTargetStatistic = "mean",
) {
  let store = createPendingFeedAwareThresholdStore(3);
  const rows: any[] = [];
  const accepted = JSON.parse(readFileSync(resolve("data/replay/reports/attention-saturation-candidate-replay.json"), "utf8")) as { fitRows: any[] };
  const usability = JSON.parse(readFileSync(resolve("data/replay/reports/attention-usability-exit-sweep.json"), "utf8")) as { selectedScenario: { inPlayEnterCore: number; inPlayExitCore: number; exitPersistenceMinutes: number } | null };
  if (!usability.selectedScenario) throw new Error("Usability calibration has no selected train-only policy.");
  for (const f of feedModes)
    for (const w of ATTENTION_SUB_WINDOWS) {
      const points = c.feeds[f]
          .filter(
            (t) =>
              windowAt(t[3]) === w &&
              m.sessions[t[0]].split === "train" &&
              configured(m.sessions[t[0]], t[3]),
          )
          .map((t) => raw(t, c, f))
          .filter((p) => !p.limitedHistory),
        prior = store.sets[f][w].normalization;
      if (points.length < 1000) {
        store = markCalibrationUnavailableByConstruction(store, {
          feedMode: f,
          subWindow: w,
          reason: "insufficient_reference",
        });
        rows.push({
          feedMode: f,
          subWindow: w,
          status: "unavailable_by_construction",
          trainingRows: points.length,
          curves: prior,
          values: null,
          confluence: assertCalibrationConfluence({
            feedMode: f,
            curves: prior,
            thresholds: store.sets[f][w].provisionalValues,
          }),
        });
        continue;
      }
      const acceptedSipRow = f === "sip"
        ? accepted.fitRows.find((row) => row.candidate === "log_participation_range_theoretical_max_rescale" && row.subWindow === w)
        : null;
      if (f === "sip" && !acceptedSipRow) throw new Error(`Accepted combined calibration row missing for SIP ${w}.`);
      const curves: AttentionNormalizationCurves = acceptedSipRow?.curves ?? {
        participationDense: deriveCalibrationCurve(
          points.filter((p) => p.participationInputKind === "z").map((p) => p.participationInput), "z", prior.participationDense,
        ),
        participationPresence: deriveCalibrationCurve(
          points.filter((p) => p.participationInputKind === "surprise_bits").map((p) => p.participationInput), "surprise_bits", prior.participationPresence,
        ),
        displacement: deriveCalibrationCurve(points.map((p) => p.displacementZ), "z", prior.displacement),
        idiosyncrasy: deriveCalibrationCurve(points.map((p) => p.idiosyncrasyZ), "z", prior.idiosyncrasy),
      };
      const scored = points.map((p) => scoreRawCalibrationPoint(p, curves));
      let values = preserveConfluence(
        curves,
        f,
        acceptedSipRow
          ? { ...acceptedSipRow.values, enterPersistenceMinutes: 2, exitPersistenceMinutes: 2 }
          : derivePopulationThresholds(scored, POPULATION_TARGETS[w], targetStatistic),
      );
      if (f === "sip" && w === "regular") {
        values = {
          ...values,
          inPlayEnterCore: usability.selectedScenario.inPlayEnterCore,
          inPlayExitCore: usability.selectedScenario.inPlayExitCore,
          exitPersistenceMinutes: usability.selectedScenario.exitPersistenceMinutes,
        };
      }
      const confluence = assertCalibrationConfluence({
          feedMode: f,
          curves,
          thresholds: values,
        });
      store = applyPopulationCalibration(store, {
        feedMode: f,
        subWindow: w,
        normalizationVersion: 3,
        normalization: curves,
        thresholdVersion: 3,
        values,
        corpusHash: c.splitHash,
      });
      rows.push({
        feedMode: f,
        subWindow: w,
        status: "calibrated",
        trainingRows: points.length,
        curves,
        values,
        confluence,
      });
    }
  const calibrated = rows.filter((r) => r.status === "calibrated"),
    unique = new Set(
      calibrated.map((r) => stableJson({ curves: r.curves, values: r.values })),
    ).size;
  if (unique !== calibrated.length)
    throw new Error("Viable population fits did not genuinely differ.");
  return { store, rows };
}
function observation(
  t: Tuple,
  c: Corpus,
  f: AttentionFeedMode,
  s: FeedAwareAttentionThresholdStore,
): AttentionHistoryObservation {
  const p = raw(t, c, f),
    set = s.sets[f][p.subWindow],
    score = scoreRawCalibrationPoint(p, set.normalization);
  return {
    symbol: p.symbol,
    at: t[2],
    score: score.attention,
    core: score.core,
    feedMode: f,
    subWindow: p.subWindow,
    calibrationId: set.calibrationId,
    participationBaselineMode: modeName[t[6]],
    participationInput: t[4],
    participationInputKind: t[5] === 0 ? "z" : "surprise_bits",
    displacementZ: t[7],
    idiosyncrasyZ: t[8],
    price: t[9],
    atr: t[10],
    vwap: t[11],
    ema9: t[12],
    consecutiveExpansionBars: t[13],
    pullbackObserved: t[14] === 1,
    priceLostVwap: t[15] === 1,
    dataQualityState: t[16] === 1 ? "limited_history" : "ok",
    provisional: set.calibrationStatus !== "calibrated",
  };
}
function summarize(
  f: AttentionFeedMode,
  s: Session,
  w: AttentionSubWindow,
  frames: Map<number, AttentionA3Frame>,
): Population {
  const reached = {
      watching: new Set<string>(),
      emerging: new Set<string>(),
      inPlay: new Set<string>(),
    },
    cores: number[] = [],
    velocities: number[] = [],
    dwell: Record<string, number> = {
      LOW_PRIORITY: 0,
      WATCHING: 0,
      EMERGING: 0,
      IN_PLAY: 0,
      COOLING: 0,
    },
    transitions: Record<string, number> = {},
    inPlayMinuteHistogram: Record<string, number> = {},
    occupancyMinutes = {
      IN_PLAY: new Map<string, number[]>(),
      EMERGING: new Map<string, number[]>(),
    },
    inPlayScoreSpreadByMinute: Population["inPlayScoreSpreadByMinute"] = [],
    activeInPlayMinutes: number[] = [];
  let zero = 0,
    minutesWithInPlay = 0,
    minutesWithWakingUp = 0,
    minutes = 0,
    peakSimultaneousInPlay = 0,
    scoreableRows = 0;
  for (let m = 240; m < 1200; m++) {
    if (!configured(s, m) || windowAt(m) !== w) continue;
    minutes++;
    const frame = frames.get(m);
    const inPlayCount = frame?.lists.inPlay.length ?? 0;
    inPlayMinuteHistogram[String(inPlayCount)] =
      (inPlayMinuteHistogram[String(inPlayCount)] ?? 0) + 1;
    peakSimultaneousInPlay = Math.max(peakSimultaneousInPlay, inPlayCount);
    if (inPlayCount === 0) zero++;
    else {
      minutesWithInPlay++;
      activeInPlayMinutes.push(m);
    }
    // WAKING UP retired: historical population field remains zero for schema compatibility.
    if (!frame) continue;
    if (frame.lists.inPlay.length > 0) {
      const scores = frame.lists.inPlay.map((row) => row.point.score).sort((a, b) => a - b);
      const q25 = quantile(scores, 0.25), q75 = quantile(scores, 0.75);
      inPlayScoreSpreadByMinute.push({
        minuteOfDay: m,
        count: scores.length,
        min: scores[0],
        q25,
        median: quantile(scores, 0.5),
        q75,
        max: scores.at(-1)!,
        iqr: q75 - q25,
        distinctExact: new Set(scores.map((value) => value.toFixed(12))).size,
        distinctDisplayed: new Set(scores.map((value) => value.toFixed(1))).size,
      });
    }
    for (const r of frame.rows) {
      scoreableRows++;
      cores.push(r.point.core);
      dwell[r.state]++;
      if (r.state === "WATCHING") reached.watching.add(r.symbol);
      if (r.state === "EMERGING") reached.emerging.add(r.symbol);
      if (r.state === "IN_PLAY") reached.inPlay.add(r.symbol);
      if (r.state === "IN_PLAY" || r.state === "EMERGING") {
        const stateMap = occupancyMinutes[r.state];
        const symbolMinutes = stateMap.get(r.symbol) ?? [];
        symbolMinutes.push(m);
        stateMap.set(r.symbol, symbolMinutes);
      }
      if (r.transition) {
        const k = `${r.transition.from}->${r.transition.to}`;
        transitions[k] = (transitions[k] ?? 0) + 1;
      }
      if (r.velocity.scoreVelocityPerMinute !== null)
        velocities.push(r.velocity.scoreVelocityPerMinute);
    }
  }
  const coreDeciles = cores.length
      ? Array.from({ length: 11 }, (_, i) =>
          Number(quantile(cores, i / 10).toFixed(4)),
        )
      : [],
    velocity = velocities.length
      ? {
          count: velocities.length,
          p10: quantile(velocities, 0.1),
          p50: quantile(velocities, 0.5),
          p90: quantile(velocities, 0.9),
          p95: quantile(velocities, 0.95),
        }
      : { count: 0, p10: null, p50: null, p90: null, p95: null };
  const contiguousRuns = (bySymbol: Map<string, number[]>): number[] =>
      [...bySymbol.values()].flatMap((series) => {
        const sorted = [...new Set(series)].sort((a, b) => a - b);
        if (sorted.length === 0) return [];
        const runs: number[] = [];
        let length = 1;
        for (let index = 1; index < sorted.length; index++) {
          if (sorted[index] === sorted[index - 1] + 1) length++;
          else { runs.push(length); length = 1; }
        }
        runs.push(length);
        return runs;
      }), gapsBetweenInPlayPeriods: number[] = [];
  for (let index = 1; index < activeInPlayMinutes.length; index++) {
    const gap = activeInPlayMinutes[index] - activeInPlayMinutes[index - 1] - 1;
    if (gap > 0) gapsBetweenInPlayPeriods.push(gap);
  }
  return {
    feedMode: f,
    tradingDate: s.tradingDate,
    split: s.split,
    subWindow: w,
    reached: {
      watching: reached.watching.size,
      emerging: reached.emerging.size,
      inPlay: reached.inPlay.size,
    },
    coreDeciles,
    zeroInPlayMinutes: zero,
    minutesWithInPlay,
    minutesWithWakingUp,
    evaluatedMinutes: minutes,
    inPlayMinuteHistogram,
    peakSimultaneousInPlay,
    inPlayOccupancyDurations: contiguousRuns(occupancyMinutes.IN_PLAY),
    emergingOccupancyDurations: contiguousRuns(occupancyMinutes.EMERGING),
    gapsBetweenInPlayPeriods,
    inPlayScoreSpreadByMinute,
    stateDwellMinutes: dwell,
    transitions,
    velocity,
    scoreableRows,
  };
}
function run(
  c: Corpus,
  m: Manifest,
  s: FeedAwareAttentionThresholdStore,
  digest?: SipSessionDigestCollector,
) {
  const out: Population[] = [],
    dateOrder = m.sessions
      .map((_, index) => index)
      .sort((a, b) =>
        m.sessions[a].split === m.sessions[b].split
          ? a - b
          : m.sessions[a].split === "train"
            ? -1
            : 1,
      );
  for (const f of feedModes) {
    // Preserve provider/corpus order while avoiding a full-corpus scan for every
    // session. Replays remain byte-for-byte deterministic, but scale linearly.
    const tuplesBySession = Array.from(
      { length: m.sessions.length },
      () => [] as Tuple[],
    );
    for (const tuple of c.feeds[f]) tuplesBySession[tuple[0]].push(tuple);
    for (const d of dateOrder) {
      const session = m.sessions[d],
        engine = new AttentionA3ReplayEngine(s, ATTENTION_UNIVERSE),
        byMinute = new Map<number, AttentionHistoryObservation[]>();
      for (const t of tuplesBySession[d]) {
        if (!configured(session, t[3])) continue;
        const tupleWindow = windowAt(t[3])!;
        if (s.sets[f][tupleWindow].calibrationStatus !== "calibrated") continue;
        const list = byMinute.get(t[3]) ?? [];
        list.push(observation(t, c, f, s));
        byMinute.set(t[3], list);
      }
      const frames = new Map<number, AttentionA3Frame>();
      for (let minute = 240; minute < 1200; minute++) {
        const list = byMinute.get(minute);
        if (list?.length)
          try {
            const frame = engine.processMinute(list);
            frames.set(minute, frame);
            if (f === "sip") digest?.observe(session, minute, frame);
          } catch (error) {
            throw new Error(
              `${f} ${session.tradingDate} ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")} ET: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
      }
      for (const w of ATTENTION_SUB_WINDOWS) {
        if (s.sets[f][w].calibrationStatus === "calibrated")
          out.push(summarize(f, session, w, frames));
      }
    }
  }
  return out;
}
function mean(v: number[]) {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
function aggregate(p: Population[]) {
  const out: any[] = [];
  for (const f of feedModes)
    for (const w of ATTENTION_SUB_WINDOWS)
      for (const split of ["train", "holdout"] as const) {
        const g = p.filter(
          (r) => r.feedMode === f && r.subWindow === w && r.split === split,
        );
        if (g.length === 0) continue;
        const vp = g.flatMap((r) =>
          r.velocity.p90 === null ? [] : [r.velocity.p90],
        );
        out.push({
          feedMode: f,
          subWindow: w,
          split,
          sessions: g.length,
          meanWatching: mean(g.map((r) => r.reached.watching)),
          meanEmerging: mean(g.map((r) => r.reached.emerging)),
          meanInPlay: mean(g.map((r) => r.reached.inPlay)),
          meanZeroInPlayMinutes: mean(g.map((r) => r.zeroInPlayMinutes)),
          velocityP90: vp.length ? quantile(vp, 0.5) : null,
        });
      }
  return out;
}
interface Translation {
  feedMode: AttentionFeedMode;
  subWindow: AttentionSubWindow;
  status: string;
  watchingSymmetricInput: number | null;
  emergingSymmetricInput: number | null;
  inPlaySymmetricInput: number | null;
  firstAt6RequiresSecond: number | null;
  secondAt6RequiresFirst: number | null;
}
function translate(s: FeedAwareAttentionThresholdStore): Translation[] {
  const result: Translation[] = [];
  for (const f of feedModes)
    for (const w of ATTENTION_SUB_WINDOWS) {
      const set = s.sets[f][w];
      if (set.calibrationStatus === "unavailable_by_construction") {
        result.push({
          feedMode: f,
          subWindow: w,
          status: set.calibrationStatus,
          watchingSymmetricInput: null,
          emergingSymmetricInput: null,
          inPlaySymmetricInput: null,
          firstAt6RequiresSecond: null,
          secondAt6RequiresFirst: null,
        });
        continue;
      }
      const values =
        set.calibrationStatus === "calibrated"
          ? (set.values as ResolvedAttentionThresholdValues)
          : set.provisionalValues;
      const a =
        f === "sip"
          ? set.normalization.participationDense
          : set.normalization.displacement;
      const b =
        f === "sip"
          ? set.normalization.displacement
          : set.normalization.idiosyncrasy;
      const symmetric = (core: number) => {
        let lo = -4,
          hi = 8;
        for (let i = 0; i < 80; i += 1) {
          const mid = (lo + hi) / 2;
          if (Math.sqrt(logistic(mid, a) * logistic(mid, b)) < core) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      };
      result.push({
        feedMode: f,
        subWindow: w,
        status: set.calibrationStatus,
        watchingSymmetricInput: symmetric(values.watchingEnterCore),
        emergingSymmetricInput: symmetric(values.emergingEnterCore),
        inPlaySymmetricInput: symmetric(values.inPlayEnterCore),
        firstAt6RequiresSecond: partnerInputRequired(
          values.inPlayEnterCore,
          6,
          a,
          b,
        ),
        secondAt6RequiresFirst: partnerInputRequired(
          values.inPlayEnterCore,
          6,
          b,
          a,
        ),
      });
    }
  return result;
}
function main() {
  const root = resolve("data/replay/calibration"),
    reports = resolve("data/replay/reports");
  mkdirSync(reports, { recursive: true });
  const c = JSON.parse(
      gunzipSync(readFileSync(resolve(root, "raw-features.json.gz"))).toString(
        "utf8",
      ),
    ) as Corpus,
    m = JSON.parse(
      readFileSync(resolve(root, "session-manifest.json"), "utf8"),
    ) as Manifest;
  if (c.splitHash !== m.splitHash)
    throw new Error("Frozen split does not match raw corpus.");
  const digest = new SipSessionDigestCollector(
      new Set([
        "2025-10-01",
        "2025-10-10",
        "2025-11-04",
        "2025-11-28",
        "2026-02-13",
      ]),
    ),
    fitted = fit(c, m, "mean"),
    first = run(c, m, fitted.store, digest),
    second = run(c, m, fitted.store),
    h1 = sha256(stableJson(first)),
    h2 = sha256(stableJson(second));
  if (h1 !== h2) throw new Error("Population replay is not deterministic.");
  const aggregates = aggregate(first),
    translations = translate(fitted.store),
    divergence = feedModes.flatMap((f) =>
      ATTENTION_SUB_WINDOWS.flatMap((w) => {
        if (fitted.store.sets[f][w].calibrationStatus !== "calibrated")
          return [];
        const train = aggregates.find(
            (r) => r.feedMode === f && r.subWindow === w && r.split === "train",
          ),
          holdout = aggregates.find(
            (r) =>
              r.feedMode === f && r.subWindow === w && r.split === "holdout",
          ),
          delta = Math.abs(holdout.meanInPlay - train.meanInPlay);
        return [
          {
            feedMode: f,
            subWindow: w,
            trainMeanInPlay: train.meanInPlay,
            holdoutMeanInPlay: holdout.meanInPlay,
            material: delta > Math.max(3, train.meanInPlay * 0.3),
          },
        ];
      }),
    ),
    headlineQuietSessions = first
      .filter(
        (row) =>
          row.feedMode === "sip" &&
          row.subWindow === "regular" &&
          row.zeroInPlayMinutes === row.evaluatedMinutes,
      )
      .map((row) => row.tradingDate),
    regularSipPopulations = first.filter(
      (row) => row.feedMode === "sip" && row.subWindow === "regular",
    ),
    regularSipInPlayHistogram = regularSipPopulations.reduce<
      Record<string, number>
    >((combined, row) => {
      for (const [count, minutes] of Object.entries(row.inPlayMinuteHistogram))
        combined[count] = (combined[count] ?? 0) + minutes;
      return combined;
    }, {}),
    regularSipEvaluatedMinutes = Object.values(
      regularSipInPlayHistogram,
    ).reduce((sum, minutes) => sum + minutes, 0),
    broadTapeMinutes = Object.entries(regularSipInPlayHistogram)
      .filter(([count]) => Number(count) >= 30)
      .reduce((sum, [, minutes]) => sum + minutes, 0),
    peakSimultaneousInPlay = Math.max(
      ...regularSipPopulations.map((row) => row.peakSimultaneousInPlay),
    );
  const distribution = (values: number[]) => values.length === 0
      ? { count: 0, min: null, p25: null, median: null, p75: null, max: null, iqr: null }
      : {
          count: values.length,
          min: Math.min(...values),
          p25: quantile(values, 0.25),
          median: quantile(values, 0.5),
          p75: quantile(values, 0.75),
          max: Math.max(...values),
          iqr: quantile(values, 0.75) - quantile(values, 0.25),
        };
  const regularMinutesWithInPlay = regularSipPopulations.reduce((sum, row) => sum + row.minutesWithInPlay, 0),
    regularMinutesWithWakingUp = regularSipPopulations.reduce((sum, row) => sum + row.minutesWithWakingUp, 0),
    currentUsability = {
      label: "pre-approved-rescale current production baseline",
      feedMode: "sip",
      subWindow: "regular",
      evaluatedMinutes: regularSipEvaluatedMinutes,
      minutesWithInPlay: regularMinutesWithInPlay,
      fractionMinutesWithInPlay: regularMinutesWithInPlay / regularSipEvaluatedMinutes,
      minutesWithWakingUp: regularMinutesWithWakingUp,
      fractionMinutesWithWakingUp: regularMinutesWithWakingUp / regularSipEvaluatedMinutes,
      inPlayOccupancyMinutes: distribution(regularSipPopulations.flatMap((row) => row.inPlayOccupancyDurations)),
      emergingOccupancyMinutes: distribution(regularSipPopulations.flatMap((row) => row.emergingOccupancyDurations)),
      gapsBetweenInPlayPeriodsMinutes: distribution(regularSipPopulations.flatMap((row) => row.gapsBetweenInPlayPeriods)),
      quietSessions: headlineQuietSessions,
      scoreSpreadByMinute: regularSipPopulations.flatMap((row) => row.inPlayScoreSpreadByMinute.map((spread) => ({ tradingDate: row.tradingDate, ...spread }))),
    };
  const artifact = {
      schemaVersion: 1,
      scope: "population_calibration_only",
      groundTruthValidation: "REFUSED",
      disclosure: PRE_STREAM_REPLAY_DISCLOSURE,
      contractFixtureNotice:
        "The A3 report's Final WAKING UP: AAOI was a contract fixture, not a historical session result.",
      manifest: m,
      calibrationStore: fitted.store,
      calibrations: fitted.rows,
      provisionalTranslation: {
        curve: { z50: 2, k: 1.2 },
        watching: {
          core: 0.25,
          zOnBothAxes: inverseNormalizedValue(0.25, { z50: 2, k: 1.2 }),
        },
        emerging: { core: 0.5, zOnBothAxes: 2 },
        inPlay: {
          core: 0.7,
          zOnBothAxes: inverseNormalizedValue(0.7, { z50: 2, k: 1.2 }),
        },
        confluence: {
          oneAxisZ: 6,
          partnerZ: partnerInputRequired(
            0.7,
            6,
            { z50: 2, k: 1.2 },
            { z50: 2, k: 1.2 },
          ),
        },
      },
      translations,
      populations: first,
      aggregates,
      headlineQuietSessions,
      inPlayCountDistribution: {
        feedMode: "sip",
        subWindow: "regular",
        evaluatedMinutes: regularSipEvaluatedMinutes,
        histogram: regularSipInPlayHistogram,
        peakSimultaneousInPlay,
        broadTapeThreshold: 30,
        broadTapeMinutes,
      },
      holdoutDivergence: divergence,
      determinism: { firstHash: h1, secondHash: h2, identical: true },
    },
    artifactHash = sha256(stableJson(artifact));
  writeFileSync(
    resolve(reports, "attention-population-calibration.json"),
    `${JSON.stringify({ ...artifact, artifactHash }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(reports, "attention-thresholds.json"),
    `${JSON.stringify(fitted.store, null, 2)}\n`,
  );
  if (!existsSync(resolve(reports, "attention-usability-current.json"))) writeFileSync(
    resolve(reports, "attention-usability-current.json"),
    `${JSON.stringify(currentUsability, null, 2)}\n`,
  );
  if (!existsSync(resolve(reports, "attention-usability-current.md"))) writeFileSync(
    resolve(reports, "attention-usability-current.md"),
    [
      "# Attention usability baseline — before approved rescale/log transform",
      "",
      `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
      "",
      "This freezes the current production replay before changing measurement or dwell controls. It is population behavior, not ground-truth validation.",
      "",
      `- Regular minutes with >=1 IN PLAY: ${regularMinutesWithInPlay}/${regularSipEvaluatedMinutes} (${(100 * currentUsability.fractionMinutesWithInPlay).toFixed(2)}%)`,
      `- Regular minutes with >=1 WAKING UP: ${regularMinutesWithWakingUp}/${regularSipEvaluatedMinutes} (${(100 * currentUsability.fractionMinutesWithWakingUp).toFixed(2)}%)`,
      `- IN PLAY occupancy: median ${currentUsability.inPlayOccupancyMinutes.median} min; IQR ${currentUsability.inPlayOccupancyMinutes.p25}–${currentUsability.inPlayOccupancyMinutes.p75} min`,
      `- EMERGING occupancy: median ${currentUsability.emergingOccupancyMinutes.median} min; IQR ${currentUsability.emergingOccupancyMinutes.p25}–${currentUsability.emergingOccupancyMinutes.p75} min`,
      `- Gaps between IN PLAY periods: median ${currentUsability.gapsBetweenInPlayPeriodsMinutes.median} min; IQR ${currentUsability.gapsBetweenInPlayPeriodsMinutes.p25}–${currentUsability.gapsBetweenInPlayPeriodsMinutes.p75} min`,
      `- All-day zero-IN-PLAY sessions: ${headlineQuietSessions.join(", ")}`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    resolve(reports, "attention-session-digest.md"),
    digest.markdown(),
  );
  const composition = m.sessions.map(
      (s) =>
        `| ${s.tradingDate} | ${s.split} | ${s.primaryRegime} | ${s.tags.join(", ")} | ${s.earlyClose ? "yes" : "no"} | ${s.holidayAdjacent ? "yes" : "no"} | ${s.haltCandidate ? "bar-gap candidate" : "none"} |`,
    ),
    calTable = fitted.rows.map((r: any) =>
      r.status === "calibrated"
        ? `| ${r.feedMode} | ${r.subWindow} | ${r.status} | ${r.curves.participationDense.z50}/${r.curves.participationDense.k} | ${r.curves.participationPresence.z50}/${r.curves.participationPresence.k} | ${r.curves.displacement.z50}/${r.curves.displacement.k} | ${r.curves.idiosyncrasy.z50}/${r.curves.idiosyncrasy.k} | ${r.values.watchingEnterCore.toFixed(4)} | ${r.values.emergingEnterCore.toFixed(4)} | ${r.values.inPlayEnterCore.toFixed(4)} | ${r.values.newInPlayVelocityPerMinute.toFixed(3)} |`
        : `| ${r.feedMode} | ${r.subWindow} | ${r.status} | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |`,
    ),
    aggTable = aggregates.map(
      (r: any) =>
        `| ${r.feedMode} | ${r.subWindow} | ${r.split} | ${r.meanWatching.toFixed(2)} | ${r.meanEmerging.toFixed(2)} | ${r.meanInPlay.toFixed(2)} | ${r.meanZeroInPlayMinutes.toFixed(1)} | ${r.velocityP90 === null ? "n/a" : r.velocityP90.toFixed(3)} |`,
    ),
    popTable = first.map(
      (r) =>
        `| ${r.tradingDate} | ${r.split} | ${r.feedMode} | ${r.subWindow} | ${r.reached.watching} | ${r.reached.emerging} | ${r.reached.inPlay} | ${r.zeroInPlayMinutes}/${r.evaluatedMinutes} | ${r.coreDeciles.join(", ")} | ${r.velocity.p50 === null ? "n/a" : r.velocity.p50.toFixed(3)} / ${r.velocity.p90 === null ? "n/a" : r.velocity.p90.toFixed(3)} |`,
    ),
    histogramTable = Object.entries(regularSipInPlayHistogram)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(
        ([count, minutes]) =>
          `| ${count} | ${minutes} | ${((100 * minutes) / regularSipEvaluatedMinutes).toFixed(2)}% |`,
      ),
    trTable = translations.map((r) =>
      r.status === "calibrated"
        ? `| ${r.feedMode} | ${r.subWindow} | ${r.status} | ${r.watchingSymmetricInput!.toFixed(3)} | ${r.emergingSymmetricInput!.toFixed(3)} | ${r.inPlaySymmetricInput!.toFixed(3)} | ${r.firstAt6RequiresSecond!.toFixed(3)} | ${r.secondAt6RequiresFirst!.toFixed(3)} |`
        : `| ${r.feedMode} | ${r.subWindow} | ${r.status} | n/a | n/a | n/a | n/a | n/a |`,
    );
  const report = [
    "# Attention Engine population calibration report",
    "",
    `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
    "",
    "## VALIDATION STATUS — GROUND TRUTH REFUSED",
    "",
    "> Population calibration is not validation. No hit rate, latency, move capture, false-positive rate, or discovery-quality conclusion is available without trader-adjudicated labels.",
    "",
    `Determinism: \`${h1}\` reproduced exactly. Artifact: \`${artifactHash}\`.`,
    "",
    "The A3 report's `Final WAKING UP: AAOI` was a contract fixture, not a historical session result.",
    "",
    "> **PRODUCT LIMIT:** ON THE FREE IEX FEED, THE SCANNER OPERATES DURING THE REGULAR SESSION ONLY. Premarket and after-hours coverage require the consolidated feed.",
    "",
    "IEX extended-hours failure is structural partial-feed sparsity: early and late windows contain no target bars; shoulder windows have only 1.3–4.2% target coverage, incomplete benchmark/sector overlap, and too few displacement/reference baselines. The five sets are `unavailable_by_construction`, emit `insufficient_reference`, and never fall back.",
    "",
    "## Corpus composition",
    "",
    "68 fetched = 61 ranked + 7 reference-only. Split frozen before fitting: 28 train / 12 holdout. Halt entries are inferred SIP bar-gap candidates; trading-status messages are unavailable, so none is claimed as confirmed.",
    "",
    "| Date | Split | Primary | Tags | Early close | Holiday-adjacent | Halt evidence |",
    "|---|---|---|---|---|---|---|",
    ...composition,
    "",
    "## Provisional curve-v1 translation",
    "",
    `WATCHING 0.25 → z=${inverseNormalizedValue(0.25, { z50: 2, k: 1.2 }).toFixed(4)}; EMERGING 0.50 → z=2.0000; IN PLAY 0.70 → z=${inverseNormalizedValue(0.7, { z50: 2, k: 1.2 }).toFixed(4)}. With one axis at z=6, its partner still needs z=${partnerInputRequired(0.7, 6, { z50: 2, k: 1.2 }, { z50: 2, k: 1.2 }).toFixed(4)}.`,
    "",
    "## Joint curve and threshold fit",
    "",
    "SIP uses the accepted log-participation/log-range curves. Regular-session IN PLAY was recalibrated against minute coverage, occupancy dwell, and the named quiet-day contract: enter 0.80, exit 0.70, entry persistence 2, exit persistence 30. Exit-only and enter-only effects are published separately. Other state boundaries retain their accepted population-fit provenance. Holdout rows never participated in selection.",
    "",
    "| Feed | Window | Status | Dense P z50/k | Presence P z50/k | Disp z50/k | Idio z50/k | WATCH | EMERGE | IN PLAY | Velocity |",
    "|---|---|---|---|---|---|---|---:|---:|---:|---:|",
    ...calTable,
    "",
    "## Calibrated translation and confluence",
    "",
    "| Feed | Window | Status | WATCH symmetric | EMERGE symmetric | IN PLAY symmetric | First@6 requires second | Second@6 requires first |",
    "|---|---|---|---:|---:|---:|---:|---:|",
    ...trTable,
    "",
    `All asymmetric checks are hard-guarded at z ≥ ${MINIMUM_IN_PLAY_PARTNER_Z.toFixed(2)}.`,
    "",
    "## Per-minute IN PLAY count — SIP regular session",
    "",
    `Across ${regularSipEvaluatedMinutes} regular-session minutes, the observed peak was ${peakSimultaneousInPlay}/61 names. ${broadTapeMinutes} minutes had at least 30 names IN PLAY; these are retained as broad-tape regime evidence, not suppressed.`,
    `Zero IN PLAY occupies ${((100 * (regularSipInPlayHistogram["0"] ?? 0)) / regularSipEvaluatedMinutes).toFixed(2)}% of regular minutes after usability calibration. The complete histogram is published below; broad-tape minutes are retained when present, never suppressed.`,
    "",
    "| Simultaneous IN PLAY | Minutes | Share |",
    "|---:|---:|---:|",
    ...histogramTable,
    "",
    "## Train versus untouched holdout",
    "",
    "| Feed | Window | Split | Mean WATCH | Mean EMERGE | Mean IN PLAY | Mean zero-IN-PLAY min | Velocity p90 |",
    "|---|---|---|---:|---:|---:|---:|---:|",
    ...aggTable,
    "",
    divergence.some((r) => r.material)
      ? "> MATERIAL TRAIN/HOLDOUT DIVERGENCE EXISTS. It was reported and not fitted away."
      : "No material IN PLAY divergence crossed the declared 30% or three-symbol boundary.",
    "",
    "## NO NAMES IN PLAY — headline calibration result",
    "",
    `**${headlineQuietSessions.length} SIP sessions held zero IN PLAY names for every regular-session minute:** ${headlineQuietSessions.join(", ")}. This empirical result must remain prominent in future calibrations.`,
    "",
    "## Per-session, per-window populations",
    "",
    "Core deciles are p0…p100 across all scoreable universe row-minutes. Velocity is p50 / p90.",
    "",
    "| Date | Split | Feed | Window | WATCH | EMERGE | IN PLAY | Zero IN PLAY min | Core deciles | Velocity p50 / p90 |",
    "|---|---|---|---|---:|---:|---:|---|---|---|",
    ...popTable,
    "",
    "## Scope fence",
    "",
    "No labels were used. Market Map output was not used by calibration and could not affect this fit. No events, alerts, direction, regime engine, advanced TA, live wiring, deployment, migration, or paid subscription was used.",
    "",
  ].join("\n");
  writeFileSync(
    resolve(reports, "attention-population-calibration.md"),
    report,
  );
  console.log(
    JSON.stringify(
      {
        artifactHash,
        replayHash: h1,
        sets: fitted.rows.length,
        populationRows: first.length,
        materialDivergence: divergence.filter((r) => r.material),
      },
      null,
      2,
    ),
  );
}
function writeBlocked(error: unknown) {
  const root = resolve("data/replay/calibration"),
    reports = resolve("data/replay/reports"),
    c = JSON.parse(
      gunzipSync(readFileSync(resolve(root, "raw-features.json.gz"))).toString(
        "utf8",
      ),
    ) as Corpus,
    m = JSON.parse(
      readFileSync(resolve(root, "session-manifest.json"), "utf8"),
    ) as Manifest,
    fitted = fit(c, m),
    message = error instanceof Error ? error.message : String(error);
  let availabilityStore = createPendingFeedAwareThresholdStore(3);
  for (const subWindow of ATTENTION_SUB_WINDOWS) {
    if (subWindow === "regular") continue;
    availabilityStore = markCalibrationUnavailableByConstruction(
      availabilityStore,
      {
        feedMode: "iex_partial",
        subWindow,
        reason: "insufficient_reference",
      },
    );
  }
  const counts = feedModes.flatMap((feedMode) =>
    ATTENTION_SUB_WINDOWS.map((subWindow) => ({
      feedMode,
      subWindow,
      establishedTrainingRows: c.feeds[feedMode].filter(
        (t) =>
          m.sessions[t[0]].split === "train" &&
          t[16] === 0 &&
          windowAt(t[3]) === subWindow &&
          configured(m.sessions[t[0]], t[3]),
      ).length,
      status: fitted.rows.find(
        (r) => r.feedMode === feedMode && r.subWindow === subWindow,
      ).status,
    })),
  );
  const artifact = {
    schemaVersion: 1,
    status: "CALIBRATION_FAILED",
    thresholdsPublished: false,
    thresholdAvailabilityPublished: true,
    stateReplayComplete: false,
    groundTruthValidation: "REFUSED",
    disclosure: PRE_STREAM_REPLAY_DISCLOSURE,
    contractFixtureNotice:
      "The A3 report's Final WAKING UP: AAOI was a contract fixture, not a historical session result.",
    splitHash: c.splitHash,
    rawFeaturesSha256: sha256(
      readFileSync(resolve(root, "raw-features.json.gz")),
    ),
    sessions: {
      total: m.sessions.length,
      train: m.sessions.filter((s) => s.split === "train").length,
      holdout: m.sessions.filter((s) => s.split === "holdout").length,
      composition: m.sessions,
    },
    feedWindowCoverage: counts,
    unpublishedFitProposals: fitted.rows,
    productFinding:
      "ON THE FREE IEX FEED, THE SCANNER OPERATES DURING THE REGULAR SESSION ONLY. Premarket and after-hours coverage require the consolidated feed.",
    blockingFailures: [
      { kind: "settled_ordering_vs_hysteresis", detail: message },
    ],
    provisionalTranslation: {
      curve: { z50: 2, k: 1.2 },
      watchingZ: inverseNormalizedValue(0.25, { z50: 2, k: 1.2 }),
      emergingZ: 2,
      inPlayZ: inverseNormalizedValue(0.7, { z50: 2, k: 1.2 }),
      partnerAtAxisZ6: partnerInputRequired(
        0.7,
        6,
        { z50: 2, k: 1.2 },
        { z50: 2, k: 1.2 },
      ),
    },
  };
  const artifactHash = sha256(stableJson(artifact));
  mkdirSync(reports, { recursive: true });
  writeFileSync(
    resolve(reports, "attention-thresholds.json"),
    `${JSON.stringify(availabilityStore, null, 2)}\n`,
  );
  writeFileSync(
    resolve(reports, "attention-population-calibration-blocked.json"),
    `${JSON.stringify({ ...artifact, artifactHash }, null, 2)}\n`,
  );
  const composition = m.sessions.map(
      (s) =>
        `| ${s.tradingDate} | ${s.split} | ${s.primaryRegime} | ${s.tags.join(", ")} | ${s.earlyClose ? "yes" : "no"} | ${s.holidayAdjacent ? "yes" : "no"} | ${s.haltCandidate ? "unconfirmed bar gap" : "none"} |`,
    ),
    coverage = counts.map(
      (r) =>
        `| ${r.feedMode} | ${r.subWindow} | ${r.establishedTrainingRows} | ${r.status} |`,
    ),
    proposals = fitted.rows.map((r: any) =>
      r.values
        ? `| ${r.feedMode} | ${r.subWindow} | ${r.status} | ${r.trainingRows} | ${r.values.watchingEnterCore.toFixed(4)} | ${r.values.emergingEnterCore.toFixed(4)} | ${r.values.inPlayEnterCore.toFixed(4)} | ${r.values.newInPlayVelocityPerMinute.toFixed(3)} |`
        : `| ${r.feedMode} | ${r.subWindow} | ${r.status} | ${r.trainingRows} | n/a | n/a | n/a | n/a |`,
    );
  const report = [
    "# Attention Engine population calibration — FAILED",
    "",
    `> ${PRE_STREAM_REPLAY_DISCLOSURE}`,
    "",
    "## CALIBRATION STATUS — FAILED; NO THRESHOLDS PUBLISHED",
    "",
    "> Population calibration is not ground-truth validation. No hit rate, latency, move capture, false-positive rate, or discovery-quality conclusion is available.",
    "",
    `Artifact: \`${artifactHash}\`. Frozen split: \`${c.splitHash}\`. Raw features: \`${artifact.rawFeaturesSha256}\`.`,
    "",
    "The A3 report's `Final WAKING UP: AAOI` was a contract fixture, not a historical session result.",
    "",
    "## Resolved product limitation — IEX-partial extended hours",
    "",
    "> **ON THE FREE IEX FEED, THE SCANNER OPERATES DURING THE REGULAR SESSION ONLY. Premarket and after-hours coverage require the consolidated feed.**",
    "",
    "The mechanism is structural partial-feed sparsity, not a shortage of sessions. Early and late windows contain no target bars. The shoulder windows have 1.3–4.2% target coverage, incomplete synchronized references, and too few displacement/reference baselines. These five sets are `unavailable_by_construction`, emit `insufficient_reference`, and never use a SIP or adjacent-window fallback.",
    "",
    "| Feed | Sub-window | Established training rows | Status |",
    "|---|---|---:|---|",
    ...coverage,
    "",
    "## Remaining blocker — I4 settled ordering conflicts with hysteresis",
    "",
    `Replay stopped at: **${message}**`,
    "",
    "The original AMD/CRWV pending-transition case now passes I1–I4. This failure contains no pending transition: the lower-state symbol and higher-state symbol are both settled inside the same hysteresis overlap. Any strict enter/exit gap permits this ordering, so I4 cannot be guaranteed without changing either hysteresis or the meaning of `pendingTransition`. The assertion was preserved and the replay failed, as required.",
    "",
    "## Provisional curve-v1 translation",
    "",
    "WATCHING 0.25 → z=1.0845 on both axes; EMERGING 0.50 → z=2.0000; IN PLAY 0.70 → z=2.7061. At one axis z=6, the partner still requires z=1.9801. Every viable unpublished proposal passed the hard z≥1.90 asymmetric confluence guard.",
    "",
    "## Unpublished fit proposals",
    "",
    "These are diagnostics only. They were not written to the scoring calibration store.",
    "",
    "| Feed | Window | Status | Train rows | WATCH | EMERGE | IN PLAY | Velocity |",
    "|---|---|---|---:|---:|---:|---:|---:|",
    ...proposals,
    "",
    "## Frozen corpus composition",
    "",
    "40 sessions = 28 train + 12 untouched holdout. Halt evidence is only an inferred SIP bar gap because historical pulls do not include trading-status messages.",
    "",
    "| Date | Split | Primary | Tags | Early close | Holiday adjacent | Halt evidence |",
    "|---|---|---|---|---|---|---|",
    ...composition,
    "",
    "## Missing requested outputs",
    "",
    "State dwell, transition, zero-IN-PLAY, and holdout state populations are unavailable because the mandatory ordering assertion terminated the first training replay. Reporting them from a guard-disabled run would contradict the accepted A3 contract.",
    "",
    "## Scope fence",
    "",
    "No subscription, deployment, migration, Phase B work, Market Map, events, alerts, direction, regime, advanced TA, or live wiring was performed.",
    "",
  ].join("\n");
  writeFileSync(
    resolve(reports, "attention-population-calibration-blocked.md"),
    report,
  );
}
function writeBlockedCorrected(error: unknown) {
  writeBlocked(error);
  const path = resolve(
      "data/replay/reports/attention-population-calibration-blocked.md",
    ),
    report = readFileSync(path, "utf8")
      .replace(
        "ARM was still WATCHING during its required upward persistence while WDC remained IN PLAY under exit persistence.",
        "The higher-core symbol was still WATCHING during required upward persistence while another symbol remained IN PLAY under exit persistence.",
      )
      .replace(
        "terminated the first training replay",
        "terminated the training replay before holdout evaluation began",
      );
  writeFileSync(path, report);
}
try {
  main();
} catch (error) {
  writeBlockedCorrected(error);
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
}
