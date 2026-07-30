// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { SetupDetail } from "@/components/dashboard/SetupDetail";
import { scoreSetup } from "@/lib/strategies/scorer";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import { makeCandle, risingSeries, flatSeries } from "@/lib/fixtures/candles";
import type { Candle } from "@/types/candle";
import type { SetupResult } from "@/types/setup";

afterEach(cleanup);

const NOW = "2026-07-30T15:14:00Z";

/** Runs the real scorer, so the asserted text is the string the app
 * genuinely produces — not a hand-written copy that could drift. */
function score(sessionCandles: Candle[]): SetupResult {
  return scoreSetup({
    symbol: "TEST",
    timeframe: "5m",
    sessionCandles,
    dailyCandles: flatSeries(25, 100),
    prevClose: 100,
    config: defaultStrategyConfig,
    now: NOW,
    quality: "realtime",
  });
}

/** Failing conditions live in the collapsed full checklist, so open it. */
function renderExpanded(result: SetupResult): HTMLElement {
  const { container } = render(
    <SetupDetail
      result={result}
      exchange="NASDAQ"
      timeframe="5m"
      onTimeframeChange={() => {}}
      scoreThreshold={6}
      score5m={result.score}
      score15m={result.score}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: /view full checklist/i }));

  // Scope every lookup to the full checklist. A PASSING condition also
  // appears in the summary above, so an unscoped query matches twice.
  const region = container.querySelector(`[id="full-checklist-${result.symbol}-${result.timeframe}"]`);
  expect(region).not.toBeNull();
  return region as HTMLElement;
}

/** The rendered detail text for a condition, by its checklist label. */
function detailTextFor(region: HTMLElement, label: RegExp): string {
  const labelNode = within(region).getByText(label);
  const row = labelNode.closest("li");
  expect(row).not.toBeNull();
  return row!.textContent ?? "";
}

// The MU 5m window from a live probe: three real candles, last one red.
const MU_STREAK_BROKEN: Candle[] = [
  makeCandle({ time: 0, open: 840.95, high: 850.91, low: 837.39, close: 850.49 }),
  makeCandle({ time: 300, open: 850.35, high: 852.88, low: 843.48, close: 851.52 }),
  makeCandle({ time: 600, open: 851.54, high: 851.95, low: 844.17, close: 848.27 }),
];

describe("checklist row text — consecutive bullish", () => {
  it("insufficient data renders honest wording, never a fabricated 0-candle claim", () => {
    const region = renderExpanded(score([makeCandle({ time: 0, open: 100, close: 101 })]));
    const text = detailTextFor(region, /consecutive bullish candles/i);

    expect(text).toMatch(/not enough candles yet to evaluate/i);
    expect(text).not.toMatch(/0-candle window/);
    expect(text).not.toMatch(/\$0\.00 total move/);
  });

  it("checked-and-failed renders the real window size and net move", () => {
    const region = renderExpanded(score(MU_STREAK_BROKEN));
    const text = detailTextFor(region, /consecutive bullish candles/i);

    expect(text).toMatch(/3-candle window/);
    expect(text).toMatch(/\+\$7\.32/);
    expect(text).toMatch(/streak broken/i);
    // The defect being guarded: this must not read as "nothing happened".
    expect(text).not.toMatch(/not enough candles/i);
    expect(text).not.toMatch(/0-candle window/);
  });

  it("the two failing cases render visibly different text", () => {
    const regionA = renderExpanded(score([makeCandle({ time: 0, open: 100, close: 101 })]));
    const insufficient = detailTextFor(regionA, /consecutive bullish candles/i);
    cleanup();

    const regionB = renderExpanded(score(MU_STREAK_BROKEN));
    const failed = detailTextFor(regionB, /consecutive bullish candles/i);

    expect(insufficient).not.toBe(failed);
  });

  it("a passing streak still renders its window and total move", () => {
    const region = renderExpanded(score(risingSeries(6, 100, 1)));
    const text = detailTextFor(region, /consecutive bullish candles/i);

    expect(text).toMatch(/3-candle window/);
    expect(text).toMatch(/total move/i);
    expect(text).not.toMatch(/streak broken/i);
    expect(text).not.toMatch(/not enough candles/i);
  });
});

describe("checklist row text — liquidity sweep", () => {
  it("insufficient data renders honest wording, not a bare 'no qualifying sweep'", () => {
    const region = renderExpanded(score([makeCandle({ time: 0, open: 100, close: 101 })]));
    const text = detailTextFor(region, /liquidity sweep/i);

    expect(text).toMatch(/not enough candles yet to evaluate/i);
  });

  it("checked-and-found-nothing names the level it actually watched", () => {
    // Rises throughout: never breaches the floor established at the start.
    const held = [
      makeCandle({ time: 0, open: 100, high: 100.3, low: 99.9, close: 100.1 }),
      makeCandle({ time: 300, open: 100.1, high: 100.5, low: 100.0, close: 100.4 }),
      makeCandle({ time: 600, open: 100.4, high: 100.8, low: 100.3, close: 100.7 }),
    ];
    const region = renderExpanded(score(held));
    const text = detailTextFor(region, /liquidity sweep/i);

    expect(text).toMatch(/held above \$99\.90/);
    expect(text).not.toMatch(/not enough candles/i);
  });

  it("distinguishes a failed attempt from one that never started", () => {
    const breached = [
      makeCandle({ time: 0, open: 100, high: 100.3, low: 99.9, close: 100.1 }),
      makeCandle({ time: 300, open: 100.1, high: 100.2, low: 97.0, close: 97.5 }),
      makeCandle({ time: 600, open: 97.5, high: 98.0, low: 96.5, close: 97.0 }),
      makeCandle({ time: 900, open: 97.0, high: 97.5, low: 96.0, close: 96.5 }),
    ];
    const region = renderExpanded(score(breached));
    const text = detailTextFor(region, /liquidity sweep/i);

    expect(text).toMatch(/dipped below/i);
    expect(text).toMatch(/never reclaimed/i);
    expect(text).not.toMatch(/held above/i);
    expect(text).not.toMatch(/not enough candles/i);
  });

  it("a passing sweep still names the swept level", () => {
    const swept = [
      makeCandle({ time: 0, open: 100, high: 100.3, low: 99.9, close: 100.1 }),
      makeCandle({ time: 300, open: 100.1, high: 100.4, low: 99.8, close: 100.2 }),
      makeCandle({ time: 600, open: 100.2, high: 100.5, low: 100.0, close: 100.3 }),
      makeCandle({ time: 900, open: 100.3, high: 100.6, low: 100.1, close: 100.4 }),
      makeCandle({ time: 1200, open: 100.4, high: 100.6, low: 100.2, close: 100.5 }),
      makeCandle({ time: 1500, open: 100.5, high: 100.6, low: 97.0, close: 98.0 }),
      makeCandle({ time: 1800, open: 98.0, high: 101, low: 97.8, close: 100.5 }),
    ];
    const region = renderExpanded(score(swept));
    const text = detailTextFor(region, /liquidity sweep/i);

    expect(text).toMatch(/swept/i);
    expect(text).toMatch(/\$\d+\.\d{2}/);
    expect(text).not.toMatch(/not enough candles/i);
  });
});
