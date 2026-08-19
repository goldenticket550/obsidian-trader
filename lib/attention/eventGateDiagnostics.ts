import type { AttentionA3Frame, AttentionA3FrameRow } from "./attentionA3Replay";
import type { AttentionHistoryPoint } from "./attentionHistory";
import type { AttentionEventConfig, KeyLevelEventType } from "./attentionEvents";
import type { MarketMapSnapshot } from "./marketMap";

export interface GateCounts {
  totalSymbolMinutes: number;
  activeEpisode: number;
  inPlay: number;
  participationDeltaAvailable: number;
  participationDeltaPass: number;
  displacementDeltaAvailable: number;
  displacementDeltaPass: number;
  idiosyncrasyPass: number;
  confluencePass: number;
  persistencePass: number;
  qualityPass: number;
  modeGuardClear: number;
  extensionPass: number;
  openingProtectionPass: number;
}

export interface CumulativeAccelerationFunnel {
  activeEpisode: number;
  inPlay: number;
  participationDelta: number;
  displacementDelta: number;
  idiosyncrasy: number;
  persistence: number;
  quality: number;
  modeGuard: number;
  extension: number;
  openingProtection: number;
}

export interface KeyLevelGateCounts {
  eligibleSymbolMinutes: number;
  withMap: number;
  withAllowedLevel: number;
  withRelevantLevel: number;
  selectedLevel: number;
  semanticTransition: number;
  novelIdentity: number;
  allowedLevelObservations: number;
  relevantLevelObservations: number;
}

export interface EventGateDiagnosticsSnapshot {
  acceleration: {
    independent: GateCounts;
    cumulative: CumulativeAccelerationFunnel;
  };
  keyLevel: {
    funnel: KeyLevelGateCounts;
    allowedLevelRelevanceScores: number[];
  };
}

interface AccelerationMemory {
  previousPoint: AttentionHistoryPoint | null;
  run: number;
}

interface LevelMemory {
  side: Record<string, number>;
  lastNonzero: Record<string, number>;
  brokenSide: Record<string, number>;
  emitted: Set<string>;
}

const allowedLevelKinds = new Set([
  "HOD", "LOD", "PMH", "PML", "PDH", "PDL", "ORH", "ORL", "VWAP", "SWING_HIGH", "SWING_LOW",
]);

function acceptableQuality(row: AttentionA3FrameRow): boolean {
  return row.point.dataQualityState === "ok" || row.point.dataQualityState === "limited_history";
}

function side(price: number, level: number, tolerance: number): number {
  return price > level + tolerance ? 1 : price < level - tolerance ? -1 : 0;
}

/** Mirrors the Phase C gates without changing event state or thresholds. */
export class EventGateDiagnosticsCollector {
  private readonly accelerationMemory = new Map<string, AccelerationMemory>();
  private readonly levelMemory = new Map<string, LevelMemory>();
  private readonly independent: GateCounts = {
    totalSymbolMinutes: 0,
    activeEpisode: 0,
    inPlay: 0,
    participationDeltaAvailable: 0,
    participationDeltaPass: 0,
    displacementDeltaAvailable: 0,
    displacementDeltaPass: 0,
    idiosyncrasyPass: 0,
    confluencePass: 0,
    persistencePass: 0,
    qualityPass: 0,
    modeGuardClear: 0,
    extensionPass: 0,
    openingProtectionPass: 0,
  };
  private readonly cumulative: CumulativeAccelerationFunnel = {
    activeEpisode: 0,
    inPlay: 0,
    participationDelta: 0,
    displacementDelta: 0,
    idiosyncrasy: 0,
    persistence: 0,
    quality: 0,
    modeGuard: 0,
    extension: 0,
    openingProtection: 0,
  };
  private readonly keyFunnel: KeyLevelGateCounts = {
    eligibleSymbolMinutes: 0,
    withMap: 0,
    withAllowedLevel: 0,
    withRelevantLevel: 0,
    selectedLevel: 0,
    semanticTransition: 0,
    novelIdentity: 0,
    allowedLevelObservations: 0,
    relevantLevelObservations: 0,
  };
  private readonly relevanceScores: number[] = [];

  constructor(private readonly config: AttentionEventConfig) {}

  observeFrame(input: {
    frame: AttentionA3Frame;
    marketMaps: Readonly<Record<string, MarketMapSnapshot>>;
    regularOpenAt: number;
  }): void {
    for (const row of input.frame.rows) {
      this.independent.totalSymbolMinutes += 1;
      const episode = row.episode;
      if (!episode || episode.state === "completed") continue;
      this.independent.activeEpisode += 1;

      const memory = this.accelerationMemory.get(row.symbol) ?? { previousPoint: null, run: 0 };
      const prior = memory.previousPoint;
      const participationDelta = prior && row.point.participationInput !== null && prior.participationInput !== null
        ? row.point.participationInput - prior.participationInput
        : null;
      const displacementDelta = prior && row.point.displacementZ !== null && prior.displacementZ !== null
        ? row.point.displacementZ - prior.displacementZ
        : null;
      const participationPass = participationDelta !== null &&
        participationDelta >= this.config.accelerationParticipationDelta;
      const displacementPass = displacementDelta !== null &&
        displacementDelta >= this.config.accelerationDisplacementDelta;
      const idiosyncrasyPass = (row.point.idiosyncrasyZ ?? 0) >= 0;
      const confluence = participationPass && displacementPass && idiosyncrasyPass;
      memory.run = confluence ? memory.run + 1 : 0;
      const persistencePass = memory.run >= this.config.accelerationPersistenceMinutes;
      const qualityPass = acceptableQuality(row);
      const modePass = !row.velocity.velocityEventsSuppressed;
      const extensionPass = row.freshness?.freshness !== "Extended";
      const opening = row.point.at >= input.regularOpenAt &&
        row.point.at < input.regularOpenAt + this.config.openingProtectionMinutes * 60_000;
      const openingPass = !opening ||
        (row.point.displacementZ ?? Number.NEGATIVE_INFINITY) >= this.config.openingMinimumDisplacementZ;

      if (row.state === "IN_PLAY") this.independent.inPlay += 1;
      if (participationDelta !== null) this.independent.participationDeltaAvailable += 1;
      if (participationPass) this.independent.participationDeltaPass += 1;
      if (displacementDelta !== null) this.independent.displacementDeltaAvailable += 1;
      if (displacementPass) this.independent.displacementDeltaPass += 1;
      if (idiosyncrasyPass) this.independent.idiosyncrasyPass += 1;
      if (confluence) this.independent.confluencePass += 1;
      if (persistencePass) this.independent.persistencePass += 1;
      if (qualityPass) this.independent.qualityPass += 1;
      if (modePass) this.independent.modeGuardClear += 1;
      if (extensionPass) this.independent.extensionPass += 1;
      if (openingPass) this.independent.openingProtectionPass += 1;

      this.cumulative.activeEpisode += 1;
      if (row.state === "IN_PLAY") {
        this.cumulative.inPlay += 1;
        if (participationPass) {
          this.cumulative.participationDelta += 1;
          if (displacementPass) {
            this.cumulative.displacementDelta += 1;
            if (idiosyncrasyPass) {
              this.cumulative.idiosyncrasy += 1;
              if (persistencePass) {
                this.cumulative.persistence += 1;
                if (qualityPass) {
                  this.cumulative.quality += 1;
                  if (modePass) {
                    this.cumulative.modeGuard += 1;
                    if (extensionPass) {
                      this.cumulative.extension += 1;
                      if (openingPass) this.cumulative.openingProtection += 1;
                    }
                  }
                }
              }
            }
          }
        }
      }

      memory.previousPoint = row.point;
      this.accelerationMemory.set(row.symbol, memory);

      if (row.state === "IN_PLAY" && episode.firstInPlayAt !== null) {
        this.observeKeyLevels(row, input.marketMaps[row.symbol]);
      }
    }
  }

  snapshot(): EventGateDiagnosticsSnapshot {
    return {
      acceleration: {
        independent: structuredClone(this.independent),
        cumulative: structuredClone(this.cumulative),
      },
      keyLevel: {
        funnel: structuredClone(this.keyFunnel),
        allowedLevelRelevanceScores: [...this.relevanceScores],
      },
    };
  }

  private observeKeyLevels(row: AttentionA3FrameRow, map: MarketMapSnapshot | undefined): void {
    this.keyFunnel.eligibleSymbolMinutes += 1;
    if (!map) return;
    this.keyFunnel.withMap += 1;
    const allowed = map.levels.filter((level) => allowedLevelKinds.has(level.kind));
    if (!allowed.length) return;
    this.keyFunnel.withAllowedLevel += 1;
    this.keyFunnel.allowedLevelObservations += allowed.length;
    this.relevanceScores.push(...allowed.map((level) => level.relevance.score));
    const relevant = allowed.filter((level) => level.relevance.score >= this.config.keyLevelMinimumRelevance);
    this.keyFunnel.relevantLevelObservations += relevant.length;
    if (!relevant.length) return;
    this.keyFunnel.withRelevantLevel += 1;
    const level = [...relevant].sort(
      (a, b) => Math.abs(a.price - row.point.price) - Math.abs(b.price - row.point.price) ||
        b.relevance.score - a.relevance.score,
    )[0];
    this.keyFunnel.selectedLevel += 1;

    const memory = this.levelMemory.get(row.symbol) ?? {
      side: {},
      lastNonzero: {},
      brokenSide: {},
      emitted: new Set<string>(),
    };
    const logicalLevelId = ["HOD", "LOD", "VWAP"].includes(level.kind)
      ? map.tradingDate + ":" + level.kind
      : level.id;
    const tolerance = (row.point.atr || 1) * this.config.keyLevelProximityAtr;
    const current = side(row.point.price, level.price, tolerance);
    const previous = memory.side[logicalLevelId];
    const last = memory.lastNonzero[logicalLevelId];
    const broken = memory.brokenSide[logicalLevelId];
    memory.side[logicalLevelId] = current;
    if (current !== 0) memory.lastNonzero[logicalLevelId] = current;
    let eventType: KeyLevelEventType | null = null;
    if (previous !== undefined) {
      if (previous !== 0 && current !== 0 && previous !== current) {
        if (broken !== undefined && current !== broken) {
          eventType = "failed_break";
          delete memory.brokenSide[logicalLevelId];
        } else {
          eventType = "break";
          memory.brokenSide[logicalLevelId] = current;
        }
      } else if (previous !== 0 && current === 0) {
        eventType = broken === previous ? "retest" : "approach";
      } else if (previous === 0 && current !== 0) {
        if (broken !== undefined) {
          if (current === broken) eventType = "retest";
          else {
            eventType = "failed_break";
            delete memory.brokenSide[logicalLevelId];
          }
        } else if (last !== undefined) {
          eventType = current === last ? "rejection" : "reclaim";
        }
      }
    }
    if (eventType) {
      this.keyFunnel.semanticTransition += 1;
      const identity = "KEY_LEVEL_EVENT|" + row.episode!.episodeId + "|" + logicalLevelId + "|" + eventType;
      if (!memory.emitted.has(identity)) {
        this.keyFunnel.novelIdentity += 1;
        memory.emitted.add(identity);
      }
    }
    this.levelMemory.set(row.symbol, memory);
  }
}