import { describe, expect, it } from "vitest";
import { ATTENTION_UNIVERSE } from "@/lib/attention/universe";
import { buildClusterDisplay } from "@/lib/attention/universePolicy";

interface ReplayRow {
  symbol: string;
  rank: number;
  state: "watching" | "emerging";
  eventIds: string[];
  logId: string;
}

const replayFrame = (): ReplayRow[] => [
  { symbol: "SMCI", rank: 1, state: "emerging", eventIds: ["smci-event"], logId: "smci-log" },
  { symbol: "DELL", rank: 2, state: "watching", eventIds: ["dell-event"], logId: "dell-log" },
  { symbol: "NBIS", rank: 3, state: "emerging", eventIds: ["nbis-event"], logId: "nbis-log" },
  { symbol: "CRWV", rank: 4, state: "watching", eventIds: ["crwv-event"], logId: "crwv-log" },
  { symbol: "AAOI", rank: 5, state: "emerging", eventIds: ["aaoi-event"], logId: "aaoi-log" },
];

describe("ai_infra display-cap replay after WAKING UP retirement", () => {
  it("collapses five ranked names to three plus '+2 more' without touching engine rows", () => {
    const frame = replayFrame();
    const display = buildClusterDisplay(frame, ATTENTION_UNIVERSE, 3);
    expect(display.engineRows).toBe(frame);
    expect(display.engineRows.map((row) => row.symbol)).toEqual(["SMCI", "DELL", "NBIS", "CRWV", "AAOI"]);
    expect(display.visibleRows.map((row) => row.symbol)).toEqual(["SMCI", "DELL", "NBIS"]);
    expect(display.overflow).toContainEqual({ cluster: "ai_infra", hiddenCount: 2, hiddenSymbols: ["CRWV", "AAOI"], label: "+2 more in ai_infra" });
    expect(display.engineRows.flatMap((row) => row.eventIds)).toHaveLength(5);
    expect(display.engineRows.map((row) => row.logId)).toHaveLength(5);
  });

  it("does not promote a hidden member through the retired WAKING UP override", () => {
    const display = buildClusterDisplay(replayFrame(), ATTENTION_UNIVERSE, 3);
    expect(display.visibleRows.map((row) => row.symbol)).toEqual(["SMCI", "DELL", "NBIS"]);
    expect(display.overflow[0].hiddenSymbols).toEqual(["CRWV", "AAOI"]);
  });
});