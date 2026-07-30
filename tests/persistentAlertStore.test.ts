import { describe, it, expect, vi } from "vitest";
import { processResultPersistent, getRecentAlertEvents } from "@/lib/alerts/persistentAlertStore";
import { defaultAlertRules } from "@/lib/alerts/defaultRules";
import type { SetupResult } from "@/types/setup";

function makeResult(score: number): SetupResult {
  return {
    symbol: "NVDA",
    timeframe: "5m",
    quality: "simulated",
    stage: "none",
    status: "yellow",
    score,
    maxScore: 11,
    conditions: [],
    lastUpdated: "2026-07-13T00:00:00Z",
  };
}

/** Builds a fake Supabase client with configurable per-table behavior. */
function makeFakeSupabase(opts: {
  snapshot?: unknown;
  onCooldown?: boolean;
  insertSpy?: ReturnType<typeof vi.fn>;
  upsertSpy?: ReturnType<typeof vi.fn>;
}) {
  const insertSpy = opts.insertSpy ?? vi.fn(async () => ({ error: null }));
  const upsertSpy = opts.upsertSpy ?? vi.fn(async () => ({ error: null }));

  return {
    from: vi.fn((table: string) => {
      if (table === "scan_snapshots") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: opts.snapshot ? { result: opts.snapshot } : null,
                    error: null,
                  })),
                })),
              })),
            })),
          })),
          upsert: upsertSpy,
        };
      }
      if (table === "alert_events") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    gte: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        maybeSingle: vi.fn(async () => ({
                          data: opts.onCooldown ? { id: "existing" } : null,
                          error: null,
                        })),
                      })),
                    })),
                  })),
                })),
              })),
            })),
          })),
          insert: insertSpy,
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({
              data: [],
              error: null,
            })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("processResultPersistent", () => {
  it("fires nothing and saves a snapshot on the first-ever scan for a symbol", async () => {
    const upsertSpy = vi.fn(async () => ({ error: null }));
    const supabase = makeFakeSupabase({ snapshot: undefined, upsertSpy });

    const events = await processResultPersistent(supabase, "user_1", makeResult(0), defaultAlertRules);
    expect(events).toEqual([]);
    expect(upsertSpy).toHaveBeenCalled();
  });

  it("records a surviving event when a real transition occurs with no cooldown history", async () => {
    const previousResult = makeResult(6); // below the 0-10 scale score threshold (7)
    const insertSpy = vi.fn(async () => ({ error: null }));
    const supabase = makeFakeSupabase({ snapshot: previousResult, onCooldown: false, insertSpy });

    const events = await processResultPersistent(supabase, "user_1", makeResult(7), defaultAlertRules);
    expect(events.some((e) => e.type === "score_threshold")).toBe(true);
    expect(insertSpy).toHaveBeenCalled();
  });

  it("suppresses an event that's on cooldown", async () => {
    const previousResult = makeResult(6);
    const insertSpy = vi.fn(async () => ({ error: null }));
    const supabase = makeFakeSupabase({ snapshot: previousResult, onCooldown: true, insertSpy });

    const events = await processResultPersistent(supabase, "user_1", makeResult(7), defaultAlertRules);
    expect(events.some((e) => e.type === "score_threshold")).toBe(false);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("scan_snapshots.updated_at reflects the LAST write, not the first", () => {
  /**
   * The column is `default now()`, and a DEFAULT only fires on INSERT --
   * so before this fix an upsert that rewrote the same row every 60s left
   * updated_at frozen at first-insert time while its name promised the
   * opposite. Observed live: an ARM 5m snapshot written at 16:56 UTC still
   * read 13:11 UTC, 226 minutes stale.
   *
   * These cases prove the APPLICATION-level half of the fix (the explicit
   * value in the upsert payload). The database trigger added in migration
   * 0007 is the other half and cannot be exercised here -- these tests run
   * against a fake Supabase client, with no Postgres in the test
   * environment, so no trigger can fire. The trigger still needs manual
   * verification against the real database once the migration is applied;
   * see the migration's own header for what it does.
   */
  function upsertPayload(spy: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
    return spy.mock.calls[call][0] as Record<string, unknown>;
  }

  it("writes an explicit updated_at rather than relying on the column default", async () => {
    const upsertSpy = vi.fn(async () => ({ error: null }));
    const supabase = makeFakeSupabase({ snapshot: undefined, upsertSpy });
    const now = new Date("2026-07-30T16:56:08.943Z");

    await processResultPersistent(supabase, "user_1", makeResult(0), defaultAlertRules, now);

    expect(upsertPayload(upsertSpy)).toMatchObject({
      user_id: "user_1",
      symbol: "NVDA",
      timeframe: "5m",
      updated_at: "2026-07-30T16:56:08.943Z",
    });
  });

  it("a second upsert to the SAME key records a materially later updated_at", async () => {
    // The exact scenario the old code got wrong: same user/symbol/timeframe,
    // rewritten later. The second write must not carry the first one's time.
    const upsertSpy = vi.fn(async () => ({ error: null }));
    const first = new Date("2026-07-30T13:11:28.495Z");
    const second = new Date("2026-07-30T16:56:08.943Z"); // +3h44m, the real observed drift

    const supabase = makeFakeSupabase({ snapshot: undefined, upsertSpy });
    await processResultPersistent(supabase, "user_1", makeResult(0), defaultAlertRules, first);
    await processResultPersistent(supabase, "user_1", makeResult(0), defaultAlertRules, second);

    expect(upsertSpy).toHaveBeenCalledTimes(2);
    const t1 = new Date(upsertPayload(upsertSpy, 0).updated_at as string).getTime();
    const t2 = new Date(upsertPayload(upsertSpy, 1).updated_at as string).getTime();

    expect(t2).toBeGreaterThan(t1);
    expect(t2 - t1).toBe(13_480_448); // 3h44m40.448s — materially later, not a rounding artifact
  });

  it("targets the same conflict key, so the second write updates rather than inserts a duplicate", async () => {
    const upsertSpy = vi.fn(async () => ({ error: null }));
    const supabase = makeFakeSupabase({ snapshot: undefined, upsertSpy });

    await processResultPersistent(supabase, "user_1", makeResult(0), defaultAlertRules, new Date());

    // Confirms the UPDATE path is the one taken on rewrite — which is also
    // precisely the path migration 0007's BEFORE UPDATE trigger covers.
    // (Cast because the zero-arg mock signature gives `calls` an empty
    // tuple type, so indexing past 0 is a compile error without it.)
    const [, options] = upsertSpy.mock.calls[0] as unknown as [unknown, unknown];
    expect(options).toEqual({ onConflict: "user_id,symbol,timeframe" });
  });
});

describe("getRecentAlertEvents", () => {
  it("maps rows to AlertEvent shape", async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(async () => ({
                data: [
                  {
                    id: "evt_1",
                    rule_id: "score_threshold",
                    alert_type: "score_threshold",
                    symbol: "NVDA",
                    timeframe: "5m",
                    message: "test message",
                    fired_at: "2026-07-13T00:00:00Z",
                  },
                ],
                error: null,
              })),
            })),
          })),
        })),
      })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const events = await getRecentAlertEvents(supabase, "user_1");
    expect(events.length).toBe(1);
    expect(events[0].id).toBe("evt_1");
    expect(events[0].type).toBe("score_threshold");
  });
});
