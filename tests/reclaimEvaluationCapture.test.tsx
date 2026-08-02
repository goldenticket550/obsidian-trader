// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReclaimEvaluationCapture } from "@/components/dashboard/ReclaimEvaluationCapture";
import {
  appendEvaluationRows,
  buildEvaluationRows,
  countScans,
  rowSignature,
  toCsv,
  toNdjson,
  EVIDENCE_GROUP_NAMES,
  type ReclaimEvaluationRow,
} from "@/lib/evaluation/reclaimEvaluationLog";
import { runReclaimForSymbol, type ReclaimSymbolResult } from "@/lib/scanner/reclaimRunner";
import { buildReclaimTimeframeSeries } from "@/lib/scanner/reclaimTimeframe";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { Candle } from "@/types/candle";

/**
 * EVALUATION CAPTURE — the in-memory session transcript and its export.
 *
 * Two properties run through everything here: the log must never grow
 * from a market that is not moving, and nothing captured may be presented
 * as an alert. Rows come from the REAL runner, never hand-authored, so a
 * change to the result shape surfaces here rather than being papered over
 * by a fixture that agrees with itself.
 */

afterEach(cleanup);

const CONFIG = defaultStrategyConfig.reclaimContinuation;
const ATR = 1.0;
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

function build(symbol: string, candles: Candle[] = fullSequence()): ReclaimSymbolResult {
  return runReclaimForSymbol(
    {
      symbol,
      sessionDate: "2026-07-13",
      fiveMinute: buildReclaimTimeframeSeries(candles),
      oneMinute: buildReclaimTimeframeSeries(fullSequence(60)),
      atr: ATR,
      priorDayLevel: { high: LEVEL, low: 98.5 },
      premarketLevel: null,
      openingRangeLevel: null,
      structureLevel: { high: 99.5, low: 99.5 },
      structureAvailableFromTime: T0,
      sweepEvidence: null,
      freshness: "real_time",
      volumePace: null,
      benchmarkRelativeMove: null,
    },
    CONFIG
  );
}

let advanced: ReclaimSymbolResult;
let early: ReclaimSymbolResult;

beforeAll(() => {
  advanced = build("EXPD");
  // A shorter series stops at an earlier stage, so the two reads differ.
  early = build("EXPD", fullSequence().slice(0, 5));
});

const scanA = "2026-07-13T13:35:00.000Z";
const scanB = "2026-07-13T13:40:00.000Z";
const scanC = "2026-07-13T13:45:00.000Z";

// ---------------------------------------------------------------------------
// Row building
// ---------------------------------------------------------------------------

describe("row building", () => {
  it("produces exactly one row per symbol per scan", () => {
    const rows = buildEvaluationRows({ EXPD: advanced, CALM: build("CALM") }, scanA);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.symbol).sort()).toEqual(["CALM", "EXPD"]);
    expect(rows.every((r) => r.scannedAt === scanA)).toBe(true);
  });

  it("captures the evaluation tier and the fields tuning needs", () => {
    const [row] = buildEvaluationRows({ EXPD: advanced }, scanA);

    // Straight from the runner, not recomputed.
    expect(row.stage).toBe(advanced.stage);
    expect(row.oneMinuteStage).toBe(advanced.oneMinuteStage);
    expect(row.alignment).toBe(advanced.alignment);
    expect(row.alertTier).toBe(advanced.alertTier);
    expect(row.isNewSetup).toBe(advanced.isNewSetup);
    expect(row.resetAtr).toBe(advanced.fiveMinute!.resetAtr);
    expect(row.resetDollars).toBe(advanced.fiveMinute!.resetDollars);
    expect(row.nextLevelName).toBe(advanced.fiveMinute!.nextLevelName);
    expect(row.invalidationPrice).toBe(advanced.fiveMinute!.invalidationPrice);
    expect(row.freshness).toBe(advanced.fiveMinute!.freshness);

    // Precondition: this fixture really did measure something, so the
    // assertions above are not all comparing null to null.
    expect(row.resetAtr).not.toBeNull();
    expect(row.stage).not.toBe("unavailable");
  });

  it("records evidence group states by name", () => {
    const [row] = buildEvaluationRows({ EXPD: advanced }, scanA);
    for (const group of advanced.fiveMinute!.evidence) {
      expect(row.evidence[group.name]).toBe(group.state);
    }
    expect(Object.keys(row.evidence).length).toBeGreaterThan(0);
  });

  it("writes null, never zero, when a machine measured nothing", () => {
    const blank = {
      ...advanced,
      fiveMinute: null,
      stage: "unavailable" as const,
    };
    const [row] = buildEvaluationRows({ EXPD: blank }, scanA);
    expect(row.resetAtr).toBeNull();
    expect(row.resetDollars).toBeNull();
    expect(row.nextLevelPrice).toBeNull();
    expect(row.freshness).toBeNull();
    expect(row.resetAtr).not.toBe(0);
    expect(row.evidence).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// De-duplication and cap
// ---------------------------------------------------------------------------

describe("de-duplication", () => {
  it("ignores the timestamp when deciding whether a read changed", () => {
    const [a] = buildEvaluationRows({ EXPD: advanced }, scanA);
    const [b] = buildEvaluationRows({ EXPD: advanced }, scanB);
    expect(a.scannedAt).not.toBe(b.scannedAt);
    expect(rowSignature(a)).toBe(rowSignature(b));
  });

  it("does not append a symbol whose read is unchanged", () => {
    const first = appendEvaluationRows([], buildEvaluationRows({ EXPD: advanced }, scanA));
    const second = appendEvaluationRows(first, buildEvaluationRows({ EXPD: advanced }, scanB));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    // The SAME array reference comes back, so a quiet scan cannot even
    // cause a re-render.
    expect(second).toBe(first);
  });

  it("appends when the read actually changes", () => {
    const first = appendEvaluationRows([], buildEvaluationRows({ EXPD: early }, scanA));
    const second = appendEvaluationRows(first, buildEvaluationRows({ EXPD: advanced }, scanB));

    // Precondition: the two fixtures genuinely differ.
    expect(rowSignature(first[0])).not.toBe(rowSignature(second[1]));
    expect(second).toHaveLength(2);
    expect(second[1].scannedAt).toBe(scanB);
  });

  it("de-duplicates per symbol, not across the scan", () => {
    // EXPD changes while CALM does not: only EXPD is appended.
    const calm = build("CALM");
    const first = appendEvaluationRows([], buildEvaluationRows({ EXPD: early, CALM: calm }, scanA));
    const second = appendEvaluationRows(
      first,
      buildEvaluationRows({ EXPD: advanced, CALM: calm }, scanB)
    );

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(3);
    expect(second[2].symbol).toBe("EXPD");
  });

  it("records a read that returns to an earlier value", () => {
    // Compared against the symbol's LAST kept row, not against every row
    // ever seen — A, B, A is three genuine observations.
    let log = appendEvaluationRows([], buildEvaluationRows({ EXPD: early }, scanA));
    log = appendEvaluationRows(log, buildEvaluationRows({ EXPD: advanced }, scanB));
    log = appendEvaluationRows(log, buildEvaluationRows({ EXPD: early }, scanC));
    expect(log).toHaveLength(3);
    expect(log.map((r) => r.scannedAt)).toEqual([scanA, scanB, scanC]);
  });
});

describe("cap", () => {
  it("keeps the most recent rows and drops the oldest", () => {
    let log: ReclaimEvaluationRow[] = [];
    // Alternate two genuinely different reads so nothing de-duplicates.
    for (let i = 0; i < 10; i++) {
      const entry = i % 2 === 0 ? early : advanced;
      log = appendEvaluationRows(log, buildEvaluationRows({ EXPD: entry }, `scan-${i}`), 4);
    }
    expect(log).toHaveLength(4);
    // The survivors are the last four, in order.
    expect(log.map((r) => r.scannedAt)).toEqual(["scan-6", "scan-7", "scan-8", "scan-9"]);
  });

  it("never exceeds the cap even when one scan is larger than it", () => {
    const many = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`S${i}`, build(`S${i}`)])
    );
    const log = appendEvaluationRows([], buildEvaluationRows(many, scanA), 4);
    expect(log).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe("export format", () => {
  it("emits one JSON object per line, with no outer array", () => {
    const rows = buildEvaluationRows({ EXPD: advanced, CALM: build("CALM") }, scanA);
    const ndjson = toNdjson(rows);
    const lines = ndjson.split("\n");

    expect(lines).toHaveLength(2);
    expect(ndjson.startsWith("[")).toBe(false);
    const parsed = lines.map((line) => JSON.parse(line) as ReclaimEvaluationRow);
    expect(parsed.map((r) => r.symbol).sort()).toEqual(["CALM", "EXPD"]);
    expect(parsed[0].alertTier).toBe(rows[0].alertTier);
  });

  it("round-trips every row through NDJSON unchanged", () => {
    const rows = buildEvaluationRows({ EXPD: advanced }, scanA);
    expect(toNdjson(rows).split("\n").map((l) => JSON.parse(l))).toEqual(rows);
  });

  it("emits a CSV header with one column per evidence group", () => {
    const rows = buildEvaluationRows({ EXPD: advanced }, scanA);
    const [header, ...lines] = toCsv(rows).split("\n");

    for (const name of EVIDENCE_GROUP_NAMES) expect(header).toContain(name);
    expect(header).toContain("alertTier");
    expect(lines).toHaveLength(1);
    expect(lines[0].split(",")[1]).toBe("EXPD");
  });

  it("quotes a value containing a comma rather than splitting the row", () => {
    const [row] = buildEvaluationRows({ EXPD: advanced }, scanA);
    const withComma: ReclaimEvaluationRow = {
      ...row,
      nextLevelName: 'Prior-day high, Session high "A"',
    };
    const line = toCsv([withComma]).split("\n")[1];
    expect(line).toContain('"Prior-day high, Session high ""A"""');
  });

  it("leaves an unmeasured value empty rather than writing 0", () => {
    const [row] = buildEvaluationRows({ EXPD: advanced }, scanA);
    const line = toCsv([{ ...row, resetAtr: null }]).split("\n")[1];
    const header = toCsv([row]).split("\n")[0].split(",");
    expect(line.split(",")[header.indexOf("resetAtr")]).toBe("");
  });

  it("counts distinct scans, not rows", () => {
    const rows = [
      ...buildEvaluationRows({ EXPD: advanced, CALM: build("CALM") }, scanA),
      ...buildEvaluationRows({ EXPD: early }, scanB),
    ];
    expect(rows).toHaveLength(3);
    expect(countScans(rows)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

describe("ReclaimEvaluationCapture", () => {
  beforeEach(() => {
    // happy-dom has no object-URL implementation.
    if (!URL.createObjectURL) {
      Object.defineProperty(URL, "createObjectURL", { value: () => "blob:test", writable: true });
      Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, writable: true });
    }
  });

  it("renders nothing at all when the scan did not evaluate Reclaim", () => {
    const { container } = render(
      <ReclaimEvaluationCapture reclaimBySymbol={undefined} scanTime={scanA} />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Export evaluation log/)).toBeNull();
  });

  it("captures a row on a scan refresh", () => {
    const { rerender } = render(
      <ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanA} />
    );
    expect(screen.getByTestId("evaluation-row-count").textContent).toContain("1");

    rerender(<ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: early }} scanTime={scanB} />);
    expect(screen.getByTestId("evaluation-row-count").textContent).toContain("2");
    expect(screen.getByTestId("evaluation-scan-count").textContent).toBe("2");
  });

  it("does not re-append when a later scan reports the same read", () => {
    const { rerender } = render(
      <ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanA} />
    );
    rerender(<ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanB} />);
    rerender(<ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanC} />);
    expect(screen.getByTestId("evaluation-row-count").textContent).toContain("1");
  });

  it("does not re-append when the same scan re-renders", () => {
    const { rerender } = render(
      <ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanA} />
    );
    rerender(<ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanA} />);
    expect(screen.getByTestId("evaluation-row-count").textContent).toContain("1");
  });

  it("captures nothing from an undated scan", () => {
    // A row stamped with the browser clock would look like a scan time.
    render(<ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={null} />);
    expect(screen.getByTestId("evaluation-row-count").textContent).toContain("0");
  });

  it("holds the cap across refreshes", () => {
    const { rerender } = render(
      <ReclaimEvaluationCapture
        reclaimBySymbol={{ EXPD: advanced }}
        scanTime={scanA}
        maxRows={2}
      />
    );
    rerender(
      <ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: early }} scanTime={scanB} maxRows={2} />
    );
    rerender(
      <ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanC} maxRows={2} />
    );
    expect(screen.getByTestId("evaluation-row-count").textContent).toContain("2");
  });

  it("exports the accumulated rows as NDJSON via an in-browser blob", () => {
    const parts: unknown[] = [];
    const originalBlob = globalThis.Blob;
    class CapturingBlob {
      constructor(chunks: unknown[]) {
        parts.push(...chunks);
      }
    }
    globalThis.Blob = CapturingBlob as unknown as typeof Blob;
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    try {
      const { rerender } = render(
        <ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanA} />
      );
      rerender(<ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: early }} scanTime={scanB} />);

      fireEvent.click(screen.getByText(/Export evaluation log/));

      expect(parts).toHaveLength(1);
      const lines = String(parts[0]).split("\n");
      expect(lines).toHaveLength(2);
      const parsed = lines.map((l) => JSON.parse(l) as ReclaimEvaluationRow);
      expect(parsed.map((r) => r.scannedAt)).toEqual([scanA, scanB]);
      // The URL is released rather than leaked for the session.
      expect(createUrl).toHaveBeenCalledTimes(1);
      expect(revokeUrl).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.Blob = originalBlob;
      createUrl.mockRestore();
      revokeUrl.mockRestore();
    }
  });

  it("offers no export while nothing has been captured", () => {
    render(<ReclaimEvaluationCapture reclaimBySymbol={{}} scanTime={scanA} />);
    expect(screen.getByText(/Export evaluation log/)).toHaveProperty("disabled", true);
  });

  it("never presents captured output as a live alert", () => {
    render(<ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanA} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Review Now/i);
    // No AFFIRMATIVE alert language. The word itself is allowed only
    // inside the disclaimer, so a blanket ban would forbid saying what
    // this is not — these are the phrasings that would actually mislead.
    expect(text).not.toMatch(/\b(new|triggered|sent|fired|active|live)\s+alert/i);
    expect(text).not.toMatch(/alert\s+(triggered|sent|fired|queued|delivered)/i);
    // Every remaining mention of "alert" is a denial.
    for (const match of text.matchAll(/.{0,12}alert/gi)) {
      expect(match[0]).toMatch(/not\s+$|not\s+\w*\s*$/i);
    }
    // ...and it says what it actually is.
    expect(text).toMatch(/Recorded evaluation output/i);
    expect(text).toMatch(/In-memory only/i);
  });

  it("uses no browser storage", () => {
    const localSet = vi.spyOn(Storage.prototype, "setItem");
    try {
      const { rerender } = render(
        <ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: advanced }} scanTime={scanA} />
      );
      rerender(<ReclaimEvaluationCapture reclaimBySymbol={{ EXPD: early }} scanTime={scanB} />);
      expect(localSet).not.toHaveBeenCalled();
    } finally {
      localSet.mockRestore();
    }
  });
});
