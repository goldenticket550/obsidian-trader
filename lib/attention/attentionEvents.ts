import type { AttentionA3Frame, AttentionA3FrameRow } from "./attentionA3Replay";
import { normalizeAttentionAxis } from "./attentionAxes";
import type { AttentionHistoryPoint } from "./attentionHistory";
import type { MarketMapLevel, MarketMapReference, MarketMapSnapshot } from "./marketMap";
import type { AttentionSubWindow } from "@/lib/replay/attentionThresholdTypes";
import {
  calibrationSetForScore,
  thresholdValuesForReplay,
  type FeedAwareAttentionThresholdStore,
} from "@/lib/replay/feedAwareAttentionThresholds";

export type AttentionEventType = "NOW_IN_PLAY" | "ACCELERATION" | "KEY_LEVEL_EVENT" | "FAILED_ACCELERATION";
export type AttentionSuppressionReason =
  | "cooldown_active"
  | "insufficient_persistence"
  | "data_suspect"
  | "backfill_guard"
  | "halt_resume_guard"
  | "same_level_state"
  | "not_material_change"
  | "extended"
  | "opening_noise_guard"
  | "episode_already_alerted"
  | "redundant_with_entry"
  | "pending_expired"
  | "session_closed"
  | "early_close_baseline_unavailable";
export type KeyLevelEventType = "approach" | "break" | "reclaim" | "rejection" | "retest" | "failed_break";

export interface AttentionEventConfig {
  alertEmissionEnabled: boolean;
  emitFailedAcceleration: boolean;
  accelerationParticipationDelta: number;
  accelerationDisplacementDelta: number;
  accelerationPersistenceMinutes: number;
  accelerationCooldownMinutes: number;
  keyLevelProximityAtr: number;
  keyLevelMinimumRelevance: number;
  openingProtectionMinutes: number;
  openingMinimumDisplacementZ: number;
  pendingAlertMaxAgeMinutes: number;
  earlyCloseClosingAuctionExclusionMinutes: number;
}

export const PUBLISHED_KEY_LEVEL_RELEVANCE_FLOOR = 84.11111111111111;

export const DEFAULT_ATTENTION_EVENT_CONFIG: AttentionEventConfig = {
  alertEmissionEnabled: false,
  emitFailedAcceleration: false,
  accelerationParticipationDelta: 0.75,
  accelerationDisplacementDelta: 0.75,
  accelerationPersistenceMinutes: 2,
  accelerationCooldownMinutes: 15,
  keyLevelProximityAtr: 0.15,
  keyLevelMinimumRelevance: PUBLISHED_KEY_LEVEL_RELEVANCE_FLOOR,
  openingProtectionMinutes: 15,
  openingMinimumDisplacementZ: 2.5,
  pendingAlertMaxAgeMinutes: 10,
  earlyCloseClosingAuctionExclusionMinutes: 15,
};

export interface AxisEventContribution {
  input: number | null;
  inputKind: "z" | "surprise_bits";
  normalized: number | null;
  scoringRole: "core" | "modifier" | "display_only";
}

export interface AttentionContextBadge {
  kind: "vwap_distance" | "expansion_run";
  label: string;
  value: number;
  unit: "atr" | "bars";
}

export interface AttentionEventPayload {
  episodeId: string;
  symbol: string;
  /** I7: every market value in this payload is frozen at this qualifying timestamp. */
  at: number;
  attentionScore: number;
  /** State-decision core; I6 compares this value with the exact entry threshold. */
  core: number;
  rawCore: number;
  inPlayEnterThreshold: number;
  feedMode: "sip" | "iex_partial";
  subWindow: AttentionSubWindow;
  calibrationId: string;
  axes: {
    participation: AxisEventContribution;
    displacement: AxisEventContribution;
    idiosyncrasy: AxisEventContribution;
  };
  freshness: "Fresh" | "Developing" | "Mature" | "Extended" | "n/a";
  freshnessDetail: {
    minutesSinceEpisodeStart: number;
    atrTravelledSinceEpisodeStart: number;
    distanceFromVwapAtr: number | null;
    distanceFromEma9Atr: number | null;
    consecutiveExpansionBars: number;
    pullbackObserved: boolean;
    reasons: string[];
  } | null;
  /** Factual context only. These badges never classify or suppress an event. */
  contextBadges: AttentionContextBadge[];
  atrTravelledSinceEpisodeStart: number | null;
  nearestReference: MarketMapReference | null;
  dataQualityBadge: string;
  feedModeBadge: "SIP" | "IEX PARTIAL";
  notice: string;
  extensionWarning: "EXTENDED \u2014 do not chase" | null;
  keyLevel?: { levelId: string; kind: string; eventType: KeyLevelEventType; distanceAtr: number | null };
}

export interface AttentionEvent {
  eventId: string;
  type: AttentionEventType;
  symbol: string;
  /** The alert's stated market timestamp is always the qualifying timestamp. */
  at: number;
  qualifiedAt: number;
  emittedAt: number;
  episodeId: string;
  payload: AttentionEventPayload;
}

export interface AttentionSuppressionLog {
  at: number;
  symbol: string;
  episodeId: string;
  eventType: AttentionEventType;
  eventIdentity: string;
  reason: AttentionSuppressionReason;
  disposition: "pending" | "rearm" | "discard_duplicate" | "dropped";
}

interface PendingEvent {
  identity: string;
  type: AttentionEventType;
  symbol: string;
  episodeId: string;
  createdAt: number;
  qualifyingRow: AttentionA3FrameRow;
  qualifyingMap?: MarketMapSnapshot;
  keyLevel?: { level: MarketMapLevel; eventType: KeyLevelEventType };
}

interface SymbolEventMemory {
  previousPoint: AttentionHistoryPoint | null;
  accelerationRun: number;
  lastAccelerationAt: number | null;
  levelSide: Record<string, number>;
  levelLastNonzero: Record<string, number>;
  levelBrokenSide: Record<string, number>;
}

interface EventGuards { backfill: boolean; halt: boolean; mode: boolean; opening: boolean }

function acceptableQuality(row: AttentionA3FrameRow): boolean {
  return row.point.dataQualityState === "ok" || row.point.dataQualityState === "limited_history";
}

function nearestReference(map: MarketMapSnapshot | undefined): MarketMapReference | null {
  if (!map) return null;
  return [map.nearestUpside, map.nearestDownside]
    .filter((value): value is MarketMapReference => value !== null)
    .sort((a, b) => (a.distanceAtr ?? Infinity) - (b.distanceAtr ?? Infinity))[0] ?? null;
}

function side(price: number, level: number, tolerance: number): number {
  return price > level + tolerance ? 1 : price < level - tolerance ? -1 : 0;
}

/** I6/I7 are replay-failing alert invariants, separate from legitimate state occupancy memory. */
export function assertAttentionEventInvariants(
  event: AttentionEvent,
  calibrationStore: FeedAwareAttentionThresholdStore,
): void {
  if (event.at !== event.qualifiedAt || event.payload.at !== event.qualifiedAt || event.emittedAt < event.qualifiedAt) {
    throw new Error(`I7 ALERT PAYLOAD SNAPSHOT violated by ${event.symbol}: payload/alert time is not the qualifying minute.`);
  }
  if (event.payload.symbol !== event.symbol || event.payload.episodeId !== event.episodeId) {
    throw new Error(`I7 ALERT PAYLOAD SNAPSHOT violated by ${event.symbol}: payload identity differs from the qualifying edge.`);
  }
  const set = calibrationSetForScore(calibrationStore, event.payload.subWindow, event.payload.feedMode);
  if (set.calibrationId !== event.payload.calibrationId) {
    throw new Error(`I7 ALERT PAYLOAD SNAPSHOT violated by ${event.symbol}: qualifying calibration identity changed.`);
  }
  if (event.type !== "NOW_IN_PLAY") return;
  const enter = thresholdValuesForReplay(set).values.inPlayEnterCore;
  if (Math.abs(event.payload.inPlayEnterThreshold - enter) > 1e-12 || event.payload.core + 1e-12 < enter) {
    throw new Error(`I6 ALERT PAYLOAD CONSISTENCY violated by ${event.symbol}: core=${event.payload.core.toFixed(6)}, IN_PLAY_enter=${enter.toFixed(6)}.`);
  }
}

export class AttentionEventEngine {
  private readonly alerts: AttentionEvent[] = [];
  private readonly suppressions: AttentionSuppressionLog[] = [];
  private readonly pending = new Map<string, PendingEvent>();
  private readonly emitted = new Set<string>();
  private readonly symbols = new Map<string, SymbolEventMemory>();

  constructor(
    private readonly calibrationStore: FeedAwareAttentionThresholdStore,
    private readonly config: AttentionEventConfig = DEFAULT_ATTENTION_EVENT_CONFIG,
  ) {
    if (config.accelerationPersistenceMinutes < 1 || config.accelerationCooldownMinutes < 0 ||
        config.keyLevelProximityAtr <= 0 || config.openingProtectionMinutes < 0 ||
        config.pendingAlertMaxAgeMinutes < 0 ||
        config.earlyCloseClosingAuctionExclusionMinutes < 0) {
      throw new Error("Attention event configuration is invalid.");
    }
  }

  snapshot() {
    return {
      alerts: structuredClone(this.alerts),
      suppressions: structuredClone(this.suppressions),
      pending: [...this.pending.values()].map((value) => structuredClone(value)),
    };
  }

  /** Complete durable state; unlike snapshot(), this also retains dedupe and confluence memory. */
  checkpoint() {
    return {
      schemaVersion: 1 as const,
      alerts: structuredClone(this.alerts),
      suppressions: structuredClone(this.suppressions),
      pending: [...this.pending.entries()].map(([key, value]) => [key, structuredClone(value)] as const),
      emitted: [...this.emitted].sort(),
      symbols: [...this.symbols.entries()].map(([key, value]) => [key, structuredClone(value)] as const),
    };
  }

  restoreCheckpoint(checkpoint: ReturnType<AttentionEventEngine["checkpoint"]>): void {
    if (!checkpoint || checkpoint.schemaVersion !== 1) throw new Error("Unsupported Attention event checkpoint.");
    this.alerts.splice(0, this.alerts.length, ...structuredClone(checkpoint.alerts));
    this.suppressions.splice(0, this.suppressions.length, ...structuredClone(checkpoint.suppressions));
    this.pending.clear();
    for (const [key, value] of checkpoint.pending) this.pending.set(key, structuredClone(value));
    this.emitted.clear();
    for (const identity of checkpoint.emitted) this.emitted.add(identity);
    this.symbols.clear();
    for (const [key, value] of checkpoint.symbols) this.symbols.set(key, structuredClone(value));
  }

  processFrame(input: {
    frame: AttentionA3Frame;
    marketMaps?: Readonly<Record<string, MarketMapSnapshot>>;
    regularOpenAt: number;
    sessionCloseAt: number;
    earlyClose?: boolean;
    backfillGuard?: boolean;
    haltResumeGuard?: boolean;
  }): { emitted: AttentionEvent[]; suppressions: AttentionSuppressionLog[] } {
    if (!this.config.alertEmissionEnabled) return { emitted: [], suppressions: [] };
    const emittedBefore = this.alerts.length;
    const suppressedBefore = this.suppressions.length;

    for (const row of input.frame.rows) {
      const episode = row.episode;
      if (!episode || episode.state === "completed") continue;
      const memory = this.symbols.get(row.symbol) ?? {
        previousPoint: null,
        accelerationRun: 0,
        lastAccelerationAt: null,
        levelSide: {},
        levelLastNonzero: {},
        levelBrokenSide: {},
      };
      const map = input.marketMaps?.[row.symbol];
      const opening = row.point.at >= input.regularOpenAt &&
        row.point.at < input.regularOpenAt + this.config.openingProtectionMinutes * 60_000;
      const guards: EventGuards = {
        backfill: input.backfillGuard ?? false,
        halt: input.haltResumeGuard ?? false,
        mode: row.velocity.velocityEventsSuppressed,
        opening,
      };

      const entryIdentity = `NOW_IN_PLAY|${episode.episodeId}`;
      if (row.transition?.to === "IN_PLAY" && row.transition.from !== "IN_PLAY") {
        if (this.emitted.has(entryIdentity)) {
          this.log(row, entryIdentity, "NOW_IN_PLAY", "episode_already_alerted", "discard_duplicate");
        } else if (!this.pending.has(entryIdentity)) {
          this.pending.set(entryIdentity, this.capturePending(entryIdentity, "NOW_IN_PLAY", row, map));
        }
      }
      const pendingEntry = this.pending.get(entryIdentity);
      const entryEvent = pendingEntry && row.state === "IN_PLAY" && !this.emitted.has(entryIdentity)
        ? this.tryEmit(pendingEntry, row, guards, input.sessionCloseAt, input.earlyClose ?? false)
        : null;

      const prior = memory.previousPoint;
      const participationDelta = prior && row.point.participationInput !== null && prior.participationInput !== null
        ? row.point.participationInput - prior.participationInput
        : null;
      const displacementDelta = prior && row.point.displacementZ !== null && prior.displacementZ !== null
        ? row.point.displacementZ - prior.displacementZ
        : null;
      const accelerationConfluence = row.point.feedMode !== "iex_partial" &&
        participationDelta !== null && displacementDelta !== null &&
        participationDelta >= this.config.accelerationParticipationDelta &&
        displacementDelta >= this.config.accelerationDisplacementDelta &&
        (row.point.idiosyncrasyZ ?? 0) >= 0;
      memory.accelerationRun = accelerationConfluence ? memory.accelerationRun + 1 : 0;

      if (row.state === "IN_PLAY" && accelerationConfluence) {
        const identity = `ACCELERATION|${episode.episodeId}|${Math.floor(row.point.at / (this.config.accelerationCooldownMinutes * 60_000 || 60_000))}`;
        if (entryEvent && entryEvent.emittedAt === row.point.at) {
          this.log(row, identity, "ACCELERATION", "redundant_with_entry", "discard_duplicate");
        } else if (memory.accelerationRun < this.config.accelerationPersistenceMinutes) {
          this.log(row, identity, "ACCELERATION", "insufficient_persistence", "pending");
        } else if (memory.lastAccelerationAt !== null &&
                   row.point.at - memory.lastAccelerationAt < this.config.accelerationCooldownMinutes * 60_000) {
          this.log(row, identity, "ACCELERATION", "cooldown_active", "rearm");
        } else {
          const pending = this.capturePending(identity, "ACCELERATION", row, map);
          this.pending.set(identity, pending);
          const event = this.tryEmit(pending, row, guards, input.sessionCloseAt, input.earlyClose ?? false);
          if (event) memory.lastAccelerationAt = row.point.at;
        }
      }

      if (this.config.emitFailedAcceleration && row.cooling.classification === "ACCELERATION_FAILED") {
        const identity = `FAILED_ACCELERATION|${episode.episodeId}`;
        if (!this.emitted.has(identity)) {
          const pending = this.capturePending(identity, "FAILED_ACCELERATION", row, map);
          this.pending.set(identity, pending);
          this.tryEmit(pending, row, guards, input.sessionCloseAt, input.earlyClose ?? false);
        }
      }
      if (map && row.state === "IN_PLAY" && episode.firstInPlayAt !== null) {
        this.evaluateLevels(row, map, memory, guards, input.sessionCloseAt, input.earlyClose ?? false);
      }
      memory.previousPoint = row.point;
      this.symbols.set(row.symbol, memory);
    }

    return {
      emitted: this.alerts.slice(emittedBefore),
      suppressions: this.suppressions.slice(suppressedBefore),
    };
  }

  private capturePending(
    identity: string,
    type: AttentionEventType,
    row: AttentionA3FrameRow,
    map: MarketMapSnapshot | undefined,
    keyLevel?: { level: MarketMapLevel; eventType: KeyLevelEventType },
  ): PendingEvent {
    return {
      identity,
      type,
      symbol: row.symbol,
      episodeId: row.episode!.episodeId,
      createdAt: row.point.at,
      qualifyingRow: structuredClone(row),
      ...(map ? { qualifyingMap: structuredClone(map) } : {}),
      ...(keyLevel ? { keyLevel: structuredClone(keyLevel) } : {}),
    };
  }

  private evaluateLevels(
    row: AttentionA3FrameRow,
    map: MarketMapSnapshot,
    memory: SymbolEventMemory,
    guards: EventGuards,
    sessionCloseAt: number,
    earlyClose: boolean,
  ): void {
    const episode = row.episode!;
    const allowed = new Set(["HOD", "LOD", "PMH", "PML", "PDH", "PDL", "ORH", "ORL", "VWAP", "SWING_HIGH", "SWING_LOW"]);
    const levels = map.levels
      .filter((level) => allowed.has(level.kind) && level.relevance.score >= this.config.keyLevelMinimumRelevance)
      .sort((a, b) => Math.abs(a.price - row.point.price) - Math.abs(b.price - row.point.price) || b.relevance.score - a.relevance.score)
      .slice(0, 1);

    for (const level of levels) {
      const logicalLevelId = ["HOD", "LOD", "VWAP"].includes(level.kind)
        ? `${map.tradingDate}:${level.kind}`
        : level.id;
      const tolerance = (row.point.atr || 1) * this.config.keyLevelProximityAtr;
      const current = side(row.point.price, level.price, tolerance);
      const previous = memory.levelSide[logicalLevelId];
      const last = memory.levelLastNonzero[logicalLevelId];
      const broken = memory.levelBrokenSide[logicalLevelId];
      memory.levelSide[logicalLevelId] = current;
      if (current !== 0) memory.levelLastNonzero[logicalLevelId] = current;
      if (previous === undefined) continue;
      let eventType: KeyLevelEventType | null = null;
      if (previous !== 0 && current !== 0 && previous !== current) {
        if (broken !== undefined && current !== broken) {
          eventType = "failed_break";
          delete memory.levelBrokenSide[logicalLevelId];
        } else {
          eventType = "break";
          memory.levelBrokenSide[logicalLevelId] = current;
        }
      } else if (previous !== 0 && current === 0) {
        eventType = broken === previous ? "retest" : "approach";
      } else if (previous === 0 && current !== 0) {
        if (broken !== undefined) {
          if (current === broken) eventType = "retest";
          else {
            eventType = "failed_break";
            delete memory.levelBrokenSide[logicalLevelId];
          }
        } else if (last !== undefined) {
          eventType = current === last ? "rejection" : "reclaim";
        }
      }
      if (!eventType) continue;
      const identity = `KEY_LEVEL_EVENT|${episode.episodeId}|${logicalLevelId}|${eventType}`;
      if (this.emitted.has(identity)) {
        this.log(row, identity, "KEY_LEVEL_EVENT", "same_level_state", "discard_duplicate");
        continue;
      }
      const keyLevel = { level: { ...level, id: logicalLevelId }, eventType };
      const pending = this.capturePending(identity, "KEY_LEVEL_EVENT", row, map, keyLevel);
      this.pending.set(identity, pending);
      this.tryEmit(pending, row, guards, sessionCloseAt, earlyClose);
    }
  }

  private suppressionReason(pending: PendingEvent, row: AttentionA3FrameRow, guards: EventGuards): AttentionSuppressionReason | null {
    if (!acceptableQuality(row)) return "data_suspect";
    if (guards.backfill) return "backfill_guard";
    if (guards.halt) return "halt_resume_guard";
    if (guards.mode) return "not_material_change";
    if (pending.type !== "NOW_IN_PLAY" && row.freshness?.freshness === "Extended") return "extended";
    if (guards.opening && (row.point.displacementZ ?? -Infinity) < this.config.openingMinimumDisplacementZ) {
      return "opening_noise_guard";
    }
    return null;
  }

  private tryEmit(
    pending: PendingEvent,
    emissionRow: AttentionA3FrameRow,
    guards: EventGuards,
    sessionCloseAt: number,
    earlyClose: boolean,
  ): AttentionEvent | null {
    if (emissionRow.point.at >= sessionCloseAt) {
      this.log(emissionRow, pending.identity, pending.type, "session_closed", "dropped");
      this.pending.delete(pending.identity);
      return null;
    }
    if (earlyClose &&
        emissionRow.point.at >= sessionCloseAt - this.config.earlyCloseClosingAuctionExclusionMinutes * 60_000) {
      this.log(emissionRow, pending.identity, pending.type, "early_close_baseline_unavailable", "dropped");
      this.pending.delete(pending.identity);
      return null;
    }
    if (emissionRow.point.at - pending.createdAt > this.config.pendingAlertMaxAgeMinutes * 60_000) {
      this.log(emissionRow, pending.identity, pending.type, "pending_expired", "dropped");
      this.pending.delete(pending.identity);
      return null;
    }
    const reason = this.suppressionReason(pending, emissionRow, guards);
    if (reason) {
      this.log(emissionRow, pending.identity, pending.type, reason, "pending");
      return null;
    }
    if (this.emitted.has(pending.identity)) {
      this.pending.delete(pending.identity);
      return null;
    }
    const qualifiedAt = pending.createdAt;
    const emittedAt = emissionRow.point.at;
    const event: AttentionEvent = {
      eventId: `c:${pending.identity}:${qualifiedAt}:${emittedAt}`,
      type: pending.type,
      symbol: pending.symbol,
      at: qualifiedAt,
      qualifiedAt,
      emittedAt,
      episodeId: pending.episodeId,
      payload: this.payload(pending.qualifyingRow, pending.qualifyingMap, pending.keyLevel),
    };
    assertAttentionEventInvariants(event, this.calibrationStore);
    this.alerts.push(event);
    this.emitted.add(pending.identity);
    this.pending.delete(pending.identity);
    return event;
  }

  private payload(
    row: AttentionA3FrameRow,
    map: MarketMapSnapshot | undefined,
    key?: { level: MarketMapLevel; eventType: KeyLevelEventType },
  ): AttentionEventPayload {
    const set = calibrationSetForScore(this.calibrationStore, row.point.subWindow, row.point.feedMode);
    const thresholds = thresholdValuesForReplay(set).values;
    const curves = set.normalization;
    const participationCurve = row.point.participationInputKind === "surprise_bits"
      ? curves.participationPresence
      : curves.participationDense;
    const contribution = (
      value: number | null,
      kind: "z" | "surprise_bits",
      curve: { z50: number; k: number },
      role: AxisEventContribution["scoringRole"],
    ): AxisEventContribution => ({
      input: value,
      inputKind: kind,
      normalized: value === null ? null : normalizeAttentionAxis(value, curve),
      scoringRole: role,
    });
    const reference = nearestReference(map);
    return {
      episodeId: row.episode!.episodeId,
      symbol: row.symbol,
      at: row.point.at,
      attentionScore: row.point.score,
      core: row.coreSmoothed,
      rawCore: row.point.core,
      inPlayEnterThreshold: thresholds.inPlayEnterCore,
      feedMode: row.point.feedMode,
      subWindow: row.point.subWindow,
      calibrationId: row.point.calibrationId,
      axes: {
        participation: contribution(
          row.point.participationInput,
          row.point.participationInputKind,
          participationCurve,
          row.point.feedMode === "sip" ? "core" : "display_only",
        ),
        displacement: contribution(row.point.displacementZ, "z", curves.displacement, "core"),
        idiosyncrasy: contribution(
          row.point.idiosyncrasyZ,
          "z",
          curves.idiosyncrasy,
          row.point.feedMode === "sip" ? "modifier" : "core",
        ),
      },
      freshness: row.freshness?.freshness ?? "n/a",
      freshnessDetail: row.freshness ? {
        minutesSinceEpisodeStart: row.freshness.minutesSinceEpisodeStart,
        atrTravelledSinceEpisodeStart: row.freshness.atrTravelledSinceStart,
        distanceFromVwapAtr: row.freshness.distanceFromVwapAtr,
        distanceFromEma9Atr: row.freshness.distanceFromEma9Atr,
        consecutiveExpansionBars: row.freshness.consecutiveExpansionBars,
        pullbackObserved: row.freshness.pullbackObserved,
        reasons: [...row.freshness.reasons],
      } : null,
      contextBadges: row.freshness ? [
        ...(row.freshness.distanceFromVwapAtr === null ? [] : [{
          kind: "vwap_distance" as const,
          label: `${row.freshness.distanceFromVwapAtr.toFixed(1)} ATR from VWAP`,
          value: row.freshness.distanceFromVwapAtr,
          unit: "atr" as const,
        }]),
        ...(row.freshness.consecutiveExpansionBars <= 0 ? [] : [{
          kind: "expansion_run" as const,
          label: `${row.freshness.consecutiveExpansionBars} expansion bars`,
          value: row.freshness.consecutiveExpansionBars,
          unit: "bars" as const,
        }]),
      ] : [],
      atrTravelledSinceEpisodeStart: row.freshness?.atrTravelledSinceStart ?? null,
      nearestReference: reference,
      dataQualityBadge: row.point.dataQualityState,
      feedModeBadge: row.point.feedMode === "sip" ? "SIP" : "IEX PARTIAL",
      notice: "NOT AN ENTRY \u2014 open the chart.",
      extensionWarning: row.freshness?.freshness === "Extended"
        ? "EXTENDED \u2014 do not chase"
        : null,
      ...(key ? {
        keyLevel: {
          levelId: key.level.id,
          kind: key.level.kind,
          eventType: key.eventType,
          distanceAtr: row.point.atr > 0 ? Math.abs(row.point.price - key.level.price) / row.point.atr : null,
        },
      } : {}),
    };
  }

  private log(
    row: AttentionA3FrameRow,
    identity: string,
    type: AttentionEventType,
    reason: AttentionSuppressionReason,
    disposition: AttentionSuppressionLog["disposition"],
  ): void {
    const prior = this.suppressions.at(-1);
    if (prior && prior.at === row.point.at && prior.eventIdentity === identity && prior.reason === reason) return;
    this.suppressions.push({
      at: row.point.at,
      symbol: row.symbol,
      episodeId: row.episode!.episodeId,
      eventType: type,
      eventIdentity: identity,
      reason,
      disposition,
    });
  }
}