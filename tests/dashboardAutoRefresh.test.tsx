// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import DashboardPage from "@/app/page";
import { mockSetupResults } from "@/lib/mock/setups";
import type { WatchlistSymbol } from "@/types/watchlist";
import type { SetupResult } from "@/types/setup";

/**
 * Auto-refresh behaviour for the dashboard (app/page.tsx). Fake timers drive
 * the 60s schedule; a controllable fetch mock drives success/failure/deferred
 * responses. Timers, visibility, listeners, and fetch are all restored after
 * each case.
 */

const T1 = "2026-07-27T18:32:00Z"; // -> "2:32 PM ET"
const T2 = "2026-07-27T19:45:00Z"; // -> "3:45 PM ET"
const INTERVAL = 60_000;

const baseSetup = mockSetupResults.NVDA;
function setupResult(timeframe: "5m" | "15m", lastUpdated: string): SetupResult {
  return { ...baseSetup, symbol: "NVDA", timeframe, lastUpdated };
}
function nvdaSymbol(): WatchlistSymbol {
  return {
    ticker: "NVDA",
    exchange: "NASDAQ",
    price: 134.82,
    dailyChangePct: 0.012,
    distanceFromSessionLowPct: 0.02,
    score5m: 6,
    score15m: 5,
    status5m: "yellow",
    status15m: "yellow",
    lastSignalTime: null,
  };
}
function scanBody(lastUpdated: string) {
  return {
    provider: "test",
    watchlist: [nvdaSymbol()],
    resultsBySymbol: { NVDA: { "5m": setupResult("5m", lastUpdated), "15m": setupResult("15m", lastUpdated) } },
    newAlerts: [],
    errors: [],
  };
}

function jsonRes(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}
function errRes(status = 500): Response {
  return { ok: false, status, json: () => Promise.resolve({}) } as unknown as Response;
}

// Controllable scan responder — tests can swap it for failure/deferred cases.
let scanResponder: () => Promise<Response>;
let scanCalls = 0;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}
function fireVisibility(state: "visible" | "hidden") {
  setVisibility(state);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function renderDashboard() {
  render(<DashboardPage />);
  await flush(); // resolve the initial runScan
}
function scannedText(): string {
  return screen.getByText(/^Scanned /).textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
  scanCalls = 0;
  scanResponder = () => Promise.resolve(jsonRes(scanBody(T1)));
  setVisibility("visible");
  global.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.startsWith("/api/scan")) {
      scanCalls += 1;
      return scanResponder();
    }
    if (url.startsWith("/api/alerts")) return Promise.resolve(jsonRes({ events: [] }));
    if (url.startsWith("/api/market-context")) return Promise.resolve(jsonRes({ quotes: [] }));
    if (url.startsWith("/api/risk")) return Promise.resolve(errRes()); // keep risk null (no fixture needed)
    return Promise.resolve(jsonRes({}));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setVisibility("visible");
});

describe("dashboard auto-refresh — scheduling", () => {
  it("1. initial load runs the existing scan once and renders its data", async () => {
    await renderDashboard();
    expect(scanCalls).toBe(1);
    expect(screen.getByText("NVDA")).toBeTruthy();
    expect(scannedText()).toContain("2:32");
  });

  it("2 + 3. no immediate duplicate; re-scans once after 60s and updates the timestamp", async () => {
    await renderDashboard();
    expect(scanCalls).toBe(1);
    await advance(INTERVAL - 1);
    expect(scanCalls).toBe(1); // still only the initial scan before 60s elapses

    scanResponder = () => Promise.resolve(jsonRes(scanBody(T2)));
    await advance(1);
    expect(scanCalls).toBe(2);
    expect(scannedText()).toContain("3:45"); // "Scanned {time}" updated
  });

  it("4. does not scan while the tab is hidden", async () => {
    await renderDashboard();
    expect(scanCalls).toBe(1);
    fireVisibility("hidden");
    await advance(INTERVAL * 3);
    expect(scanCalls).toBe(1); // no background scans while hidden
  });

  it("5. becoming visible triggers one prompt refresh and restarts the schedule", async () => {
    await renderDashboard();
    fireVisibility("hidden");
    await advance(INTERVAL * 2);
    expect(scanCalls).toBe(1);

    fireVisibility("visible");
    await flush();
    expect(scanCalls).toBe(2); // prompt refresh on resume

    await advance(INTERVAL);
    expect(scanCalls).toBe(3); // schedule resumed
  });

  it("6. repeated visibility events do not create duplicate timers/scans", async () => {
    await renderDashboard();
    // Fire several visible events (already visible); each completes one refresh.
    fireVisibility("visible");
    await flush();
    fireVisibility("visible");
    await flush();
    const afterVisibles = scanCalls;
    // A single interval must exist: exactly one more scan per 60s, not several.
    await advance(INTERVAL);
    expect(scanCalls).toBe(afterVisibles + 1);
  });

  it("7 + 8. a tick is skipped while a scan is unresolved, then a later tick works", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    scanResponder = () => gate.then(() => jsonRes(scanBody(T1)));

    render(<DashboardPage />); // initial scan starts but stays in flight (gate open)
    await flush();
    expect(scanCalls).toBe(1);

    await advance(INTERVAL);
    expect(scanCalls).toBe(1); // tick skipped — previous scan still in flight

    release();
    await flush(); // in-flight guard releases in finally

    scanResponder = () => Promise.resolve(jsonRes(scanBody(T2)));
    await advance(INTERVAL);
    expect(scanCalls).toBe(2); // later tick proceeds
  });

  it("17. clears the interval and visibilitychange listener on unmount", async () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<DashboardPage />);
    await flush();
    expect(scanCalls).toBe(1);

    unmount();
    expect(removeSpy.mock.calls.some((c) => c[0] === "visibilitychange")).toBe(true);

    await advance(INTERVAL * 3);
    expect(scanCalls).toBe(1); // no scans after unmount
  });
});

describe("dashboard auto-refresh — preserves user state", () => {
  async function expandRow() {
    fireEvent.click(screen.getByRole("button", { name: "Expand NVDA setup detail" }));
  }

  it("9. selected symbol (expanded row) survives a background refresh", async () => {
    await renderDashboard();
    await expandRow();
    expect(screen.getByRole("button", { name: "Collapse NVDA setup detail" })).toBeTruthy();

    scanResponder = () => Promise.resolve(jsonRes(scanBody(T2)));
    await advance(INTERVAL);

    expect(screen.getByRole("button", { name: "Collapse NVDA setup detail" })).toBeTruthy();
    expect(scannedText()).toContain("3:45"); // data did refresh…
  });

  it("10. selected timeframe survives a background refresh", async () => {
    await renderDashboard();
    await expandRow();
    fireEvent.click(screen.getByRole("button", { name: "15m" }));
    expect(screen.getByRole("button", { name: "15m" }).getAttribute("aria-pressed")).toBe("true");

    scanResponder = () => Promise.resolve(jsonRes(scanBody(T2)));
    await advance(INTERVAL);

    expect(screen.getByRole("button", { name: "15m" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("11 + 13. expanded checklist survives (background refresh does not reset it)", async () => {
    await renderDashboard();
    await expandRow();
    fireEvent.click(screen.getByRole("button", { name: /view full checklist/i }));
    expect(screen.getByRole("button", { name: /hide full checklist/i })).toBeTruthy();

    scanResponder = () => Promise.resolve(jsonRes(scanBody(T2)));
    await advance(INTERVAL);

    // Still open — the symbol/timeframe-keyed collapse effect did NOT fire.
    expect(screen.getByRole("button", { name: /hide full checklist/i })).toBeTruthy();
  });

  it("12. collapsed checklist stays collapsed across a background refresh", async () => {
    await renderDashboard();
    await expandRow();
    expect(screen.getByRole("button", { name: /view full checklist/i })).toBeTruthy();

    scanResponder = () => Promise.resolve(jsonRes(scanBody(T2)));
    await advance(INTERVAL);

    expect(screen.getByRole("button", { name: /view full checklist/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /hide full checklist/i })).toBeNull();
  });
});

describe("dashboard auto-refresh — failure handling", () => {
  it("14 + 15. a failed background refresh keeps last-good data and does not move the scan time", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderDashboard();
    const before = scannedText();
    expect(screen.getByText("NVDA")).toBeTruthy();

    scanResponder = () => Promise.resolve(errRes(500));
    await advance(INTERVAL);

    expect(screen.getByText("NVDA")).toBeTruthy(); // data preserved
    expect(scannedText()).toBe(before); // timestamp unchanged
    expect(screen.queryByText(/Scan failed/i)).toBeNull(); // no disruptive error state
    expect(errSpy).toHaveBeenCalled(); // logged, concisely
  });

  it("16. recovers on a later successful refresh after a failed one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await renderDashboard();

    scanResponder = () => Promise.resolve(errRes(500));
    await advance(INTERVAL); // fails, guard released in finally
    expect(scannedText()).toContain("2:32");

    scanResponder = () => Promise.resolve(jsonRes(scanBody(T2)));
    await advance(INTERVAL); // succeeds
    expect(scannedText()).toContain("3:45");
  });
});
