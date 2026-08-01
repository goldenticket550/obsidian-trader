// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { RankedOpportunities } from "@/components/dashboard/RankedOpportunities";
import { ExpansionCandidatePanel } from "@/components/dashboard/ExpansionCandidatePanel";
import { scanWatchlistWithProvider, resetExpansionBaselineCache } from "@/lib/scanner/scanService";
import type { SymbolExpansion } from "@/lib/scanner/scanService";
import { EXPANSION_STAGE_PRIORITY } from "@/lib/scanner/expansionPriority";
import { stageLabel } from "@/lib/indicators/premarketExpansionDisplay";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { SetupResult } from "@/types/setup";
import type { WatchlistSymbol } from "@/types/watchlist";
import {
  FixtureProvider,
  standardFixtures,
  EXPANDING,
  ORDINARY,
  SCAN_NOW,
} from "./support/expansionScanFixture";

afterEach(cleanup);

/**
 * Display-only tests for the Premarket Expansion badge and detail panel.
 *
 * Every expansion fixture below is REAL `detectPremarketExpansion` output,
 * harvested by running the actual scan over synthetic candles — not a
 * hand-authored result object. A hand-written fixture would keep passing
 * after the detector's shape changed underneath it, which is exactly the
 * failure a display test is supposed to catch.
 */

let symbols: WatchlistSymbol[];
let resultsBySymbol: Record<string, { "5m": SetupResult; "15m": SetupResult }>;
let expansionBySymbol: Record<string, SymbolExpansion>;

beforeAll(async () => {
  resetExpansionBaselineCache();

  const fixtures = standardFixtures({
    // Bearish mirror of EXPANDING: falling hard, through the prior-day low.
    DROP: {
      priorShape: { open: 100, drift: -0.5, barRange: 0.25, volumePerBar: 1000 },
      todayShape: { open: 100, drift: -4, barRange: 1, volumePerBar: 4000 },
      dailyHigh: 102,
      dailyLow: 99,
      dailyClose: 100,
    },
    // Ordinary, but sitting a short way under the prior-day high, so the
    // bullish read develops further than the bearish one without either
    // qualifying.
    NEAR: { ...ORDINARY, dailyHigh: 50.5, dailyLow: 40, dailyClose: 50 },
  });

  const scan = await scanWatchlistWithProvider(
    [
      { symbol: "EXPD", exchange: "NASDAQ" },
      { symbol: "DROP", exchange: "NASDAQ" },
      { symbol: "CALM", exchange: "NASDAQ" },
      { symbol: "NEAR", exchange: "NASDAQ" },
    ],
    new FixtureProvider(fixtures),
    defaultStrategyConfig,
    SCAN_NOW
  );

  symbols = scan.watchlist;
  resultsBySymbol = scan.resultsBySymbol;
  expansionBySymbol = scan.expansionBySymbol!;
});

function renderRanked(expansion?: Record<string, SymbolExpansion>) {
  return render(
    <RankedOpportunities
      symbols={symbols}
      resultsBySymbol={resultsBySymbol}
      loading={false}
      scoreThreshold={6}
      expansionBySymbol={expansion}
    />
  );
}

/** The row container for a ticker, so a chip can be scoped to its own row. */
function rowFor(container: HTMLElement, ticker: string): HTMLElement {
  const cell = within(container).getByText(ticker);
  const row = cell.closest("[data-ticker]");
  if (!row) throw new Error(`no row found for ${ticker}`);
  return row as HTMLElement;
}

describe("the fixtures really are what these tests assume", () => {
  it("gives one bullish-qualifying, one bearish-qualifying and two unqualified symbols", () => {
    expect(expansionBySymbol.EXPD.bullish.qualified).toBe(true);
    expect(expansionBySymbol.EXPD.bearish.qualified).toBe(false);

    expect(expansionBySymbol.DROP.bearish.qualified).toBe(true);
    expect(expansionBySymbol.DROP.bullish.qualified).toBe(false);

    for (const direction of ["bullish", "bearish"] as const) {
      expect(expansionBySymbol.CALM[direction].qualified).toBe(false);
      expect(expansionBySymbol.NEAR[direction].qualified).toBe(false);
    }
  });
});

describe("expansion badge on the ranked row", () => {
  it("shows a chip with direction and stage on a qualifying symbol", () => {
    const { container } = renderRanked(expansionBySymbol);
    const chip = within(rowFor(container, "EXPD")).getByTestId("expansion-chip");

    expect(chip.textContent).toContain("Expansion");
    // Direction is conveyed by an arrow AND by accessible text, never by
    // colour alone.
    expect(chip.textContent).toContain("▲");
    expect(chip.getAttribute("aria-label")).toMatch(/bullish/i);
    expect(chip.textContent).toContain(
      // Whatever stage the real detector produced for this fixture.
      stageLabel(expansionBySymbol.EXPD.bullish.stage)
    );
  });

  it("shows a bearish chip when only the bearish direction qualifies", () => {
    const { container } = renderRanked(expansionBySymbol);
    const chip = within(rowFor(container, "DROP")).getByTestId("expansion-chip");

    expect(chip.textContent).toContain("▼");
    expect(chip.getAttribute("aria-label")).toMatch(/bearish/i);
  });

  it("shows no chip at all for a non-qualifying symbol — never a placeholder", () => {
    const { container } = renderRanked(expansionBySymbol);
    const calm = rowFor(container, "CALM");
    expect(within(calm).queryByTestId("expansion-chip")).toBeNull();
    expect(calm.textContent).not.toContain("Expansion");
  });

  it("shows no chip when the symbol has no expansion entry", () => {
    const { container } = renderRanked({ EXPD: expansionBySymbol.EXPD });
    expect(within(rowFor(container, "DROP")).queryByTestId("expansion-chip")).toBeNull();
  });
});

describe("expansion detail panel", () => {
  function openRow(container: HTMLElement, ticker: string) {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Expand ${ticker}`, "i") }));
    return container;
  }

  it("renders the six evidence group labels for a qualifying symbol", () => {
    const { container } = renderRanked(expansionBySymbol);
    openRow(container, "EXPD");

    const panel = screen.getByTestId("expansion-panel");
    expect(panel.textContent).toContain("Premarket Expansion Candidate");
    for (const label of [
      "Participation",
      "Range expansion",
      "Range location",
      "Structure",
      "Prior-day interaction",
      "Relative strength",
    ]) {
      expect(panel.textContent).toContain(label);
    }
    // The two distinct clocks stay distinct.
    expect(panel.textContent).toContain("Scanned at");
    expect(panel.textContent).toContain("Latest completed bar");
  });

  it("places the expansion panel above the reversal checklist, not buried under it", () => {
    // The reversal checklist is long. Below it, the panel is reached only
    // by scrolling past everything else — burying the thing the row's
    // badge just advertised.
    const { container } = renderRanked(expansionBySymbol);
    openRow(container, "EXPD");

    const panel = screen.getByTestId("expansion-panel");
    const checklistButton = screen.getByRole("button", { name: /view full checklist/i });
    const order = panel.compareDocumentPosition(checklistButton);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the honest unavailable state rather than a fabricated number", () => {
    // CALM's baseline is present but its participation never passes; a
    // symbol whose baseline cannot be built at all reports N/A outright.
    resetExpansionBaselineCache();
    const noBaseline = expansionBySymbol.NEAR.bullish;
    render(<ExpansionCandidatePanel expansion={{ bullish: noBaseline, bearish: noBaseline }} />);

    const panel = screen.getByTestId("expansion-panel");
    // Whatever could not be measured says so in words.
    expect(panel.textContent).toMatch(/N\/A|Unavailable/);
    // ...and never as a zero-shaped placeholder.
    expect(panel.textContent).not.toMatch(/0\.0×\s*median/);
  });

  it("renders nothing when there is no expansion for the symbol", () => {
    const { container } = render(<ExpansionCandidatePanel expansion={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("displays the qualifying direction when only bearish qualifies", () => {
    const { container } = renderRanked(expansionBySymbol);
    openRow(container, "DROP");

    const panel = screen.getByTestId("expansion-panel");
    expect(panel.getAttribute("data-direction")).toBe("bearish");
    expect(panel.textContent).toMatch(/Bearish/);
    expect(panel.textContent).toContain("Qualified");
  });

  it("falls back to the more developed direction when neither qualifies", () => {
    const near = expansionBySymbol.NEAR;
    const bullishRank = EXPANSION_STAGE_PRIORITY[near.bullish.stage];
    const bearishRank = EXPANSION_STAGE_PRIORITY[near.bearish.stage];
    // Precondition: this fixture only tests something if the stages differ.
    expect(bullishRank).not.toBe(bearishRank);
    const expected = bullishRank > bearishRank ? "bullish" : "bearish";

    render(<ExpansionCandidatePanel expansion={near} />);
    const panel = screen.getByTestId("expansion-panel");
    expect(panel.getAttribute("data-direction")).toBe(expected);
    // Pre-qualification the evidence is still shown, labelled honestly.
    expect(panel.textContent).toContain("Developing");
  });
});

describe("backward compatibility", () => {
  it("renders exactly as before when expansionBySymbol is omitted", () => {
    const withProp = renderRanked(undefined).container.innerHTML;
    cleanup();
    const withoutProp = render(
      <RankedOpportunities
        symbols={symbols}
        resultsBySymbol={resultsBySymbol}
        loading={false}
        scoreThreshold={6}
      />
    ).container.innerHTML;

    expect(withoutProp).toBe(withProp);
    expect(withoutProp).not.toContain("Expansion");
  });

  it("still renders every ranked row, and opening one still shows the setup detail", () => {
    const { container } = renderRanked(undefined);
    for (const ticker of ["EXPD", "DROP", "CALM", "NEAR"]) {
      expect(rowFor(container, ticker)).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("button", { name: /Expand EXPD/i }));
    expect(screen.queryByTestId("expansion-panel")).toBeNull();
    // The existing setup detail is untouched and still renders.
    expect(screen.getByRole("button", { name: /view full checklist/i })).toBeTruthy();
  });
});
