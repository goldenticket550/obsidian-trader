import { createHash } from "node:crypto";
import type { RecordedSession } from "./types";

export interface ReplayRankedRow {
  symbol: string;
  score: number;
  state: string;
  episodeId: string;
}

export interface ReplayMinute {
  at: number;
  rows: ReplayRankedRow[];
  hash: string;
}

export type ReplayEvaluator = (args: {
  session: RecordedSession;
  at: number;
}) => ReplayRankedRow[];

export function hashRankedRows(rows: ReplayRankedRow[]): string {
  const canonical = [...rows]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map((row) => `${row.symbol}|${row.score.toFixed(4)}|${row.state}|${row.episodeId}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function replayMinuteByMinute(session: RecordedSession, evaluate: ReplayEvaluator): ReplayMinute[] {
  const times = [...new Set(
    Object.values(session.bars).flatMap((byTimeframe) => (byTimeframe["1m"] ?? []).map((bar) => bar.time))
  )].sort((a, b) => a - b);
  return times.map((at) => {
    const rows = evaluate({ session, at });
    return { at, rows, hash: hashRankedRows(rows) };
  });
}

export function hashSequence(minutes: ReplayMinute[]): string {
  return createHash("sha256").update(minutes.map((minute) => `${minute.at}:${minute.hash}`).join("\n")).digest("hex");
}
