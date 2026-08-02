// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ReclaimContinuationPanel } from "@/components/dashboard/ReclaimContinuationPanel";
import {
  runReclaimForSymbol,
  rankReclaimCandidates,
  type ReclaimSymbolResult,
} from "@/lib/scanner/reclaimRunner";
import { buildReclaimTimeframeSeries } from "@/lib/scanner/reclaimTimeframe";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { Candle } from "@/types/candle";

/**
 * The Reclaim & Continuation SETUPS section, in evaluation mode.
 *
 * Two things run through every test: nothing may read as a directive
 * while alerting is off, and nothing unmeasured may render as a number.
 */

afterEach(cleanup);

const CONFIG = defaultStrategyConfig.reclaimContinuation;
const ATR = 1.0;
/** 9:30 AM ET on 2026-07-13 (EDT), so the fixture sits in the regular session. */
const T0 = Math.floor(Date.parse("2026-07-13T13:30:00Z") / 1000);
const LEVEL = 101.0;

function bar(i: number, o: number, h: number, l: number, c: number, step = 300): Candle {
  return { time: T0 + i * step, open: o, high: h, low: l, close: c, volume: 5000 };
}

function fullSequence(step = 300): Candle[] {
  const b = LEVEL + CONFIG.breakBufferAtr * ATR;
  return [
    bar(0, 100.0, 100.2, 99.9, 100.1, step),
    bar(1, 100.1, 101.0, 100.0, 100.9, step),
    bar(2, 100.9, 101.0, 99.2, 99.3, step),
    bar(3, 99.3, 99.4, 99.0, 99.15, step),
    bar(4, 99.15, 99.95, 99.1, 99.9, step),
    bar(5, 99.9, 100.9, 99.85, 100.85, step),
    bar(6, 100.85, 101.0, 100.7, 100.95, step),
    bar(7, 100.95, b + 0.4, 100.9, b + 0.3, step),
    bar(8, b + 0.3, b + 0.6, b + 0.2, b + 0.5, step),
    bar(9, b + 0.5, b + 0.55, b + 0.1, b + 0.15, step),
    bar(10, b + 0.15, b + 0.7, b + 0.12, b + 0.65, step),
    bar(11, b + 0.65, b + 1.4, b + 0.6, b + 1.3, step),
  ];
}

/** Real runner output — never a hand-authored result object. */
function build(symbol: string, overrides: Partial<Parameters<typeof runReclaimForSymbol>[0]> = {}) {
  return runReclaimForSymbol(
    {
      symbol,
      sessionDate: "2026-07-13",
      fiveMinute: buildReclaimTimeframeSeries(fullSequence()),
      oneMinute: buildReclaimTimeframeSeries(fullSequence(60)),
      atr: ATR,
      priorDayLevel: LEVEL,
      premarketLevel: null,
      openingRangeLevel: null,
      structureLevel: 99.5,
      sweepEvidence: null,
      freshness: "real_time",
      volumePace: null,
      benchmarkRelativeMove: null,
      ...overrides,
    },
    CONFIG
  );
}

let base: ReclaimSymbolResult;

beforeAll(() => {
  base = build("EXPD");
});

function renderPanel(
  reclaimBySymbol?: Record<string, ReclaimSymbolResult>,
  reclaimErrors?: { symbol: string; message: string }[]
) {
  return render(
    <ReclaimContinuationPanel reclaimBySymbol={reclaimBySymbol} reclaimErrors={reclaimErrors} />
  );
}

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe("isolation", () => {
  it("renders nothing at all when Reclaim was not evaluated", () => {
    const { container } = renderPanel(undefined);
    // Absent means "not evaluated" — the screen stays silent rather than
    // claiming nothing was found.
    expect(container.innerHTML).toBe("");
  });

  it("shows an explicit empty state when evaluated with no candidate", () => {
    renderPanel({});
    expect(screen.getByText(/No candidate currently meets the criteria/i)).toBeTruthy();
  });

  it("survives a malformed entry without losing the rest of the view", () => {
    const malformed = { notASymbol: true } as unknown as ReclaimSymbolResult;
    renderPanel({ BAD: malformed, EXPD: base });
    // The good symbol still renders.
    expect(screen.getByTestId("reclaim-detail").getAttribute("data-symbol")).toBe("EXPD");
  });
});

// ---------------------------------------------------------------------------
// Evaluation-mode language
// ---------------------------------------------------------------------------

describe("evaluation-mode language", () => {
  it("labels the whole section as an evaluation, not live alerting", () => {
    renderPanel({ EXPD: base });
    expect(screen.getByTestId("reclaim-evaluation-banner").textContent).toMatch(
      /Evaluation — not live alerting/i
    );
  });

  it("frames the tier as what the system WOULD surface", () => {
    renderPanel({ EXPD: base });
    expect(screen.getByTestId("reclaim-evaluation").textContent).toMatch(/Would alert on:/i);
    expect(screen.getByTestId("reclaim-tier").textContent).toMatch(/criteria met|Evaluation/i);
  });

  it("never renders the phrase 'Review Now', and never as a control", () => {
    renderPanel({ EXPD: base });
    // The runner's top tier is `review_now`; the UI must not surface it as
    // an instruction while alerting is off.
    expect(base.alertTier).toBe("review_now");
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/Review Now/);
    expect(screen.queryByRole("button", { name: /review now/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /review now/i })).toBeNull();
    // The honest phrasing is present instead.
    expect(html).toMatch(/Review criteria met/);
  });

  it("contains nothing implying an order, target, probability or win rate", () => {
    renderPanel({ EXPD: base });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\bbuy\b|\bsell\b|\bcall\b|\bput\b/i);
    expect(text).not.toMatch(/target|probability|win rate|confidence|expected value/i);
  });
});

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

describe("alignment", () => {
  it("shows 'Mixed timeframes' exactly when the timeframes conflict", () => {
    const mirrored = fullSequence(60).map((c) => ({
      ...c,
      open: 200 - c.open,
      high: 200 - c.low,
      low: 200 - c.high,
      close: 200 - c.close,
    }));
    const conflicting = build("CONF", { oneMinute: buildReclaimTimeframeSeries(mirrored) });
    // Precondition, so this cannot pass vacuously.
    expect(conflicting.alignment).toBe("conflicting");

    renderPanel({ CONF: conflicting });
    expect(screen.getByTestId("reclaim-alignment").textContent).toBe("Mixed timeframes");
    expect(screen.getByTestId("reclaim-blocked").textContent).toMatch(
      /Review criteria blocked — mixed timeframes/i
    );
  });

  it("reports the one-minute scout as unavailable rather than silent", () => {
    const noScout = build("SOLO", { oneMinute: null });
    renderPanel({ SOLO: noScout });
    expect(screen.getByTestId("reclaim-evaluation").textContent).toMatch(/1m scout: Unavailable/i);
    expect(screen.getByTestId("reclaim-alignment").textContent).toMatch(/unavailable/i);
  });
});

// ---------------------------------------------------------------------------
// Honest nulls
// ---------------------------------------------------------------------------

describe("unavailable values", () => {
  it("renders unmeasured fields as Unavailable, never as zero", () => {
    renderPanel({ EXPD: base });
    // volumePace is null in this fixture.
    expect(base.fiveMinute!.volumePace).toBeNull();
    const changed = screen.getByTestId("reclaim-what-changed");
    expect(changed.textContent).toMatch(/Participation\s*Unavailable/);
    expect(changed.textContent).not.toMatch(/Participation\s*0/);
  });

  it("says 'Not established' rather than inventing an invalidation price", () => {
    const stripped: ReclaimSymbolResult = {
      ...base,
      fiveMinute: { ...base.fiveMinute!, invalidationName: null, invalidationPrice: null },
    };
    renderPanel({ EXPD: stripped });
    expect(screen.getByTestId("reclaim-what-breaks-it").textContent).toMatch(/Not established/);
  });

  it("says 'None yet' rather than inventing an accepted level", () => {
    const stripped: ReclaimSymbolResult = {
      ...base,
      fiveMinute: { ...base.fiveMinute!, acceptedLevelName: null, acceptedLevelPrice: null },
    };
    renderPanel({ EXPD: stripped });
    expect(screen.getByTestId("reclaim-whats-next").textContent).toMatch(/None yet/);
  });
});

// ---------------------------------------------------------------------------
// Structure matching the reference
// ---------------------------------------------------------------------------

describe("layout", () => {
  it("renders the ranked list beside the detail", () => {
    renderPanel({ EXPD: base });
    const layout = screen.getByTestId("reclaim-layout");
    expect(layout.style.gridTemplateColumns).toContain("minmax(200px, 0.78fr)");
    expect(screen.getByTestId("reclaim-ranked")).toBeTruthy();
    expect(screen.getByTestId("reclaim-detail")).toBeTruthy();
  });

  it("renders the six-step rail with one node per stage", () => {
    renderPanel({ EXPD: base });
    const steps = screen.getAllByTestId("reclaim-rail-step");
    expect(steps.map((s) => s.getAttribute("data-step"))).toEqual([
      "Reset",
      "Exhaustion",
      "Reclaim",
      "Level test",
      "Acceptance",
      "Continuation",
    ]);
    // The fixture reaches continuation, so the last node is current.
    expect(steps[5].getAttribute("data-state")).toBe("current");
    expect(steps[0].getAttribute("data-state")).toBe("complete");
  });

  it("renders the three decision sections in one row", () => {
    renderPanel({ EXPD: base });
    const grid = screen.getByTestId("reclaim-decisions");
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    for (const id of ["reclaim-what-changed", "reclaim-whats-next", "reclaim-what-breaks-it"]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it("keeps the evidence groups collapsed behind a disclosure", () => {
    const { container } = renderPanel({ EXPD: base });
    const toggle = screen.getByRole("button", { name: /view evidence/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const region = container.querySelector(`[id="${toggle.getAttribute("aria-controls")}"]`)!;
    expect(region.hasAttribute("hidden")).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(region.hasAttribute("hidden")).toBe(false);
    // All six groups, each with a state pill.
    expect(region.querySelectorAll('[data-testid^="reclaim-evidence-"]')).toHaveLength(6);
    expect(region.textContent).toMatch(/Reset depth/);
    expect(region.textContent).toMatch(/Data freshness/);
  });
});

// ---------------------------------------------------------------------------
// Ranking, history, errors
// ---------------------------------------------------------------------------

describe("ranking, history and errors", () => {
  it("orders rows by rankReclaimCandidates", () => {
    const a = build("AAA");
    const b = build("BBB");
    const c = build("CCC");
    const expected = rankReclaimCandidates([a, b, c]).map((e) => e.symbol);

    const { container } = renderPanel({ CCC: c, AAA: a, BBB: b });
    const rows = [...container.querySelectorAll('[data-testid="reclaim-row"]')].map((r) =>
      r.getAttribute("data-symbol")
    );
    expect(rows).toEqual(expected);
  });

  it("lets a different candidate be selected", () => {
    const a = build("AAA");
    const b = build("BBB");
    renderPanel({ AAA: a, BBB: b });

    fireEvent.click(screen.getByRole("button", { name: "BBB" }));
    expect(screen.getByTestId("reclaim-detail").getAttribute("data-symbol")).toBe("BBB");
  });

  it("shows an invalidated setup as history, not as an active candidate", () => {
    const invalidating = [...fullSequence().slice(0, 5), bar(5, 99.9, 99.95, 98.0, 98.1)];
    const invalidated = build("DEAD", {
      fiveMinute: buildReclaimTimeframeSeries(invalidating),
      oneMinute: null,
    });
    // Precondition: the runner really did withhold it as an active winner.
    expect(invalidated.fiveMinute).toBeNull();
    expect(invalidated.historical).not.toBeNull();

    renderPanel({ DEAD: invalidated });
    const history = screen.getByTestId("reclaim-historical");
    expect(history.textContent).toMatch(/History — invalidated/);
    expect(history.textContent).toMatch(/DEAD/);
    // It is not offered as a ranked candidate.
    expect(screen.queryByTestId("reclaim-row")).toBeNull();
  });

  it("shows evaluation errors separately from scan errors", () => {
    renderPanel({ EXPD: base }, [{ symbol: "BOOM", message: "reclaim exploded" }]);
    const errors = screen.getByTestId("reclaim-errors");
    expect(errors.textContent).toMatch(/Evaluation errors/);
    expect(errors.textContent).toMatch(/BOOM/);
    expect(errors.textContent).toMatch(/reclaim exploded/);
  });
});
