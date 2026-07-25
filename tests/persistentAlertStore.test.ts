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
