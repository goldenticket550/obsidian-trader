import { describe, expect, it } from "vitest";
import { hashSequence, replayMinuteByMinute } from "@/lib/replay/deterministic";
import type { RecordedSession } from "@/lib/replay/types";

const session = (date: string, offset: number): RecordedSession => ({
  schemaVersion: 1, tradingDate: date, feed: "sip", adjustment: "split",
  source: "historical_pull", recordedAt: "2026-08-16T00:00:00.000Z",
  bars: {
    AAA: { "1m": [0, 1, 2].map((index) => ({ time: offset + index * 60, open: 10, high: 11, low: 9, close: 10 + index, volume: 100 + index })) },
    BBB: { "1m": [0, 1, 2].map((index) => ({ time: offset + index * 60, open: 20, high: 21, low: 19, close: 20 - index, volume: 200 + index })) },
  },
});

const evaluator = ({ session: replaySession, at }: { session: RecordedSession; at: number }) =>
  Object.entries(replaySession.bars).map(([symbol, series]) => {
    const bar = (series["1m"] ?? []).filter((candidate) => candidate.time <= at).at(-1)!;
    return { symbol, score: bar.close, state: bar.close >= 10 ? "watch" : "low", episodeId: `${replaySession.tradingDate}:${symbol}` };
  });

describe("deterministic per-minute replay hashes", () => {
  for (const fixture of [session("2026-08-13", 1_786_588_200), session("2026-08-14", 1_786_674_600)]) {
    it(`reproduces ${fixture.tradingDate}`, () => {
      const first = replayMinuteByMinute(fixture, evaluator);
      const second = replayMinuteByMinute(fixture, evaluator);
      expect(first.map((minute) => minute.hash)).toEqual(second.map((minute) => minute.hash));
      expect(hashSequence(first)).toBe(hashSequence(second));
    });
  }
});
