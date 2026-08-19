// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LabelReviewPage from "@/app/labels/page";
import type { LabelCandidate } from "@/lib/replay/labelAssistant";
import type { LabelReview } from "@/lib/replay/labelStore";
import type { ArchiveLabelChartData } from "@/lib/replay/archiveLabelChart";

const epoch = Date.parse("2025-08-18T13:30:00Z") / 1000;

function candidate(index: number): LabelCandidate {
  return {
    id: `2025-08-18:S${index}`, tradingDate: "2025-08-18", symbol: `S${index}`, rank: index + 1,
    decision: "pending", selectionReasons: ["thirty_minute_travel"], rangeAtr: 1.5,
    maxWindowTravelAtr: 1.2, time_it_became_interesting: "09:31:00",
    time_i_actually_noticed: null, direction: index % 2 ? "bearish" : "bullish", reason_tags: ["range_expansion"],
    editedFields: [], sparkline: { times: [1, 2], prices: [100, 102], volumes: [10, 20] },
  };
}

const candidates = Array.from({ length: 20 }, (_, index) => candidate(index));
const review: LabelReview = { tradingDate: "2025-08-18", quietSession: null, reviewCompleted: false, candidates, labels: [] };
const chart: ArchiveLabelChartData = {
  source: "sip_split_archive", feed: "sip", adjustment: "split", tradingDate: "2025-08-18", symbol: "S0",
  bars: [
    { time: epoch, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    { time: epoch + 60, open: 100.5, high: 102, low: 100, close: 101.5, volume: 20 },
  ],
  vwap: [{ time: epoch, value: 100.2 }, { time: epoch + 60, value: 100.8 }],
  levels: [{ kind: "hod", label: "HOD", value: 102 }, { kind: "lod", label: "LOD", value: 99 }],
  markerTime: epoch + 60,
  regularSession: { firstBarTime: epoch, lastBarTime: epoch + 60 },
};

let patchCalls = 0;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  patchCalls = 0;
  scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("/api/labels/chart")) return { ok: true, json: async () => ({ chart }) };
    if (init?.method === "PATCH") { patchCalls += 1; return { ok: true, json: async () => ({ ok: true }) }; }
    if (init?.method === "POST") return { ok: true, json: async () => ({ ok: true }) };
    return { ok: true, json: async () => ({ review }) };
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("keyboard-only label review with archive chart", () => {
  it("expands and collapses the full chart with E without moving scroll or losing progress", async () => {
    render(<LabelReviewPage />);
    await screen.findByText("S0");
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(patchCalls).toBe(1));
    fireEvent.keyDown(window, { key: "ArrowUp" });
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    const scrollCallsBeforeExpand = scrollIntoView.mock.calls.length;
    fireEvent.keyDown(window, { key: "e" });
    expect(await screen.findByRole("img", { name: /S0 archived one-minute candlestick chart/ })).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledTimes(scrollCallsBeforeExpand);
    expect(screen.getAllByRole("button", { name: "Accept" })[0].className).toContain("border-signal-green");
    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(screen.queryByRole("img", { name: /S0 archived one-minute/ })).toBeNull());
  });

  it("focuses the missed-symbol workflow with N", async () => {
    render(<LabelReviewPage />);
    await screen.findByText("S0");
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByRole("textbox", { name: "Missed symbol" })).toBe(document.activeElement);
  });

  it("adjudicates a full 20-candidate session using only A/R keys", async () => {
    render(<LabelReviewPage />);
    await screen.findByText("S0");
    const started = performance.now();
    for (let index = 0; index < 20; index += 1) {
      await act(async () => { fireEvent.keyDown(window, { key: index % 2 === 0 ? "a" : "r" }); });
      await waitFor(() => expect(patchCalls).toBe(index + 1));
    }
    const elapsedMs = performance.now() - started;
    console.info(`[label-review-keyboard] 20 candidates adjudicated in ${elapsedMs.toFixed(1)} ms`);
    expect(screen.getByText("Pending").parentElement?.textContent).toContain("0");
    expect(elapsedMs).toBeLessThan(180_000);
  });
});
