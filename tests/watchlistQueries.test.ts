import { describe, it, expect, vi } from "vitest";
import {
  getStrategyConfig,
  addWatchlistSymbol,
  getOrCreateDefaultWatchlist,
} from "@/lib/watchlist/queries";
import { defaultStrategyConfig } from "@/lib/strategies/config";

/**
 * A minimal fake matching the subset of the Supabase query-builder chain
 * these functions actually use. Not a full mock of the SDK — just enough
 * to test our logic (default-merging, normalization, duplicate handling)
 * without a live database.
 */
function makeFakeSupabase(responses: {
  select?: { data: unknown; error: unknown };
  insert?: { data: unknown; error: unknown };
}) {
  const chain: Record<string, unknown> = {};
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(async () => responses.insert ?? { data: null, error: null }),
    maybeSingle: vi.fn(async () => responses.select ?? { data: null, error: null }),
  };
  chain.from = vi.fn(() => builder);
  return chain as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("getStrategyConfig", () => {
  it("returns built-in defaults when the user has no saved config", async () => {
    const supabase = makeFakeSupabase({ select: { data: null, error: null } });
    const config = await getStrategyConfig(supabase, "user_1");
    expect(config).toEqual(defaultStrategyConfig);
  });

  it("merges a saved partial config over the defaults", async () => {
    const savedPartial = { emaReclaim: { ...defaultStrategyConfig.emaReclaim, period: 21 } };
    const supabase = makeFakeSupabase({
      select: { data: { config: savedPartial }, error: null },
    });
    const config = await getStrategyConfig(supabase, "user_1");
    expect(config.emaReclaim.period).toBe(21);
    // Untouched sections still come from defaults.
    expect(config.fairValueGap).toEqual(defaultStrategyConfig.fairValueGap);
  });

  it("throws a clear error when the fetch fails", async () => {
    const supabase = makeFakeSupabase({
      select: { data: null, error: { message: "connection refused" } },
    });
    await expect(getStrategyConfig(supabase, "user_1")).rejects.toThrow(/connection refused/);
  });
});

describe("addWatchlistSymbol", () => {
  it("normalizes symbol to uppercase and trims whitespace", async () => {
    const insertSpy = vi.fn(() => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({ insert: insertSpy })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await addWatchlistSymbol(supabase, "wl_1", "  nvda  ", "NASDAQ");
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "NVDA", watchlist_id: "wl_1" })
    );
  });

  it("treats a duplicate-symbol error (23505) as a silent no-op", async () => {
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({ error: { code: "23505", message: "duplicate" } })),
      })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await expect(addWatchlistSymbol(supabase, "wl_1", "NVDA", "NASDAQ")).resolves.toBeUndefined();
  });

  it("throws on a real (non-duplicate) database error", async () => {
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({ error: { code: "500", message: "server error" } })),
      })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await expect(addWatchlistSymbol(supabase, "wl_1", "NVDA", "NASDAQ")).rejects.toThrow(
      /server error/
    );
  });

  it("rejects an empty symbol without hitting the database", async () => {
    const insertSpy = vi.fn();
    const supabase = {
      from: vi.fn(() => ({ insert: insertSpy })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await expect(addWatchlistSymbol(supabase, "wl_1", "   ", "NASDAQ")).rejects.toThrow(
      /cannot be empty/
    );
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("getOrCreateDefaultWatchlist", () => {
  it("returns the existing watchlist id without creating a new one", async () => {
    const supabase = makeFakeSupabase({ select: { data: { id: "existing_id" }, error: null } });
    const id = await getOrCreateDefaultWatchlist(supabase, "user_1");
    expect(id).toBe("existing_id");
  });

  it("creates a new watchlist when none exists yet", async () => {
    const supabase = makeFakeSupabase({
      select: { data: null, error: null },
      insert: { data: { id: "new_id" }, error: null },
    });
    const id = await getOrCreateDefaultWatchlist(supabase, "user_1");
    expect(id).toBe("new_id");
  });
});
