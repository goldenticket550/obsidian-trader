import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Reclaim emission AT THE ROUTE — the layer that actually decides to
 * alert, and the layer where an exception could take the scan down.
 *
 * Runs the no-Supabase fallback path (the in-memory store), which is the
 * same code path with the same store and the same cooldown tracker,
 * without needing a database double.
 */

const scanWatchlistWithProvider = vi.fn();
const buildReclaimAlertCandidates = vi.fn();

vi.mock("@/lib/market-data/providerFactory", () => ({
  getMarketDataProvider: () => ({ name: "fixture" }),
}));

vi.mock("@/lib/scanner/scanService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scanner/scanService")>();
  return { ...actual, scanWatchlistWithProvider: (...a: unknown[]) => scanWatchlistWithProvider(...a) };
});

vi.mock("@/lib/alerts/reclaimAlerts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alerts/reclaimAlerts")>();
  return {
    ...actual,
    buildReclaimAlertCandidates: (...a: unknown[]) => buildReclaimAlertCandidates(...a),
  };
});

import { GET } from "@/app/api/scan/route";
import { getAlertStore } from "@/lib/alerts/alertStore";
import type { SetupResult } from "@/types/setup";
import type { AlertEvent } from "@/lib/alerts/types";

const NOW = "2026-07-13T14:00:00.000Z";

function setup(state: "fail" | "pass"): SetupResult {
  return {
    symbol: "NVDA",
    timeframe: "5m",
    quality: "simulated",
    stage: "none",
    status: "red",
    score: 0,
    maxScore: 10,
    conditions: [
      { id: "recovery_from_low", label: "Recovery", required: true, category: "core", state, detail: "" },
    ],
    lastUpdated: NOW,
    latestCandleTime: null,
    convictionLevel: "watch",
    entryStatus: "wait_for_pullback",
    invalidationNote: null,
  };
}

function scanResult(state: "fail" | "pass") {
  return {
    watchlist: [{ symbol: "NVDA", exchange: "NASDAQ" }],
    resultsBySymbol: { NVDA: { "5m": setup(state), "15m": setup(state) } },
    errors: [],
    reclaimBySymbol: { NVDA: { symbol: "NVDA" } },
  };
}

const reclaimEvent: AlertEvent = {
  id: "evt_reclaim_1",
  ruleId: "reclaim_review_now:NVDA:2026-07-13:bullish:1:2",
  type: "reclaim_review_now",
  symbol: "NVDA",
  timeframe: "5m",
  message: "NVDA (5m) Reclaim & Continuation — review criteria met",
  firedAt: NOW,
};
const reclaimRule = {
  id: reclaimEvent.ruleId,
  type: "reclaim_review_now" as const,
  label: "Reclaim",
  enabled: true,
  cooldownMs: 86_400_000,
};

const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

beforeEach(() => {
  // Force the no-Supabase fallback branch.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  getAlertStore().clear();
  scanWatchlistWithProvider.mockReset();
  buildReclaimAlertCandidates.mockReset();
  buildReclaimAlertCandidates.mockReturnValue({ events: [], rules: [] });
});

afterEach(() => {
  if (savedUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
  if (savedKey !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey;
  vi.restoreAllMocks();
});

/**
 * Primes the store so the second scan produces a real reversal edge.
 *
 * Reclaim emission is introduced only AFTER priming: the priming scan is
 * a real scan, so letting it emit the same event would legitimately put
 * that setup on cooldown and the scan under test would then correctly
 * emit nothing.
 */
async function primeThenScan(onPrimed: () => void = () => {}) {
  buildReclaimAlertCandidates.mockReturnValue({ events: [], rules: [] });
  scanWatchlistWithProvider.mockResolvedValue(scanResult("fail"));
  await GET();

  onPrimed();
  scanWatchlistWithProvider.mockResolvedValue(scanResult("pass"));
  return GET();
}

const emitsReclaim = () =>
  buildReclaimAlertCandidates.mockReturnValue({ events: [reclaimEvent], rules: [reclaimRule] });

describe("reclaim emission at /api/scan", () => {
  it("puts Reclaim alerts into newAlerts alongside reversal alerts", async () => {
    const body = await (await primeThenScan(emitsReclaim)).json();
    const types = body.newAlerts.map((e: AlertEvent) => e.type);

    // Precondition: a reversal alert fired too, so this is a genuine
    // "both present" assertion.
    expect(types).toContain("recovery_from_low");
    expect(types).toContain("reclaim_review_now");
    expect(body.newAlerts.filter((e: AlertEvent) => e.type === "reclaim_review_now")).toHaveLength(1);
  });

  it("emits no Reclaim alert when the builder produces none", async () => {
    const body = await (await primeThenScan()).json();
    expect(body.newAlerts.some((e: AlertEvent) => e.type === "reclaim_review_now")).toBe(false);
    // The reversal alert is unaffected.
    expect(body.newAlerts.some((e: AlertEvent) => e.type === "recovery_from_low")).toBe(true);
  });

  it("a thrown Reclaim emission error leaves the scan and reversal alerts intact", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await primeThenScan(() =>
      buildReclaimAlertCandidates.mockImplementation(() => {
        throw new Error("reclaim emission exploded");
      })
    );
    const body = await response.json();

    // The scan itself succeeded.
    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.resultsBySymbol.NVDA["5m"].symbol).toBe("NVDA");
    // Reversal alerts still fired.
    expect(body.newAlerts.some((e: AlertEvent) => e.type === "recovery_from_low")).toBe(true);
    // Only the Reclaim alert was lost, and the failure was reported.
    expect(body.newAlerts.some((e: AlertEvent) => e.type === "reclaim_review_now")).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it("reversal alerts are identical whether Reclaim emits or not", async () => {
    const without = await (await primeThenScan()).json();

    getAlertStore().clear();
    const with_ = await (await primeThenScan(emitsReclaim)).json();

    const reversalOnly = (b: { newAlerts: AlertEvent[] }) =>
      b.newAlerts
        .filter((e) => e.type !== "reclaim_review_now")
        .map((e) => [e.type, e.symbol, e.timeframe, e.message]);

    expect(reversalOnly(without).length).toBeGreaterThan(0);
    expect(reversalOnly(with_)).toEqual(reversalOnly(without));
  });

  it("emits Reclaim alerts after reversal alerts are already recorded", async () => {
    // Ordering matters for isolation: by the time Reclaim runs, every
    // reversal alert is committed and cannot be affected by it.
    const body = await (await primeThenScan(emitsReclaim)).json();
    const types = body.newAlerts.map((e: AlertEvent) => e.type);
    expect(types.indexOf("reclaim_review_now")).toBe(types.length - 1);
  });

  it("passes the scan's own Reclaim output and config to the builder", async () => {
    await primeThenScan();
    expect(buildReclaimAlertCandidates).toHaveBeenCalled();
    const [reclaimBySymbol, config] = buildReclaimAlertCandidates.mock.calls[0];
    expect(reclaimBySymbol).toEqual({ NVDA: { symbol: "NVDA" } });
    expect(config).toHaveProperty("alertingEnabled");
  });
});
