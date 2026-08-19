import type {
  AttentionA3Frame,
  AttentionA3FrameRow,
} from "@/lib/attention/attentionA3Replay";

export interface DigestSession {
  tradingDate: string;
  split: "train" | "holdout";
  primaryRegime: string;
  tags: string[];
  earlyClose: boolean;
}

interface EpisodeDigest {
  episodeId: string;
  symbol: string;
  startedAt: number;
  peakAttention: number;
  peakRank: number;
  lastActiveAt: number;
  reachedInPlay: boolean;
  inPlayMinutes: Set<number>;
}

interface SnapshotDigest {
  minute: number;
  inPlay: AttentionA3FrameRow[];
  inPlayOverflow: string[];
}

interface ClusterEvent {
  minute: number;
  list: "IN PLAY";
  detail: string;
}

const SNAPSHOT_MINUTES = [585, 615, 660, 780, 870] as const;

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function timestamp(at: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

function displayRow(row: AttentionA3FrameRow): string {
  const velocity = row.velocity.scoreVelocityPerMinute;
  return `| ${row.symbol} | ${row.point.score.toFixed(1)} | ${velocity === null ? "n/a" : velocity.toFixed(2)} | ${row.state} | ${row.freshness?.freshness ?? "n/a"} | ${row.freshness?.atrTravelledSinceStart.toFixed(2) ?? "n/a"} |`;
}

function ranges(minutes: readonly number[]): string[] {
  if (minutes.length === 0) return [];
  const sorted = [...new Set(minutes)].sort((a, b) => a - b);
  const result: string[] = [];
  let start = sorted[0];
  let end = start;
  for (const minute of sorted.slice(1)) {
    if (minute === end + 1) {
      end = minute;
      continue;
    }
    result.push(`${clock(start)}–${clock(end + 1)} ET`);
    start = minute;
    end = minute;
  }
  result.push(`${clock(start)}–${clock(end + 1)} ET`);
  return result;
}

export class SipSessionDigestCollector {
  private readonly sessions = new Map<
    string,
    {
      session: DigestSession;
      snapshots: Map<number, SnapshotDigest>;
      episodes: Map<string, EpisodeDigest>;
      emergingSymbols: Set<string>;
      inPlaySymbols: Set<string>;
      quietMinutes: number[];
      clusterEvents: ClusterEvent[];
      lastClusterSignature: string;
    }
  >();

  constructor(private readonly selectedDates: ReadonlySet<string>) {}

  observe(
    session: DigestSession,
    minute: number,
    frame: AttentionA3Frame,
  ): void {
    if (!this.selectedDates.has(session.tradingDate)) return;
    const state = this.sessions.get(session.tradingDate) ?? {
      session,
      snapshots: new Map<number, SnapshotDigest>(),
      episodes: new Map<string, EpisodeDigest>(),
      emergingSymbols: new Set<string>(),
      inPlaySymbols: new Set<string>(),
      quietMinutes: [],
      clusterEvents: [],
      lastClusterSignature: "",
    };
    this.sessions.set(session.tradingDate, state);

    if (minute >= 570 && minute < (session.earlyClose ? 780 : 960)) {
      if (frame.lists.inPlay.length === 0) state.quietMinutes.push(minute);
    }

    for (const row of frame.rows) {
      if (row.state === "EMERGING") state.emergingSymbols.add(row.symbol);
      if (row.state === "IN_PLAY") state.inPlaySymbols.add(row.symbol);
      if (!row.episode) continue;
      const existing = state.episodes.get(row.episode.episodeId);
      const episodeActive = row.episode.state !== "completed";
      const inPlayMinutes = existing?.inPlayMinutes ?? new Set<number>();
      if (row.state === "IN_PLAY") inPlayMinutes.add(row.point.at);
      state.episodes.set(row.episode.episodeId, {
        episodeId: row.episode.episodeId,
        symbol: row.symbol,
        startedAt: row.episode.startedAt,
        peakAttention: episodeActive
          ? Math.max(
              existing?.peakAttention ?? 0,
              row.episode.peakAttention,
              row.point.score,
            )
          : (existing?.peakAttention ?? row.episode.peakAttention),
        peakRank: episodeActive
          ? Math.min(
              existing?.peakRank ?? Number.POSITIVE_INFINITY,
              row.point.rank,
            )
          : (existing?.peakRank ?? row.point.rank),
        lastActiveAt: episodeActive
          ? row.point.at
          : (existing?.lastActiveAt ?? row.point.at),
        reachedInPlay:
          (existing?.reachedInPlay ?? false) || row.state === "IN_PLAY",
        inPlayMinutes,
      });
    }

    if ((SNAPSHOT_MINUTES as readonly number[]).includes(minute)) {
      const rowBySymbol = new Map(frame.rows.map((row) => [row.symbol, row]));
      state.snapshots.set(minute, {
        minute,
        inPlay: frame.lists.inPlay
          .slice(0, 10)
          .map((row) => rowBySymbol.get(row.symbol)!),
        inPlayOverflow: [
          ...frame.lists.inPlayDisplay.overflow.map((row) => row.label),
          ...(frame.lists.inPlayDisplay.globalOverflow
            ? [frame.lists.inPlayDisplay.globalOverflow.label]
            : []),
        ],
      });
    }

    this.captureClusterEvent(
      state,
      minute,
      "IN PLAY",
      frame.lists.inPlayDisplay,
    );
  }

  private captureClusterEvent(
    state: {
      clusterEvents: ClusterEvent[];
      lastClusterSignature: string;
    },
    minute: number,
    list: "IN PLAY",
    display: AttentionA3Frame["lists"]["inPlayDisplay"],
  ): void {
    const parts = [
      ...display.overflow.map((row) => row.label),
      ...(display.globalOverflow ? [display.globalOverflow.label] : []),
    ];
    const signature = parts.join("; ");
    if (signature === state.lastClusterSignature) return;
    state.lastClusterSignature = signature;
    if (signature)
      state.clusterEvents.push({ minute, list, detail: signature });
  }

  reachedInPlayEpisodes(): Array<{
    tradingDate: string;
    episodeId: string;
    symbol: string;
    startedAt: number;
    peakAttention: number;
    peakRank: number;
    episodeLifetimeMinutes: number;
    inPlayOccupancyMinutes: number;
  }> {
    return [...this.sessions.entries()].flatMap(([tradingDate, state]) =>
      [...state.episodes.values()]
        .filter((episode) => episode.reachedInPlay)
        .map((episode) => ({
          tradingDate,
          episodeId: episode.episodeId,
          symbol: episode.symbol,
          startedAt: episode.startedAt,
          peakAttention: episode.peakAttention,
          peakRank: episode.peakRank,
          episodeLifetimeMinutes: Math.max(
            1,
            Math.floor((episode.lastActiveAt - episode.startedAt) / 60_000) + 1,
          ),
          inPlayOccupancyMinutes: episode.inPlayMinutes.size,
        })),
    );
  }

  markdown(): string {
    const lines = [
      "# Attention Engine — five-session human-readable digest",
      "",
      "> This is a description of what the replay engine did. It is not a performance, hit-rate, latency, move-capture, discovery-quality, or correctness evaluation.",
      "",
      "> Timing statistics derived from historical pulls assume instantaneous bar availability. Real arrival latency is not represented. Human-relative latency and move-capture figures are therefore OPTIMISTICALLY BIASED and must not be used to justify lowering thresholds.",
      "",
      "Feed: `sip`. IN PLAY rows are ordered by attention score. Attention velocity is displayed as context; state is membership metadata.",
      "Reached-IN-PLAY episode tables cover all sub-windows. Quiet-stretch sections cover the regular session only.",
      "Episode lifetime measures the active/cooling episode span; IN PLAY occupancy counts only minutes whose state was IN_PLAY. Completed episodes do not continue accruing lifetime.",
      "",
    ];
    for (const date of [...this.selectedDates]) {
      const state = this.sessions.get(date);
      if (!state) {
        lines.push(`## ${date}`, "", "No scoreable SIP replay frames.", "");
        continue;
      }
      lines.push(
        `## ${date} — ${state.session.primaryRegime}`,
        "",
        `Split: ${state.session.split}. Tags: ${state.session.tags.join(", ")}. Early close: ${state.session.earlyClose ? "yes" : "no"}.`,
        "",
        "### Scheduled snapshots",
        "",
      );
      for (const minute of SNAPSHOT_MINUTES) {
        const snapshot = state.snapshots.get(minute);
        lines.push(`#### ${clock(minute)} ET`, "");
        if (!snapshot) {
          lines.push(
            state.session.earlyClose && minute >= 780
              ? "Session closed; no regular-session snapshot."
              : "No scoreable frame at this minute.",
            "",
          );
          continue;
        }
        for (const [label, rows, overflow] of [
          ["IN PLAY", snapshot.inPlay, snapshot.inPlayOverflow],
        ] as const) {
          lines.push(`**${label}**`, "");
          if (rows.length === 0) {
            lines.push("None.", "");
          } else {
            lines.push(
              "| Symbol | Attention | Velocity/min | State | Freshness | ATR travelled |",
              "|---|---:|---:|---|---|---:|",
              ...rows.map(displayRow),
              ...(overflow.length
                ? ["", `Compaction: ${overflow.join("; ")}.`]
                : []),
              "",
            );
          }
        }
      }

      const inPlayEpisodes = [...state.episodes.values()]
        .filter((row) => row.reachedInPlay)
        .sort(
          (a, b) =>
            a.startedAt - b.startedAt || a.symbol.localeCompare(b.symbol),
        );
      lines.push(
        "### Reached IN PLAY at any point (all sub-windows)",
        "",
        "| Symbol | Episode start (back-dated) | Peak attention | Peak rank | Episode lifetime | IN PLAY occupancy |",
        "|---|---|---:|---:|---:|---:|",
        ...(inPlayEpisodes.length
          ? inPlayEpisodes.map(
              (row) =>
                `| ${row.symbol} | ${timestamp(row.startedAt)} ET | ${row.peakAttention.toFixed(1)} | ${row.peakRank} | ${Math.max(1, Math.floor((row.lastActiveAt - row.startedAt) / 60_000) + 1)} min | ${row.inPlayMinutes.size} min |`,
            )
          : ["| None | — | — | — | — |"]),
        "",
      );

      const emergingOnly = [...state.emergingSymbols]
        .filter((symbol) => !state.inPlaySymbols.has(symbol))
        .sort();
      lines.push(
        "### Reached EMERGING but never IN PLAY",
        "",
        emergingOnly.length ? emergingOnly.join(", ") : "None.",
        "",
        "### Quiet stretches — no names IN PLAY",
        "",
        ...(ranges(state.quietMinutes).length
          ? ranges(state.quietMinutes).map((range) => `- ${range}`)
          : ["None."]),
        "",
        "### Cluster compaction and override changes",
        "",
        ...(state.clusterEvents.length
          ? state.clusterEvents.map(
              (event) =>
                `- ${clock(event.minute)} ET · ${event.list}: ${event.detail}`,
            )
          : ["None."]),
        "",
      );
    }
    return `${lines.join("\n")}\n`;
  }
}
