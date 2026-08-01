// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { RankedOpportunities } from "@/components/dashboard/RankedOpportunities";
import {
  ExpansionCandidatePanel,
  buildStageRail,
  ladderPillStates,
} from "@/components/dashboard/ExpansionCandidatePanel";
import type { SymbolExpansionMonitor } from "@/lib/scanner/expansionMonitor";
import type { MilestoneState, MomentumLadderResult } from "@/lib/indicators/momentumLadder";
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
  SCAN_NOW_MIDDAY,
  MIDDAY_LAST_BAR_MINUTE,
} from "./support/expansionScanFixture";

afterEach(cleanup);

/** 4:00 AM ET — the premarket open, before its first bar has completed. */
const PRE_OPEN_NOW = "2026-07-13T08:00:00Z";

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
let monitorBySymbol: Record<string, SymbolExpansionMonitor>;

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
  monitorBySymbol = scan.expansionMonitorBySymbol!;
});

function renderRanked(
  expansion?: Record<string, SymbolExpansion>,
  monitor?: Record<string, SymbolExpansionMonitor>
) {
  return render(
    <RankedOpportunities
      symbols={symbols}
      resultsBySymbol={resultsBySymbol}
      loading={false}
      scoreThreshold={6}
      expansionBySymbol={expansion}
      expansionMonitorBySymbol={monitor}
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
    // The header now leads with the ticker and its move.
    expect(panel.textContent).toContain("EXPD");
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

  it("renders structured sections rather than one preformatted text block", () => {
    const { container } = renderRanked(expansionBySymbol);
    openRow(container, "EXPD");
    const panel = screen.getByTestId("expansion-panel");

    // The monospace log-dump is gone.
    expect(panel.querySelector("pre")).toBeNull();

    for (const heading of [
      "What changed",
      "What's next",
      "What breaks it",
      "Premarket context",
      "Evidence",
    ]) {
      expect(panel.textContent).toContain(heading);
    }
    // Context rows are label/value pairs, matching the other panels.
    for (const label of [
      "Move from prior close",
      "Volume pace",
      "Premarket range",
      "Range vs baseline",
      "Position in reference range",
      "Prior-day level",
      "Data status",
    ]) {
      expect(panel.textContent).toContain(label);
    }
  });

  it("gives each of the three cards its own region", () => {
    const { container } = renderRanked(expansionBySymbol, monitorBySymbol);
    openRow(container, "EXPD");

    for (const id of ["card-what-changed", "card-whats-next", "card-what-breaks-it"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    // What's next carries the confirmation requirement and the level ahead.
    expect(screen.getByTestId("card-whats-next").textContent).toMatch(/Hold|Break and hold|accepted/);
    // What breaks it carries the invalidation, or says it is not established.
    expect(screen.getByTestId("card-what-breaks-it").textContent).toMatch(
      /Lose|Reclaim|Not established/
    );
  });

  it("keeps the evidence detail behind a disclosure", () => {
    const { container } = renderRanked(expansionBySymbol, monitorBySymbol);
    openRow(container, "EXPD");

    const toggle = screen.getByRole("button", { name: /view evidence & calculations/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const regionId = toggle.getAttribute("aria-controls")!;
    const region = container.querySelector(`[id="${regionId}"]`)!;
    expect(region.hasAttribute("hidden")).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(region.hasAttribute("hidden")).toBe(false);
    // The six groups live inside it.
    expect(region.querySelectorAll('[data-testid^="evidence-pill-"]')).toHaveLength(6);
  });

  it("gives every evidence group a state pill, one per group", () => {
    const { container } = renderRanked(expansionBySymbol);
    openRow(container, "EXPD");
    const panel = screen.getByTestId("expansion-panel");

    const pills = panel.querySelectorAll('[data-testid^="evidence-pill-"]');
    expect(pills).toHaveLength(6);

    const expected = expansionBySymbol.EXPD.bullish.groups.map((g) => g.state);
    expect([...pills].map((p) => p.getAttribute("data-testid")!.replace("evidence-pill-", ""))).toEqual(
      expected
    );
    // Unmeasurable is muted, never red — it is not a failure.
    const na = panel.querySelector('[data-testid="evidence-pill-unavailable"]') as HTMLElement;
    expect(na.textContent).toBe("N/A");
    expect(na.style.color).toContain("--text-muted");
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

  it("collapses to one honest line when there is no premarket window yet", async () => {
    // Scanned at 4:00 AM ET, before the first premarket bar has closed.
    // Every context row would read "Unavailable"; one sentence says more.
    resetExpansionBaselineCache();
    const scan = await scanWatchlistWithProvider(
      [{ symbol: "EXPD", exchange: "NASDAQ" }],
      new FixtureProvider(standardFixtures()),
      defaultStrategyConfig,
      PRE_OPEN_NOW
    );
    const preOpen = scan.expansionBySymbol!.EXPD;

    render(<ExpansionCandidatePanel expansion={preOpen} />);
    const panel = screen.getByTestId("expansion-panel");

    expect(screen.getByTestId("expansion-empty").textContent).toBe(
      "No premarket data yet — market closed or pre-open"
    );
    // The header survives; the body does not become a wall of Unavailable.
    expect(panel.textContent).toContain("EXPD");
    expect(screen.getByTestId("expansion-stage-badge")).toBeTruthy();
    expect(panel.querySelectorAll('[data-testid^="evidence-pill-"]')).toHaveLength(0);
    expect(screen.queryByTestId("expansion-stage-rail")).toBeNull();
    expect(screen.queryByTestId("dollar-ladder")).toBeNull();
    expect(panel.textContent).not.toContain("Volume pace");
    expect(panel.textContent).not.toContain("Scanned at");
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
    // Direction is carried by the arrow, the signed move, and the
    // accessible label — never by colour alone.
    expect(panel.textContent).toContain("▼");
    expect(panel.textContent).toContain("−$4.00");
    expect(panel.getAttribute("aria-label")).toMatch(/bearish/i);
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

describe("card arrangement", () => {
  function renderCard(entryStatus?: "extended_do_not_chase") {
    return render(
      <ExpansionCandidatePanel
        expansion={expansionBySymbol.EXPD}
        monitor={monitorBySymbol.EXPD}
        entryStatus={entryStatus}
      />
    );
  }

  /** Document order of the panel's major regions. */
  function orderOf(container: HTMLElement): string[] {
    const marks: [string, string][] = [
      ["header", '[data-testid="expansion-stage-badge"]'],
      ["rail", '[data-testid="expansion-stage-rail"]'],
      ["cards", '[data-testid="expansion-cards"]'],
      ["dollar-ladder", '[data-testid="dollar-ladder"]'],
      ["percent-ladder", '[data-testid="percent-ladder"]'],
      ["evidence-toggle", "button[aria-controls]"],
    ];

    const found: { name: string; el: Element }[] = [];
    for (const [name, selector] of marks) {
      const el = container.querySelector(selector);
      if (el !== null) found.push({ name, el });
    }

    return found
      .sort((a, b) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      )
      .map((m) => m.name);
  }

  it("stacks header, rail, cards, both ladders, then the toggle", () => {
    const { container } = renderCard();
    expect(orderOf(container)).toEqual([
      "header",
      "rail",
      "cards",
      "dollar-ladder",
      "percent-ladder",
      "evidence-toggle",
    ]);
  });

  it("puts the three cards in one row of equal columns", () => {
    const { container } = renderCard();
    const cards = screen.getByTestId("expansion-cards");
    expect(cards.className).toContain("grid-cols-3");
    expect(cards.children).toHaveLength(3);
    expect([...cards.children].map((c) => c.getAttribute("data-testid"))).toEqual([
      "card-what-changed",
      "card-whats-next",
      "card-what-breaks-it",
    ]);
    expect(container).toBeTruthy();
  });

  it("colours the what-breaks-it value red, and the card headings muted", () => {
    renderCard();
    const card = screen.getByTestId("card-what-breaks-it");
    const heading = card.querySelector("p")!;
    expect(heading.textContent).toBe("What breaks it");
    expect(heading.getAttribute("style")).toContain("--text-muted");

    const value = card.querySelectorAll("p")[1] as HTMLElement;
    expect(value.getAttribute("style")).toContain("--red");
  });

  it("pins the extension chip to the far right of the header", () => {
    renderCard("extended_do_not_chase");
    const chip = screen.getByTestId("expansion-extended-warning");
    // `ml-auto` is what pushes it right; the badge before it must not have it.
    expect(chip.className).toContain("ml-auto");
    expect(screen.getByTestId("expansion-stage-badge").className).not.toContain("ml-auto");
  });

  it("centers the evidence toggle at the bottom", () => {
    const { container } = renderCard();
    const toggle = container.querySelector("button[aria-controls]")!;
    expect(toggle.className).toContain("text-center");
  });
});

describe("stage rail", () => {
  const STEPS = [
    "Premarket",
    "Early Acceleration",
    "Opening Drive",
    "Level Break",
    "Accepted",
    "Expansion Active",
  ];

  function railFor(stage: Parameters<typeof buildStageRail>[0], early = false) {
    return buildStageRail(stage, early);
  }

  it("lists the six milestones in order", () => {
    expect(railFor("inactive").map((s) => s.label)).toEqual(STEPS);
  });

  it("marks everything pending when nothing has happened", () => {
    expect(railFor("inactive").every((s) => s.state === "pending")).toBe(true);
  });

  it("marks the furthest milestone reached as current and earlier ones done", () => {
    const rail = railFor("breakout_accepted");
    expect(rail.map((s) => s.state)).toEqual([
      "done", // Premarket
      "done", // Early Acceleration
      "done", // Opening Drive
      "done", // Level Break
      "current", // Accepted
      "pending", // Expansion Active
    ]);
  });

  it("lights the whole rail once expansion is active", () => {
    const rail = railFor("expansion_active");
    expect(rail[rail.length - 1].state).toBe("current");
    expect(rail.slice(0, -1).every((s) => s.state === "done")).toBe(true);
  });

  it("shows early acceleration even when the stage outranks opening drive", () => {
    // level_break (5) outranks opening_drive (4), so the stage alone would
    // not reveal that the early signal ever fired.
    const withSignal = railFor("level_break", true);
    expect(withSignal[1].state).not.toBe("pending");
    expect(withSignal[3].state).toBe("current");
  });

  it("never marks a milestone reached that the stage has not reached", () => {
    const rail = railFor("premarket_candidate");
    expect(rail[0].state).toBe("current");
    for (const step of rail.slice(1)) expect(step.state).toBe("pending");
  });

  it("renders one node per stage, each with its label beneath", () => {
    render(
      <ExpansionCandidatePanel
        expansion={expansionBySymbol.EXPD}
        monitor={monitorBySymbol.EXPD}
      />
    );
    const rail = screen.getByTestId("expansion-stage-rail");
    // A single horizontal row, not a wrapped pile.
    expect(rail.className).toContain("flex");
    expect(rail.className).not.toContain("flex-wrap");

    const steps = screen.getAllByTestId("expansion-rail-step");
    for (const [index, step] of steps.entries()) {
      // Each step stacks its node above its label.
      expect(step.className).toContain("flex-col");
      expect(step.textContent).toContain(STEPS[index]);
    }
  });

  it("renders the rail states into the panel", () => {
    render(
      <ExpansionCandidatePanel
        expansion={expansionBySymbol.EXPD}
        monitor={monitorBySymbol.EXPD}
      />
    );
    const steps = screen.getAllByTestId("expansion-rail-step");
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual(STEPS);

    const stage = monitorBySymbol.EXPD.bullish.stage;
    const expected = buildStageRail(
      stage,
      monitorBySymbol.EXPD.bullish.signals.earlyAccelerationFired
    );
    expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(
      expected.map((e) => e.state)
    );
  });
});

describe("momentum ladders", () => {
  function ladder(states: MilestoneState[]): MomentumLadderResult {
    return {
      passed: states.some((s) => s === "holding" || s === "reclaimed"),
      insufficientData: false,
      anchorPrice: 100,
      currentMovePct: 4,
      currentMoveDollars: 4,
      highestMilestoneReached: null,
      highestHoldingTier: null,
      tiers: [3, 5, 8, 10, 15].map((tierPct, i) => ({
        tierPct,
        tierPrice: 100 * (1 + tierPct / 100),
        state: states[i],
        firstReachedAt: null,
        lastTransitionAt: null,
      })),
      detail: "",
    };
  }

  it("maps each lifecycle state onto a display pill", () => {
    expect(
      ladderPillStates(ladder(["holding", "reclaimed", "reached", "rejected", "lost"]))
    ).toEqual(["holding", "holding", "reached", "rejected", "lost"]);
  });

  it("calls only the LOWEST unreached tier approaching, the rest pending", () => {
    expect(
      ladderPillStates(ladder(["holding", "not_reached", "not_reached", "not_reached", "not_reached"]))
    ).toEqual(["holding", "approaching", "pending", "pending", "pending"]);
  });

  it("renders both ladders with a pill per tier once the ladder has an anchor", async () => {
    // The ladder needs the session-open anchor plus at least one candle
    // beyond it, which only exists once the regular session is under way —
    // at 9:35 exactly one regular bar has closed.
    resetExpansionBaselineCache();
    const midday = await scanWatchlistWithProvider(
      [{ symbol: "EXPD", exchange: "NASDAQ" }],
      new FixtureProvider(standardFixtures(), MIDDAY_LAST_BAR_MINUTE),
      defaultStrategyConfig,
      SCAN_NOW_MIDDAY
    );
    const monitor = midday.expansionMonitorBySymbol!.EXPD;
    // Precondition: this only tests the ladder if the ladder is measurable.
    expect(monitor.momentumLadder.insufficientData).toBe(false);
    expect(monitor.momentumLadder.anchorPrice).not.toBeNull();

    render(
      <ExpansionCandidatePanel expansion={midday.expansionBySymbol!.EXPD} monitor={monitor} />
    );
    const tierCount = defaultStrategyConfig.momentumLadder.tiers.length;

    for (const id of ["dollar-ladder", "percent-ladder"]) {
      expect(screen.getByTestId(id).getAttribute("data-unavailable")).toBeNull();
      const tiers = screen.getAllByTestId(`${id}-tier`);
      expect(tiers).toHaveLength(tierCount);
      // Every pill carries a real state, never a blank.
      for (const tier of tiers) {
        expect(tier.getAttribute("data-state")).toBeTruthy();
      }
    }
    // An achieved tier carries a check and no trailing word; every other
    // state names itself.
    for (const tier of screen.getAllByTestId("percent-ladder-tier")) {
      const state = tier.getAttribute("data-state")!;
      if (state === "holding" || state === "reached") {
        expect(tier.textContent).toContain("✓");
        expect(tier.textContent).not.toMatch(/Approaching|Pending/);
      } else if (state === "approaching") {
        expect(tier.textContent).toContain("Approaching");
      } else if (state === "pending") {
        expect(tier.textContent).toContain("Pending");
      }
    }

    // The percent ladder shows the configured tiers verbatim.
    expect(
      screen.getAllByTestId("percent-ladder-tier").map((t) => t.textContent!.match(/\+\d+%/)![0])
    ).toEqual(
      [...defaultStrategyConfig.momentumLadder.tiers]
        .sort((a, b) => a - b)
        .map((t) => `+${t}%`)
    );
  });

  it("marks an achieved tier with a check and no trailing word", () => {
    // The live fixture has no tier holding yet, so this pins the reached
    // branch explicitly rather than leaving it to chance.
    const held = ladder(["holding", "reached", "not_reached", "not_reached", "not_reached"]);
    render(
      <ExpansionCandidatePanel
        expansion={expansionBySymbol.EXPD}
        monitor={{ ...monitorBySymbol.EXPD, momentumLadder: held }}
      />
    );

    const pills = screen.getAllByTestId("percent-ladder-tier");
    expect(pills[0].textContent).toContain("✓");
    expect(pills[0].textContent).toContain("+3%");
    expect(pills[0].textContent).not.toMatch(/Approaching|Pending|Holding/);
    expect(pills[1].textContent).toContain("✓");
    // The first UNREACHED tier is the approaching one; the rest are pending.
    expect(pills[2].textContent).toContain("Approaching");
    expect(pills[2].textContent).not.toContain("✓");
    expect(pills[3].textContent).toContain("Pending");
    expect(pills[4].textContent).toContain("Pending");
  });

  it("says Unavailable rather than inventing tiers before the session opens", () => {
    // The 9:35 fixture has a single regular bar — genuinely not enough to
    // anchor a ladder, and the card says so instead of showing empty pills.
    expect(monitorBySymbol.EXPD.momentumLadder.insufficientData).toBe(true);
    render(
      <ExpansionCandidatePanel
        expansion={expansionBySymbol.EXPD}
        monitor={monitorBySymbol.EXPD}
      />
    );
    expect(screen.getByTestId("dollar-ladder").getAttribute("data-unavailable")).toBe("true");
    expect(screen.getByTestId("dollar-ladder").textContent).toContain("Unavailable");
    expect(screen.queryAllByTestId("dollar-ladder-tier")).toHaveLength(0);
  });

  it("says Unavailable rather than inventing tiers when the ladder has no anchor", () => {
    const noAnchor: MomentumLadderResult = {
      ...ladder(["not_reached", "not_reached", "not_reached", "not_reached", "not_reached"]),
      insufficientData: true,
      anchorPrice: null,
      detail: "Not enough candles yet to measure a move from the session open",
    };
    render(
      <ExpansionCandidatePanel
        expansion={expansionBySymbol.EXPD}
        monitor={{ ...monitorBySymbol.EXPD, momentumLadder: noAnchor }}
      />
    );
    const el = screen.getByTestId("dollar-ladder");
    expect(el.getAttribute("data-unavailable")).toBe("true");
    expect(el.textContent).toContain("Unavailable");
    expect(screen.queryAllByTestId("dollar-ladder-tier")).toHaveLength(0);
  });
});

describe("extension warning", () => {
  it("warns without invalidating when the setup is extended", () => {
    render(
      <ExpansionCandidatePanel
        expansion={expansionBySymbol.EXPD}
        monitor={monitorBySymbol.EXPD}
        entryStatus="extended_do_not_chase"
      />
    );
    const chip = screen.getByTestId("expansion-extended-warning");
    expect(chip.textContent).toBe("Valid · Highly extended · Do not chase");
  });

  it("shows no warning for any other entry status", () => {
    for (const status of ["actionable_now", "wait_for_pullback", undefined] as const) {
      cleanup();
      render(
        <ExpansionCandidatePanel
          expansion={expansionBySymbol.EXPD}
          monitor={monitorBySymbol.EXPD}
          entryStatus={status}
        />
      );
      expect(screen.queryByTestId("expansion-extended-warning")).toBeNull();
    }
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
