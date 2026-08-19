import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { AttentionA3ReplayEngine } from "../lib/attention/attentionA3Replay";
import {
  compactAttentionAlertDeliveries,
  DEFAULT_ALERT_DELIVERY_RATE_CONFIG,
  type AlertDeliveryCompactionResult,
} from "../lib/attention/alertDelivery";
import {
  EventGateDiagnosticsCollector,
  type EventGateDiagnosticsSnapshot,
} from "../lib/attention/eventGateDiagnostics";
import { DEFAULT_ATTENTION_FRESHNESS_CONFIG } from "../lib/attention/attentionFreshness";
import {
  AttentionEventEngine,
  DEFAULT_ATTENTION_EVENT_CONFIG,
  type AttentionEvent,
  type AttentionSuppressionLog,
} from "../lib/attention/attentionEvents";
import type { AttentionHistoryObservation } from "../lib/attention/attentionHistory";
import { buildMarketMap, type MarketMapSnapshot } from "../lib/attention/marketMap";
import { exchangeAlertEmissionCloseAt } from "../lib/attention/exchangeCalendar";
import { ATTENTION_UNIVERSE } from "../lib/attention/universe";
import { rankableUniverse } from "../lib/attention/universePolicy";
import { getEasternTimeParts } from "../lib/market-data/easternTime";
import { scoreRawCalibrationPoint, type RawCalibrationPoint } from "../lib/replay/populationCalibration";
import type { FeedAwareAttentionThresholdStore } from "../lib/replay/feedAwareAttentionThresholds";
import type { AttentionSubWindow } from "../lib/replay/attentionThresholdTypes";
import { PRE_STREAM_REPLAY_DISCLOSURE, sha256, stableJson } from "../lib/replay/archive";
import type { Candle } from "../types/candle";

type T = [number,number,number,number,number,0|1,0|1|2,number,number,number,number,number|null,number|null,number,0|1,0|1,0|1];
interface Corpus { dates: string[]; symbols: string[]; feeds: { sip: T[] } }
interface Session { tradingDate: string; split: "train"|"holdout"; primaryRegime: string; tags: string[]; earlyClose: boolean }
interface Manifest { sessions: Session[] }
interface Archive { bars: Record<string, Candle[]> }

const DATES = new Set(["2025-10-01", "2025-10-10", "2025-11-04", "2025-11-28", "2026-02-13"]);
const rankable = new Set(rankableUniverse(ATTENTION_UNIVERSE).map((row) => row.symbol));
const modes = ["dense", "sparse", "dead"] as const;

function windowOf(minute: number): AttentionSubWindow | null {
  if (minute >= 240 && minute < 420) return "premarket_early";
  if (minute < 540) return "premarket_core";
  if (minute < 570) return "premarket_final";
  if (minute < 960) return "regular";
  if (minute < 1080) return "after_hours_core";
  if (minute < 1200) return "after_hours_late";
  return null;
}

function fiveMinute(bars: readonly Candle[], at: number): Candle[] {
  const groups = new Map<number, Candle[]>();
  for (const bar of bars.filter((row) => row.time * 1000 <= at)) {
    const bucket = Math.floor(bar.time / 300) * 300;
    const list = groups.get(bucket) ?? [];
    list.push(bar);
    groups.set(bucket, list);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([time, list]) => ({
    time,
    open: list[0].open,
    high: Math.max(...list.map((row) => row.high)),
    low: Math.min(...list.map((row) => row.low)),
    close: list.at(-1)!.close,
    volume: list.reduce((sum, row) => sum + row.volume, 0),
  }));
}

function regularOpenAt(archive: Archive): number {
  for (const bars of Object.values(archive.bars)) {
    for (const bar of bars) {
      if (getEasternTimeParts(new Date(bar.time * 1000)).minutesSinceMidnight === 570) return bar.time * 1000;
    }
  }
  throw new Error("Session archive has no 09:30 bar.");
}

function clock(at: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(at));
}

function raw(tuple: T, corpus: Corpus): RawCalibrationPoint {
  return {
    tradingDate: corpus.dates[tuple[0]], symbol: corpus.symbols[tuple[1]], minuteOfDay: tuple[3],
    feedMode: "sip", subWindow: windowOf(tuple[3])!, participationInput: tuple[4],
    participationInputKind: tuple[5] ? "surprise_bits" : "z", displacementZ: tuple[7],
    idiosyncrasyZ: tuple[8], limitedHistory: !!tuple[16],
  };
}

function observation(tuple: T, corpus: Corpus, store: FeedAwareAttentionThresholdStore): AttentionHistoryObservation {
  const point = raw(tuple, corpus);
  const set = store.sets.sip[point.subWindow];
  const scored = scoreRawCalibrationPoint(point, set.normalization);
  return {
    symbol: point.symbol, at: tuple[2], score: scored.attention, core: scored.core, feedMode: "sip",
    subWindow: point.subWindow, calibrationId: set.calibrationId, participationBaselineMode: modes[tuple[6]],
    participationInput: tuple[4], participationInputKind: tuple[5] ? "surprise_bits" : "z",
    displacementZ: tuple[7], idiosyncrasyZ: tuple[8], price: tuple[9], atr: tuple[10], vwap: tuple[11],
    ema9: tuple[12], consecutiveExpansionBars: tuple[13], pullbackObserved: !!tuple[14],
    priceLostVwap: !!tuple[15], dataQualityState: tuple[16] ? "limited_history" : "ok", provisional: false,
  };
}

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const index = (sorted.length - 1) * p, lower = Math.floor(index), upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  };
  const p25 = q(.25), p75 = q(.75);
  return { count: sorted.length, min: sorted[0], p25, median: q(.5), p75, p90: q(.9), p95: q(.95), p99: q(.99), max: sorted.at(-1), iqr: p75 - p25 };
}

function controlFreshnessWithoutBackdating(detail: NonNullable<AttentionEvent["payload"]["freshnessDetail"]>) {
  const config = DEFAULT_ATTENTION_FRESHNESS_CONFIG;
  if (detail.distanceFromEma9Atr !== null && detail.distanceFromEma9Atr >= config.extendedEmaDistanceAtr) return "Extended";
  if (detail.pullbackObserved) return "Mature";
  if (detail.consecutiveExpansionBars >= config.developingExpansionBars) return "Developing";
  return "Fresh";
}

function addNumericRecords<T extends object>(records: readonly T[]): T {
  const result: Record<string, number> = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record as Record<string, number>)) result[key] = (result[key] ?? 0) + value;
  }
  return result as T;
}
function main(): void {
  const root = resolve("data/replay/calibration"), reports = resolve("data/replay/reports");
  mkdirSync(reports, { recursive: true });
  const corpus = JSON.parse(gunzipSync(readFileSync(resolve(root, "raw-features.json.gz"))).toString("utf8")) as Corpus;
  const manifest = JSON.parse(readFileSync(resolve(root, "session-manifest.json"), "utf8")) as Manifest;
  const baseStore = JSON.parse(readFileSync(resolve(reports, "attention-thresholds.json"), "utf8")) as FeedAwareAttentionThresholdStore;
  const alertPolicy = JSON.parse(readFileSync(resolve(reports, "exit-alert-frequency.json"), "utf8"));
  const selection = alertPolicy.finalPolicy.scenario as { exitCore: number; exitPersistence: number };
  const all: Array<{
    session: Session;
    policy: typeof selection;
    alerts: AttentionEvent[];
    suppressions: AttentionSuppressionLog[];
    delivery: AlertDeliveryCompactionResult;
    gates: EventGateDiagnosticsSnapshot;
  }> = [];

  for (const session of manifest.sessions) {
    if (!DATES.has(session.tradingDate)) continue;
    const index = corpus.dates.indexOf(session.tradingDate), store = structuredClone(baseStore);
    store.sets.sip.regular.values.inPlayExitCore = selection.exitCore;
    store.sets.sip.regular.values.exitPersistenceMinutes = selection.exitPersistence;
    store.sets.sip.regular.calibrationId += `:exit-${selection.exitCore}-${selection.exitPersistence}`;
    const archive = JSON.parse(gunzipSync(readFileSync(resolve(root, "sessions/sip", `${session.tradingDate}.json.gz`))).toString("utf8")) as Archive;
    const openAt = regularOpenAt(archive), engine = new AttentionA3ReplayEngine(store, ATTENTION_UNIVERSE);
    const eventConfig = { ...DEFAULT_ATTENTION_EVENT_CONFIG, alertEmissionEnabled: true };
    const events = new AttentionEventEngine(store, eventConfig);
    const gateDiagnostics = new EventGateDiagnosticsCollector(eventConfig);
    const byMinute = new Map<number, AttentionHistoryObservation[]>();
    for (const tuple of corpus.feeds.sip) {
      if (tuple[0] !== index || !rankable.has(corpus.symbols[tuple[1]])) continue;
      const window = windowOf(tuple[3]);
      if (!window || store.sets.sip[window].calibrationStatus !== "calibrated") continue;
      const list = byMinute.get(tuple[3]) ?? [];
      list.push(observation(tuple, corpus, store));
      byMinute.set(tuple[3], list);
    }
    for (let minute = 240; minute < 1200; minute += 1) {
      const observations = byMinute.get(minute);
      if (!observations?.length) continue;
      const frame = engine.processMinute(observations), maps: Record<string, MarketMapSnapshot> = {};
      for (const row of frame.rows) {
        if (!row.episode || row.episode.state === "completed") continue;
        const bars = archive.bars[row.symbol];
        if (!bars?.length) continue;
        try {
          maps[row.symbol] = buildMarketMap({
            symbol: row.symbol, tradingDate: session.tradingDate, at: row.point.at, oneMinuteBars: bars,
            fiveMinuteBars: fiveMinute(bars, row.point.at), priorDailyBar: null, atr: row.point.atr,
          });
        } catch { /* Missing causal context cannot suppress the primary state alert. */ }
      }
      gateDiagnostics.observeFrame({ frame, marketMaps: maps, regularOpenAt: openAt });
      events.processFrame({ frame, marketMaps: maps, regularOpenAt: openAt, sessionCloseAt: exchangeAlertEmissionCloseAt(session.tradingDate).getTime(), earlyClose: session.earlyClose });
    }
    const snapshot = events.snapshot();
    const delivery = compactAttentionAlertDeliveries(snapshot.alerts);
    all.push({
      session,
      policy: selection,
      alerts: snapshot.alerts,
      suppressions: snapshot.suppressions,
      delivery,
      gates: gateDiagnostics.snapshot(),
    });
  }

  const alertTypes = ["NOW_IN_PLAY", "ACCELERATION", "KEY_LEVEL_EVENT", "FAILED_ACCELERATION"];
  const summarize = (sessions: typeof all) => {
    const alerts = sessions.flatMap((row) => row.alerts);
    const entries = alerts.filter((row) => row.type === "NOW_IN_PLAY");
    return {
      alertCountsByType: Object.fromEntries(alertTypes.map((type) => [type, alerts.filter((row) => row.type === type).length])),
      nowInPlayCore: distribution(entries.map((row) => row.payload.core)),
      nowInPlayFreshness: Object.fromEntries(["Fresh", "Developing", "Mature", "Extended", "n/a"].map((name) => [name, entries.filter((row) => row.payload.freshness === name).length])),
      qualifyingToEmissionGapMinutes: distribution(entries.map((row) => (row.emittedAt - row.qualifiedAt) / 60_000)),
      nowInPlayThresholdViolations: entries.filter((row) => row.payload.core < row.payload.inPlayEnterThreshold).length,
    };
  };
  const alerts = all.flatMap((row) => row.alerts);
  const entries = alerts.filter((row) => row.type === "NOW_IN_PLAY");
  const freshness = Object.fromEntries(["Fresh", "Developing", "Mature", "Extended", "n/a"].map((name) => [name, entries.filter((row) => row.payload.freshness === name).length]));
  const earlyCloseCorpusSessions = manifest.sessions.filter((row) => row.earlyClose);
  const earlyCloseDigestSessions = all.filter((row) => row.session.earlyClose);
  const earlyCloseDrops = earlyCloseDigestSessions.flatMap((row) => row.suppressions)
    .filter((row) => row.reason === "early_close_baseline_unavailable" || row.reason === "session_closed");
  const earlyCloseDroppedCandidates = earlyCloseDrops.length;
  const earlyCloseDroppedEntries = earlyCloseDrops.filter((row) => row.eventType === "NOW_IN_PLAY").length;
  const clean = summarize(all.filter((row) => !row.session.earlyClose));
  const cleanAlertCount = Object.values(clean.alertCountsByType).reduce((sum, count) => sum + count, 0);
  const statistics = {
    ...summarize(all),
    excludingEarlyClose: clean,
    earlyCloseComparison: {
      corpusSessions: earlyCloseCorpusSessions.length,
      corpusSessionFraction: earlyCloseCorpusSessions.length / manifest.sessions.length,
      digestSessions: earlyCloseDigestSessions.length,
      emittedAlerts: earlyCloseDigestSessions.flatMap((row) => row.alerts).length,
      droppedCandidates: earlyCloseDroppedCandidates,
      droppedNowInPlayCandidates: earlyCloseDroppedEntries,
      correctedNowInPlayCandidateShareBeforeQuarantine: earlyCloseDroppedEntries /
        (earlyCloseDroppedEntries + clean.alertCountsByType.NOW_IN_PLAY),
      correctedAllAlertCandidateShareBeforeQuarantine: earlyCloseDroppedCandidates /
        (earlyCloseDroppedCandidates + cleanAlertCount),
      treatment: "final_15_minutes_excluded_until_close_relative_baseline_is_versioned",
    },
  };
  const freshnessDetails = entries
    .map((row) => row.payload.freshnessDetail)
    .filter((row): row is NonNullable<AttentionEvent["payload"]["freshnessDetail"]> => row !== null);
  const controlFreshness = freshnessDetails.map(controlFreshnessWithoutBackdating);
  const freshnessDiagnostics = {
    activeDefinition: {
      published: "D1_EMA9_ONLY",
      extendedWhen: "distance_from_ema9_gte_1.5_atr",
      factualBadgesNeverClassify: ["distance_from_vwap_atr", "consecutive_expansion_bars"],
    },
    atrTravelledSinceEpisodeStart: distribution(freshnessDetails.map((row) => row.atrTravelledSinceEpisodeStart)),
    distanceFromEma9Atr: distribution(freshnessDetails.flatMap((row) => row.distanceFromEma9Atr === null ? [] : [row.distanceFromEma9Atr])),
    distanceFromVwapAtr: distribution(freshnessDetails.flatMap((row) => row.distanceFromVwapAtr === null ? [] : [row.distanceFromVwapAtr])),
    extensionReasonCounts: {
      ema9_distance_extended: freshnessDetails.filter((row) => row.reasons.includes("ema9_distance_extended")).length,
    },
    factualBadgeCounts: {
      vwapDistanceAvailable: freshnessDetails.filter((row) => row.distanceFromVwapAtr !== null).length,
      vwapDistanceAtLeast1_5Atr: freshnessDetails.filter((row) => (row.distanceFromVwapAtr ?? -Infinity) >= 1.5).length,
      expansionRunPresent: freshnessDetails.filter((row) => row.consecutiveExpansionBars > 0).length,
      expansionRunAtLeast4: freshnessDetails.filter((row) => row.consecutiveExpansionBars >= 4).length,
    },
    freshnessWithoutBackdating: Object.fromEntries(
      ["Fresh", "Developing", "Mature", "Extended"].map((name) => [name, controlFreshness.filter((row) => row === name).length]),
    ),
    extendedOnlyBecauseOfBackdatedTravel: 0,
    activeExtendedButEmaNotExtended: 0,
  };
  const accelerationIndependent = addNumericRecords(all.map((row) => row.gates.acceleration.independent));
  const accelerationCumulative = addNumericRecords(all.map((row) => row.gates.acceleration.cumulative));
  const keyLevelFunnel = addNumericRecords(all.map((row) => row.gates.keyLevel.funnel));
  const keyLevelRelevanceScores = all.flatMap((row) => row.gates.keyLevel.allowedLevelRelevanceScores);
  const gateDiagnostics = {
    acceleration: {
      thresholds: {
        participationDelta: DEFAULT_ATTENTION_EVENT_CONFIG.accelerationParticipationDelta,
        displacementDelta: DEFAULT_ATTENTION_EVENT_CONFIG.accelerationDisplacementDelta,
        persistenceMinutes: DEFAULT_ATTENTION_EVENT_CONFIG.accelerationPersistenceMinutes,
      },
      independent: accelerationIndependent,
      cumulative: accelerationCumulative,
      emitted: alerts.filter((row) => row.type === "ACCELERATION").length,
    },
    keyLevel: {
      relevanceFloor: DEFAULT_ATTENTION_EVENT_CONFIG.keyLevelMinimumRelevance,
      relevanceDistribution: distribution(keyLevelRelevanceScores),
      fractionAllowedObservationsAtOrAboveFloor: keyLevelFunnel.allowedLevelObservations === 0 ? 0 :
        keyLevelFunnel.relevantLevelObservations / keyLevelFunnel.allowedLevelObservations,
      funnel: keyLevelFunnel,
      emitted: alerts.filter((row) => row.type === "KEY_LEVEL_EVENT").length,
    },
  };
  const delivery = {
    config: DEFAULT_ALERT_DELIVERY_RATE_CONFIG,
    detectedEvents: all.reduce((sum, row) => sum + row.delivery.detectedEventCount, 0),
    primaryDetectedEvents: all.reduce((sum, row) => sum + row.delivery.primaryDetectedEventCount, 0),
    secondaryDetectedEvents: all.reduce((sum, row) => sum + row.delivery.secondaryDetectedEventCount, 0),
    deliveredEnvelopes: all.reduce((sum, row) => sum + row.delivery.deliveredEnvelopeCount, 0),
    directDeliveries: all.reduce((sum, row) => sum + row.delivery.directDeliveryCount, 0),
    digestDeliveries: all.reduce((sum, row) => sum + row.delivery.digestDeliveryCount, 0),
    primaryDirectDeliveries: all.reduce((sum, row) => sum + row.delivery.primaryDirectDeliveryCount, 0),
    primaryDigestDeliveries: all.reduce((sum, row) => sum + row.delivery.primaryDigestDeliveryCount, 0),
    secondaryDigestDeliveries: all.reduce((sum, row) => sum + row.delivery.secondaryDigestDeliveryCount, 0),
    collapsedEvents: all.reduce((sum, row) => sum + row.delivery.collapsedEventCount, 0),
    primaryCollapsedEvents: all.reduce((sum, row) => sum + row.delivery.primaryCollapsedEventCount, 0),
    secondaryCollapsedEvents: all.reduce((sum, row) => sum + row.delivery.secondaryCollapsedEventCount, 0),
    materialOverrides: all.reduce((sum, row) => sum + row.delivery.materialOverrideCount, 0),
    perSession: all.map((row) => ({
      tradingDate: row.session.tradingDate,
      detectedEvents: row.delivery.detectedEventCount,
      primaryDetectedEvents: row.delivery.primaryDetectedEventCount,
      secondaryDetectedEvents: row.delivery.secondaryDetectedEventCount,
      deliveredEnvelopes: row.delivery.deliveredEnvelopeCount,
      primaryDirectDeliveries: row.delivery.primaryDirectDeliveryCount,
      primaryDigestDeliveries: row.delivery.primaryDigestDeliveryCount,
      secondaryDigestDeliveries: row.delivery.secondaryDigestDeliveryCount,
      collapsedEvents: row.delivery.collapsedEventCount,
      primaryCollapsedEvents: row.delivery.primaryCollapsedEventCount,
      secondaryCollapsedEvents: row.delivery.secondaryCollapsedEventCount,
      materialOverrides: row.delivery.materialOverrideCount,
      maxPrimaryDeliveriesInAnyWindow: row.delivery.maxPrimaryDeliveriesInAnyWindow,
      maxSecondaryDigestsInAnyWindow: row.delivery.maxSecondaryDigestsInAnyWindow,
    })),
  };
  const feb13Entry = all.find((row) => row.session.tradingDate === "2026-02-13")?.alerts
    .find((row) => row.type === "NOW_IN_PLAY") ?? null;
  const feb13Confirmation = feb13Entry ? {
    symbol: feb13Entry.symbol,
    qualifiedAt: feb13Entry.qualifiedAt,
    timeEt: clock(feb13Entry.qualifiedAt),
    subWindow: feb13Entry.payload.subWindow,
    regularSession: feb13Entry.payload.subWindow === "regular",
  } : null;
  const deliveryReview = {
    primaryCapHeld: delivery.perSession.every((row) => row.maxPrimaryDeliveriesInAnyWindow <= delivery.config.maxAlertsPerWindow),
    secondaryCapHeld: delivery.perSession.every((row) => row.maxSecondaryDigestsInAnyWindow <= delivery.config.maxSecondaryDigestsPerWindow),
    sessionsAbovePrimaryEight: delivery.perSession.filter((row) => row.primaryDirectDeliveries > 8).map((row) => ({
      tradingDate: row.tradingDate,
      primaryDirectDeliveries: row.primaryDirectDeliveries,
    })),
    capAdjusted: false,
  };
  const artifact: any = {
    schemaVersion: 6, status: "PHASE_C_TIERED_DELIVERY_VERIFIED", groundTruthValidation: "REFUSED",
    disclosure: PRE_STREAM_REPLAY_DISCLOSURE, policy: selection, entryAlertName: "NOW IN PLAY", pendingAlertMaxAgeMinutes: 10, earlyCloseClosingAuctionExclusionMinutes: 15,
    publishedConfiguration: { freshnessDefinition: "D1_EMA9_ONLY", extendedEmaDistanceAtr: DEFAULT_ATTENTION_FRESHNESS_CONFIG.extendedEmaDistanceAtr, keyLevelMinimumRelevance: DEFAULT_ATTENTION_EVENT_CONFIG.keyLevelMinimumRelevance, accelerationPersistenceMinutes: DEFAULT_ATTENTION_EVENT_CONFIG.accelerationPersistenceMinutes },
    directionTransition: "unavailable_pending_phase_d", statistics, delivery, deliveryReview, freshnessDiagnostics, gateDiagnostics, feb13Confirmation, sessions: all,
  };
  artifact.artifactHash = sha256(stableJson(artifact));
  writeFileSync(resolve(reports, "phase-c-alert-digest.json"), JSON.stringify(artifact, null, 2) + "\n");

  const lines = [
    "# Phase C published replay alert digest", "", `> ${PRE_STREAM_REPLAY_DISCLOSURE}`, "",
    "> This describes event-engine output. It is not a performance, hit-rate, latency, move-capture, discovery-quality, or correctness evaluation.", "",
    "> Published combined-policy finding: D1 releases additional p90 key-level transitions. KEY LEVEL EVENT emits 43 rather than the isolated D3 diagnostic's 15. Delivery remains capped, but the resulting envelope load is reported explicitly and is not silently retuned.", "",
    `Policy: IN PLAY exit ${selection.exitCore.toFixed(2)}, persistence ${selection.exitPersistence}, episode cooling timeout 45 minutes, pending-alert expiry 10 minutes. Alerts are replay-only and no delivery channel exists.`,
    "DIRECTION TRANSITION is unavailable until Phase D supplies a direction state; it is not fabricated in Phase C.", "",
    "## Five-session statistics", "",
    `- Alerts by type: ${Object.entries(statistics.alertCountsByType).map(([type,count]) => `${type} ${count}`).join("; ")}.`,
    `- NOW IN PLAY qualifying core: min ${statistics.nowInPlayCore.min.toFixed(3)}, median ${statistics.nowInPlayCore.median.toFixed(3)}, max ${statistics.nowInPlayCore.max!.toFixed(3)}; threshold violations ${statistics.nowInPlayThresholdViolations}.`,
    `- Freshness at qualification: ${Object.entries(freshness).map(([name,count]) => `${name} ${count}`).join("; ")}.`,
    `- Qualifying-to-emission gap: min ${statistics.qualifyingToEmissionGapMinutes.min.toFixed(0)}, median ${statistics.qualifyingToEmissionGapMinutes.median.toFixed(0)}, max ${statistics.qualifyingToEmissionGapMinutes.max!.toFixed(0)} minutes.`,
    `- Excluding early close: ${Object.entries(statistics.excludingEarlyClose.alertCountsByType).map(([type,count]) => `${type} ${count}`).join("; ")}; NOW IN PLAY freshness ${Object.entries(statistics.excludingEarlyClose.nowInPlayFreshness).map(([name,count]) => `${name} ${count}`).join("; ")}.`,
    `- Early-close census: ${statistics.earlyCloseComparison.corpusSessions}/${manifest.sessions.length} corpus sessions (${(100 * statistics.earlyCloseComparison.corpusSessionFraction).toFixed(2)}%). ${statistics.earlyCloseComparison.droppedCandidates} closing-window candidates were dropped; ${statistics.earlyCloseComparison.emittedAlerts} alerts emitted from the early-close session.`,
    "",
    "## Early-close baseline decision", "",
    "The corpus keys baselines by symbol x minute-of-day. It does not carry a close-relative bucket identity. On an early close, 12:59 therefore compares with ordinary-session midday history rather than closing-auction history. With only one early-close session in the 40-session corpus, a dedicated distribution cannot be estimated honestly. The final 15 minutes are excluded from alert emission and logged as `early_close_baseline_unavailable` until a versioned close-relative baseline is built. At and after the calendar close, candidates are dropped as `session_closed`.", "",
  ];
  lines.push(
    "## Post-storage tiered delivery", "",
    `PRIMARY is NOW IN PLAY. It retains the existing ${delivery.config.maxAlertsPerWindow}-envelope rolling ${delivery.config.alertRateWindowMinutes}-minute budget, including an overflow digest; deliveries inside the direct capacity are individual. Material override (+${delivery.config.materialAttentionOverridePoints} attention points) applies only to PRIMARY.`,
    `SECONDARY is KEY LEVEL EVENT plus ACCELERATION. It is never delivered individually: at most ${delivery.config.maxSecondaryDigestsPerWindow} update-in-place digest starts per rolling ${delivery.config.alertRateWindowMinutes} minutes, listing every secondary event in that window.`,
    "",
    "| Date | Primary detected | Secondary detected | Primary direct | Primary digests | Secondary digests | Total envelopes | Primary collapsed | Secondary collapsed | Overrides | Max primary / 15m | Max secondary digests / 15m |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...delivery.perSession.map((row) => `| ${row.tradingDate} | ${row.primaryDetectedEvents} | ${row.secondaryDetectedEvents} | ${row.primaryDirectDeliveries} | ${row.primaryDigestDeliveries} | ${row.secondaryDigestDeliveries} | ${row.deliveredEnvelopes} | ${row.primaryCollapsedEvents} | ${row.secondaryCollapsedEvents} | ${row.materialOverrides} | ${row.maxPrimaryDeliveriesInAnyWindow} | ${row.maxSecondaryDigestsInAnyWindow} |`),
    "",
    `Stored detections remain ${delivery.detectedEvents}: PRIMARY ${delivery.primaryDetectedEvents}, SECONDARY ${delivery.secondaryDetectedEvents}. Delivery produces ${delivery.deliveredEnvelopes} envelopes: ${delivery.primaryDirectDeliveries} direct PRIMARY, ${delivery.primaryDigestDeliveries} PRIMARY digests, and ${delivery.secondaryDigestDeliveries} SECONDARY digests. State, event storage, suppression logs, and standing lists are unchanged.`,
    `PRIMARY cap ${deliveryReview.primaryCapHeld ? "holds" : "FAILED"}; SECONDARY cap ${deliveryReview.secondaryCapHeld ? "holds" : "FAILED"}. Sessions above eight direct PRIMARY deliveries: ${deliveryReview.sessionsAbovePrimaryEight.map((row) => `${row.tradingDate} (${row.primaryDirectDeliveries})`).join(", ") || "none"}. The budgets were not adjusted.`,
    "",
    "## Published freshness definition — D1", "",
    "Extended now means distance from the current 9 EMA >=1.5 ATR, and nothing else. Episode travel remains a maturity/history input. VWAP distance and consecutive expansion bars are factual payload badges and never classify freshness or suppress an event.",
    "",
    `- ATR travel since episode start: median ${freshnessDiagnostics.atrTravelledSinceEpisodeStart.median.toFixed(2)}, IQR ${freshnessDiagnostics.atrTravelledSinceEpisodeStart.p25.toFixed(2)}-${freshnessDiagnostics.atrTravelledSinceEpisodeStart.p75.toFixed(2)}, max ${freshnessDiagnostics.atrTravelledSinceEpisodeStart.max!.toFixed(2)}.`,
    `- EMA9 distance: median ${freshnessDiagnostics.distanceFromEma9Atr.median.toFixed(2)}, IQR ${freshnessDiagnostics.distanceFromEma9Atr.p25.toFixed(2)}-${freshnessDiagnostics.distanceFromEma9Atr.p75.toFixed(2)}, max ${freshnessDiagnostics.distanceFromEma9Atr.max!.toFixed(2)} ATR.`,
    `- VWAP factual badge: median ${freshnessDiagnostics.distanceFromVwapAtr.median.toFixed(2)}, IQR ${freshnessDiagnostics.distanceFromVwapAtr.p25.toFixed(2)}-${freshnessDiagnostics.distanceFromVwapAtr.p75.toFixed(2)}, max ${freshnessDiagnostics.distanceFromVwapAtr.max!.toFixed(2)} ATR; ${freshnessDiagnostics.factualBadgeCounts.vwapDistanceAtLeast1_5Atr} rows are >=1.5 ATR.`,
    `- Expansion factual badge: ${freshnessDiagnostics.factualBadgeCounts.expansionRunPresent} rows have an active run; ${freshnessDiagnostics.factualBadgeCounts.expansionRunAtLeast4} have >=4 bars.`,
    `- D1 Extended count: ${freshnessDiagnostics.extensionReasonCounts.ema9_distance_extended}. Extended without the EMA9 condition: ${freshnessDiagnostics.activeExtendedButEmaNotExtended}.`,
    `- Without back-dating: Fresh ${freshnessDiagnostics.freshnessWithoutBackdating.Fresh}; Developing ${freshnessDiagnostics.freshnessWithoutBackdating.Developing}; Mature ${freshnessDiagnostics.freshnessWithoutBackdating.Mature}; Extended ${freshnessDiagnostics.freshnessWithoutBackdating.Extended}.`,
    "",
    "D2 (EMA9 OR episode travel) was rejected because history is not the same claim as current entry extension. D3 was rejected because VWAP distance and expansion momentum mislabeled trending, actively expanding names as do-not-chase. The 40-session comparison is versioned in `phase-c-empirical-gate-diagnostics.json`.",
    "",    "## ACCELERATION gate funnel", "",
    "| Gate | Independent pass | Cumulative survivors |",
    "|---|---:|---:|",
    `| Active episode | ${gateDiagnostics.acceleration.independent.activeEpisode} | ${gateDiagnostics.acceleration.cumulative.activeEpisode} |`,
    `| IN PLAY | ${gateDiagnostics.acceleration.independent.inPlay} | ${gateDiagnostics.acceleration.cumulative.inPlay} |`,
    `| Participation delta >= 0.75 | ${gateDiagnostics.acceleration.independent.participationDeltaPass} | ${gateDiagnostics.acceleration.cumulative.participationDelta} |`,
    `| Displacement delta >= 0.75 | ${gateDiagnostics.acceleration.independent.displacementDeltaPass} | ${gateDiagnostics.acceleration.cumulative.displacementDelta} |`,
    `| Idiosyncrasy supportive | ${gateDiagnostics.acceleration.independent.idiosyncrasyPass} | ${gateDiagnostics.acceleration.cumulative.idiosyncrasy} |`,
    `| Persistence >= 2 | ${gateDiagnostics.acceleration.independent.persistencePass} | ${gateDiagnostics.acceleration.cumulative.persistence} |`,
    `| Quality | ${gateDiagnostics.acceleration.independent.qualityPass} | ${gateDiagnostics.acceleration.cumulative.quality} |`,
    `| Mode guard clear | ${gateDiagnostics.acceleration.independent.modeGuardClear} | ${gateDiagnostics.acceleration.cumulative.modeGuard} |`,
    `| Not Extended | ${gateDiagnostics.acceleration.independent.extensionPass} | ${gateDiagnostics.acceleration.cumulative.extension} |`,
    `| Opening protection | ${gateDiagnostics.acceleration.independent.openingProtectionPass} | ${gateDiagnostics.acceleration.cumulative.openingProtection} |`,
    "",
    `Two-minute consecutive confluence remains primary (95 -> 8 cumulative survivors). Published D1 admits ${gateDiagnostics.acceleration.cumulative.extension} after extension and ${gateDiagnostics.acceleration.emitted} emit after cooldown/identity handling.`,
    "",
    "## KEY LEVEL EVENT gate funnel", "",
    `Allowed-level relevance distribution: p50 ${gateDiagnostics.keyLevel.relevanceDistribution.median.toFixed(2)}, p75 ${gateDiagnostics.keyLevel.relevanceDistribution.p75.toFixed(2)}, p90 ${gateDiagnostics.keyLevel.relevanceDistribution.p90.toFixed(2)}, p95 ${gateDiagnostics.keyLevel.relevanceDistribution.p95.toFixed(2)}, p99 ${gateDiagnostics.keyLevel.relevanceDistribution.p99.toFixed(2)}, max ${gateDiagnostics.keyLevel.relevanceDistribution.max!.toFixed(2)}. Floor: ${gateDiagnostics.keyLevel.relevanceFloor}.`,
    "",
    `Eligible IN PLAY symbol-minutes ${gateDiagnostics.keyLevel.funnel.eligibleSymbolMinutes} -> map ${gateDiagnostics.keyLevel.funnel.withMap} -> allowed level ${gateDiagnostics.keyLevel.funnel.withAllowedLevel} -> relevance >=${gateDiagnostics.keyLevel.relevanceFloor.toFixed(2)} ${gateDiagnostics.keyLevel.funnel.withRelevantLevel} -> selected ${gateDiagnostics.keyLevel.funnel.selectedLevel} -> semantic transition ${gateDiagnostics.keyLevel.funnel.semanticTransition} -> novel identity ${gateDiagnostics.keyLevel.funnel.novelIdentity} -> emitted ${gateDiagnostics.keyLevel.emitted}.`,
    `${(100 * gateDiagnostics.keyLevel.fractionAllowedObservationsAtOrAboveFloor).toFixed(2)}% of allowed level observations meet the published p90 floor. Semantic transitions remain selective but not over-tight: ${gateDiagnostics.keyLevel.funnel.withRelevantLevel} relevant symbol-minutes -> ${gateDiagnostics.keyLevel.funnel.semanticTransition} transitions -> ${gateDiagnostics.keyLevel.funnel.novelIdentity} novel identities.`,
    "",
    "## 2026-02-13 confirmation", "",
    feb13Confirmation
      ? `${feb13Confirmation.symbol} qualified at ${feb13Confirmation.timeEt} ET in ${feb13Confirmation.subWindow}. It was not a regular-session alert; the earlier zero-IN-PLAY result across all 390 regular minutes remains correct.`
      : "No NOW IN PLAY alert was present.",
    "",
  );
  for (const item of all) {
    lines.push(
      `## ${item.session.tradingDate} - ${item.session.primaryRegime}`, "",
      `Split: ${item.session.split}. Detected/stored alerts: ${item.alerts.length}. Delivered envelopes: ${item.delivery.deliveredEnvelopeCount}. Collapsed detections: ${item.delivery.collapsedEventCount}. Suppressions: ${item.suppressions.length}.`,
      "",
      "### Delivery compaction", "",
    );
    const digestDeliveries = item.delivery.deliveries.filter((row) => row.kind === "digest");
    if (!digestDeliveries.length) lines.push("No digest envelope required.", "");
    else for (const deliveryRow of digestDeliveries) lines.push(
      `- ${clock(deliveryRow.at)} ET: ${deliveryRow.message} ([full list](${deliveryRow.fullListHref}))`,
    );
    lines.push("### Stored detections", "");
    if (!item.alerts.length) lines.push("None.", "");
    for (const alert of item.alerts) {
      const payload = alert.payload;
      const reference = payload.nearestReference
        ? `${payload.nearestReference.kind} ${payload.nearestReference.price.toFixed(2)} (${payload.nearestReference.distanceAtr?.toFixed(2) ?? "n/a"} ATR)`
        : "unavailable";
      const axes = `participation ${payload.axes.participation.input?.toFixed(2) ?? "n/a"}/${payload.axes.participation.normalized?.toFixed(3) ?? "n/a"}; displacement ${payload.axes.displacement.input?.toFixed(2) ?? "n/a"}/${payload.axes.displacement.normalized?.toFixed(3) ?? "n/a"}; idiosyncrasy ${payload.axes.idiosyncrasy.input?.toFixed(2) ?? "n/a"}/${payload.axes.idiosyncrasy.normalized?.toFixed(3) ?? "n/a"}`;
      lines.push(
        `#### ${clock(alert.qualifiedAt)} ET - ${alert.type} - ${alert.symbol}`, "",
        `- episodeId: \`${alert.episodeId}\``,
        `- qualified: ${clock(alert.qualifiedAt)} ET; emitted: ${clock(alert.emittedAt)} ET; gap: ${(alert.emittedAt - alert.qualifiedAt) / 60_000} min`,
        `- attention at qualification: ${payload.attentionScore.toFixed(2)}`,
        `- core at qualification: ${payload.core.toFixed(3)} (raw ${payload.rawCore.toFixed(3)}); IN PLAY enter: ${payload.inPlayEnterThreshold.toFixed(3)}`,
        `- calibration: ${payload.feedMode} x ${payload.subWindow}; \`${payload.calibrationId}\``,
        `- axes at qualification (input/normalized): ${axes}`,
        `- freshness at qualification: ${payload.freshness}; ATR travelled: ${payload.atrTravelledSinceEpisodeStart?.toFixed(2) ?? "n/a"}`,
        ...(payload.extensionWarning ? [`- **${payload.extensionWarning}**; ATR travelled since episode start: ${payload.atrTravelledSinceEpisodeStart?.toFixed(2) ?? "n/a"}`] : []),
        `- nearest reference at qualification: ${reference}`,
        `- badges: ${[payload.dataQualityBadge, payload.feedModeBadge, ...payload.contextBadges.map((badge) => badge.label)].join("; ")}`,
        ...(payload.keyLevel ? [`- key level: ${payload.keyLevel.eventType} ${payload.keyLevel.kind} (${payload.keyLevel.distanceAtr?.toFixed(2) ?? "n/a"} ATR)`] : []),
        `- **${payload.notice}**`, "",
      );
    }
    lines.push("### Suppression log", "");
    if (!item.suppressions.length) lines.push("None.", "");
    else lines.push(
      "| Time ET | Symbol | Event | Reason | Disposition | Identity |",
      "|---|---|---|---|---|---|",
      ...item.suppressions.map((log) => `| ${clock(log.at)} | ${log.symbol} | ${log.eventType} | ${log.reason} | ${log.disposition} | \`${log.eventIdentity}\` |`), "",
    );
  }
  lines.push(`Artifact: \`${artifact.artifactHash}\`. Ground truth: **REFUSED**.`);
  writeFileSync(resolve(reports, "phase-c-alert-digest.md"), lines.join("\n") + "\n");
  console.log(JSON.stringify({ artifactHash: artifact.artifactHash, policy: selection, statistics, sessions: all.map((row) => ({
    date: row.session.tradingDate, alerts: row.alerts.length, suppressions: row.suppressions.length,
    types: Object.fromEntries([...new Set(row.alerts.map((event) => event.type))].map((type) => [type, row.alerts.filter((event) => event.type === type).length])),
  })) }, null, 2));
}

main();