import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStrategyConfig } from "@/lib/strategies/config";
import type { AlertEvent } from "@/lib/alerts/types";

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  process: vi.fn(),
  recordCandidates: vi.fn(),
  buildReclaim: vi.fn(),
}));

const alert: AlertEvent = {
  id: "core-enqueue-failure-alert",
  ruleId: "score-threshold",
  type: "score_threshold",
  symbol: "NVDA",
  timeframe: "5m",
  message: "NVDA alert survives reporting failure",
  firedAt: "2026-08-08T04:00:00.000Z",
};

const setup = {
  symbol: "NVDA",
  timeframe: "5m",
  quality: "simulated",
  stage: "none",
  status: "red",
  score: 0,
  maxScore: 10,
  conditions: [],
  lastUpdated: alert.firedAt,
  latestCandleTime: null,
  convictionLevel: "watch",
  entryStatus: "wait_for_pullback",
  invalidationNote: null,
};

const scanResult = {
  watchlist: [{ symbol: "NVDA", exchange: "NASDAQ" }],
  resultsBySymbol: { NVDA: { "5m": setup, "15m": { ...setup, timeframe: "15m" } } },
  errors: [],
  reclaimBySymbol: {},
};

const db = {
  auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1" } } })) },
  from: vi.fn((table: string) => ({
    insert: vi.fn(async () =>
      table === "core_signal_outbox"
        ? { error: { code: "XX000", message: "forced outbox insert failure" } }
        : { error: null }
    ),
  })),
  rpc: vi.fn(async () => ({ data: [], error: null })),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/market-data/providerFactory", () => ({
  getMarketDataProvider: () => ({ name: "fixture" }),
}));
vi.mock("@/lib/scanner/scanService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scanner/scanService")>();
  return { ...actual, scanWatchlistWithProvider: (...args: unknown[]) => mocks.scan(...args) };
});
vi.mock("@/lib/alerts/persistentAlertStore", () => ({
  processResultPersistent: (...args: unknown[]) => mocks.process(...args),
  recordCandidatesPersistent: (...args: unknown[]) => mocks.recordCandidates(...args),
}));
vi.mock("@/lib/alerts/reclaimAlerts", () => ({
  buildReclaimAlertCandidates: (...args: unknown[]) => mocks.buildReclaim(...args),
}));
vi.mock("@/lib/watchlist/queries", () => ({
  getOrCreateDefaultWatchlist: async () => "watchlist-1",
  getWatchlistSymbols: async () => [{ symbol: "NVDA", exchange: "NASDAQ" }],
  getStrategyConfig: async () => defaultStrategyConfig,
  listAllWatchlists: async () => [{ id: "watchlist-1", userId: "user-1" }],
}));

import { GET as scanGet } from "@/app/api/scan/route";
import { GET as cronGet } from "@/app/api/cron/scan/route";
import { recordAndEnqueueHealth } from "@/lib/core/reporting";

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://trader-staging.example";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.CRON_SECRET = "cron-test";
  process.env.OBSIDIAN_CORE_INGEST_URL = "https://core-staging.example/ingest";
  process.env.OBSIDIAN_CORE_KEY_ID = "trader-test";
  process.env.OBSIDIAN_CORE_REPORTING_KEY = "reporting-test";
  mocks.scan.mockReset().mockResolvedValue(scanResult);
  mocks.process.mockReset().mockResolvedValue([alert]);
  mocks.recordCandidates.mockReset().mockResolvedValue([]);
  mocks.buildReclaim.mockReset().mockReturnValue({ events: [], rules: [] });
  db.from.mockClear();
  db.rpc.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("Core outbox enqueue failure isolation", () => {
  it("does not touch run reports or the outbox when Core reporting is unconfigured", async () => {
    delete process.env.OBSIDIAN_CORE_INGEST_URL;
    delete process.env.OBSIDIAN_CORE_KEY_ID;
    delete process.env.OBSIDIAN_CORE_REPORTING_KEY;

    await recordAndEnqueueHealth(db, {
      scannedAt: "2026-08-08T04:00:00.000Z",
      provider: "fixture",
      usersScanned: 1,
      results: [],
    });

    expect(db.from).not.toHaveBeenCalled();
  });

  it("keeps /api/scan successful and preserves its real alerts", async () => {
    const response = await scanGet();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.newAlerts).toHaveLength(2);
    expect(body.newAlerts.every((event: AlertEvent) => event.id === alert.id)).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it("keeps the cron user's real result and returns 200", async () => {
    const request = new Request("http://localhost/api/cron/scan", {
      headers: { authorization: "Bearer cron-test" },
    });
    const response = await cronGet(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.usersScanned).toBe(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].error).toBeUndefined();
    expect(body.results[0]).toMatchObject({
      symbolsAttempted: 1,
      symbolsSucceeded: 1,
      symbolsFailed: 0,
      alertsFired: 2,
    });
    expect(console.error).toHaveBeenCalled();
  });
});
