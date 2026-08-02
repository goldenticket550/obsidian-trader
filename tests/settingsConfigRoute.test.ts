import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The configuration BOUNDARY.
 *
 * Two separate guarantees, both about never letting an unchecked value
 * reach the detector:
 *
 *  - the write side (PUT) rejects a malformed body and persists nothing;
 *  - the read side rejects a stored configuration that is present and
 *    invalid, rather than quietly scoring with a threshold nobody chose.
 */

const upsertStrategyConfig = vi.fn();
const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/watchlist/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/watchlist/queries")>();
  return {
    ...actual,
    upsertStrategyConfig: (...args: unknown[]) => upsertStrategyConfig(...args),
  };
});

import { PUT } from "@/app/api/settings/config/route";
import { getStrategyConfig } from "@/lib/watchlist/queries";
import { defaultStrategyConfig } from "@/lib/strategies/config";

function put(body: unknown, raw?: string): Request {
  return new Request("http://localhost/api/settings/config", {
    method: "PUT",
    body: raw ?? JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** A stubbed Supabase whose stored config row is whatever is passed in. */
function supabaseReturning(config: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { config }, error: null }),
        }),
      }),
    }),
  } as never;
}

beforeEach(() => {
  upsertStrategyConfig.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("PUT /api/settings/config — invalid bodies", () => {
  it("rejects a body that is not valid JSON, and persists nothing", async () => {
    const response = await PUT(put(undefined, "{not json"));
    expect(response.status).toBe(400);
    expect(upsertStrategyConfig).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["a string", "config"],
    ["a number", 42],
    ["an array", [{ reclaimContinuation: {} }]],
    ["a boolean", true],
  ])("rejects %s as a configuration, and persists nothing", async (_label, body) => {
    const response = await PUT(put(body));
    expect(response.status).toBe(400);
    expect(upsertStrategyConfig).not.toHaveBeenCalled();
  });

  it("rejects a present-but-invalid Reclaim value, and persists nothing", async () => {
    const response = await PUT(
      put({
        ...defaultStrategyConfig,
        reclaimContinuation: {
          ...defaultStrategyConfig.reclaimContinuation,
          // A negative ATR multiple is not a tighter threshold, it is
          // nonsense — it must not be silently repaired.
          minResetAtr: -1,
        },
      })
    );

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { fieldErrors?: { field: string }[] };
    expect(payload.fieldErrors?.some((e) => e.field === "reclaimContinuation.minResetAtr")).toBe(
      true
    );
    expect(upsertStrategyConfig).not.toHaveBeenCalled();
  });

  it("persists the NORMALIZED config, never the raw request body", async () => {
    // A body omitting most of the Reclaim block is legitimate — omitted
    // means "use the default" — but what gets stored must be the complete
    // normalized block, not the short object that arrived.
    const response = await PUT(
      put({ ...defaultStrategyConfig, reclaimContinuation: { enabled: true } })
    );

    expect(response.status).toBe(200);
    expect(upsertStrategyConfig).toHaveBeenCalledTimes(1);
    const stored = upsertStrategyConfig.mock.calls[0][2] as typeof defaultStrategyConfig;
    expect(stored.reclaimContinuation.alertingEnabled).toBe(false);
    expect(stored.reclaimContinuation.newResetMaxAgeBars).toBe(
      defaultStrategyConfig.reclaimContinuation.newResetMaxAgeBars
    );
  });

  it("never turns alerting on by default when a caller omits the flag", async () => {
    await PUT(put({ ...defaultStrategyConfig, reclaimContinuation: { enabled: true } }));
    const stored = upsertStrategyConfig.mock.calls[0][2] as typeof defaultStrategyConfig;
    expect(stored.reclaimContinuation.alertingEnabled).toBe(false);
  });
});

describe("stored configuration is validated on read", () => {
  it("rejects a stored config whose Reclaim value is present and invalid", async () => {
    await expect(
      getStrategyConfig(supabaseReturning({
        ...defaultStrategyConfig,
        reclaimContinuation: {
          ...defaultStrategyConfig.reclaimContinuation,
          minResetAtr: -1,
        },
      }), "user-1")
    ).rejects.toThrow(/Stored strategy configuration is invalid/);
  });

  it("accepts a legacy stored config that simply predates newer keys", async () => {
    // Missing is not invalid: an old row normalizes to the defaults.
    const { reclaimContinuation, ...legacy } = defaultStrategyConfig;
    void reclaimContinuation;
    const config = await getStrategyConfig(supabaseReturning(legacy), "user-1");
    expect(config.reclaimContinuation.enabled).toBe(
      defaultStrategyConfig.reclaimContinuation.enabled
    );
    expect(config.reclaimContinuation.alertingEnabled).toBe(false);
  });
});
