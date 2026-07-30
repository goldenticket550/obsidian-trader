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

/**
 * Models the one behaviour of real `fetch` that the timeout depends on:
 * an aborted request REJECTS with an AbortError rather than hanging. A
 * mock that ignored `init.signal` would make a hung-fetch test pass for
 * the wrong reason — the request would simply never settle and the
 * timeout would look untested. Everything else (the 30s timer, the
 * rejection path, releasing the in-flight guard) is the real code.
 */
function withAbort(promise: Promise<Response>, signal?: AbortSignal): Promise<Response> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return Promise.race([
    promise,
    new Promise<Response>((_, reject) => {
      signal.addEventListener("abort", () => reject(abortError()), { once: true });
    }),
  ]);
}
function abortError(): Error {
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}
/** A request that never settles on its own — only an abort can end it. */
function hangForever(): Promise<Response> {
  return new Promise<Response>(() => {});
}

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
  global.fetch = vi.fn((input: unknown, init?: { signal?: AbortSignal }) => {
    const url = String(input);
    let result: Promise<Response>;
    if (url.startsWith("/api/scan")) {
      scanCalls += 1;
      result = scanResponder();
    } else if (url.startsWith("/api/alerts")) result = Promise.resolve(jsonRes({ events: [] }));
    else if (url.startsWith("/api/market-context")) result = Promise.resolve(jsonRes({ quotes: [] }));
    else if (url.startsWith("/api/risk")) result = Promise.resolve(errRes()); // keep risk null (no fixture needed)
    else result = Promise.resolve(jsonRes({}));
    return withAbort(result, init?.signal);
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

  it("7 + 8. a refresh is skipped while a scan is unresolved, then a later tick works", async () => {
    // Overlap prevention is unchanged, but this case had to be rewritten
    // when SCAN_FETCH_TIMEOUT_MS was added. It used to hold a scan in
    // flight across a full 60s interval to prove the tick was skipped —
    // which is now impossible on purpose: a request is aborted at 30s, so
    // it can never still be pending when the next tick arrives at 60s.
    // That unbounded-hang scenario WAS the stall bug (see cases 18-22).
    // The guard's remaining job is races inside the timeout window, so a
    // visibility-resume refresh competing with an in-flight scan is used
    // here instead — a real path that still exists.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    scanResponder = () => gate.then(() => jsonRes(scanBody(T1)));

    render(<DashboardPage />); // initial scan starts but stays in flight (gate open)
    await flush();
    expect(scanCalls).toBe(1);

    await advance(5_000); // well inside the 30s timeout
    fireVisibility("visible"); // would normally prompt an immediate refresh
    await flush();
    expect(scanCalls).toBe(1); // skipped — previous scan still in flight

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

describe("dashboard auto-refresh — a hung request cannot stall the dashboard forever", () => {
  const TIMEOUT = 30_000; // SCAN_FETCH_TIMEOUT_MS in app/page.tsx

  it("18. a fetch that never resolves times out, releases the guard, and a later tick scans normally", async () => {
    // The exact stall scenario: the request never settles on its own.
    // Before the timeout existed, the in-flight guard stayed true forever
    // and every subsequent tick silently no-opped for the life of the tab.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    scanResponder = hangForever;

    render(<DashboardPage />);
    await flush();
    expect(scanCalls).toBe(1);

    // Still hung, still inside the timeout budget: the guard correctly
    // holds and nothing new is started.
    await advance(TIMEOUT - 1_000);
    expect(scanCalls).toBe(1);

    // Past the timeout the abort fires and the guard releases in `finally`.
    // Before this fix the guard stayed true here for the life of the tab.
    await advance(2_000);
    scanResponder = () => Promise.resolve(jsonRes(scanBody(T2)));

    // Recovery: the next scheduled tick scans normally again.
    await advance(INTERVAL);
    expect(scanCalls).toBe(2);

    consoleError.mockRestore();
  });

  it("19. the dashboard keeps rendering last-good data through a hung refresh", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderDashboard(); // good data on screen
    expect(scannedText()).toContain("2:32");

    scanResponder = hangForever;
    await advance(INTERVAL); // background refresh hangs…
    await advance(TIMEOUT); // …and times out

    // Last-known-good data survives; no error is surfaced to the user and
    // the scan timestamp is not disturbed by a failed background refresh.
    expect(screen.getByText("NVDA")).toBeTruthy();
    expect(scannedText()).toContain("2:32");
    expect(screen.queryByText(/timed out/i)).toBeNull();

    consoleError.mockRestore();
  });

  it("20. a timeout reports through the existing background-failure path, not a new one", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderDashboard();

    scanResponder = hangForever;
    await advance(INTERVAL);
    await advance(TIMEOUT);

    // Same `[dashboard] background {label} refresh failed:` channel every
    // other background failure already used — one path, not two.
    const logged = consoleError.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[dashboard] background scan refresh failed");
    expect(logged).toContain("timed out after 30s");

    consoleError.mockRestore();
  });

  it("21. a slow-but-valid response inside the timeout is NOT killed", async () => {
    // Guards against picking a timeout so tight it breaks legitimate scans:
    // a response arriving well after a normal scan still succeeds.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    scanResponder = () => gate.then(() => jsonRes(scanBody(T2)));

    await renderDashboard();
    await advance(TIMEOUT - 5_000); // 25s in — still inside the 30s budget
    release();
    await flush();

    expect(scannedText()).toContain("3:45"); // applied, not aborted
  });

  it("22. a hang on /api/alerts alone also recovers", async () => {
    // The in-flight guard is released only after ALL THREE requests settle,
    // so a hang on any one of them stalls the whole dashboard. The timeout
    // is applied to each for that reason.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalFetch = global.fetch;
    global.fetch = vi.fn((input: unknown, init?: { signal?: AbortSignal }) => {
      const url = String(input);
      if (url.startsWith("/api/alerts")) return withAbort(hangForever(), init?.signal);
      return (originalFetch as unknown as (i: unknown, n?: unknown) => Promise<Response>)(input, init);
    }) as unknown as typeof fetch;

    render(<DashboardPage />);
    await flush();
    expect(scanCalls).toBe(1);

    await advance(TIMEOUT - 1_000);
    expect(scanCalls).toBe(1); // stalled on the alerts hang, inside the budget

    await advance(2_000); // alerts request times out, guard releases
    await advance(INTERVAL);
    expect(scanCalls).toBe(2); // recovered

    consoleError.mockRestore();
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
