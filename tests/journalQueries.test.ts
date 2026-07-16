import { describe, it, expect, vi } from "vitest";
import { recomputeDailyStatusFromJournal } from "@/lib/journal/queries";

describe("recomputeDailyStatusFromJournal", () => {
  it("sums profit_loss and counts rows correctly, then upserts", () => {
    const upsertSpy = vi.fn(() => ({ error: null }));
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "trade_journal_entries") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: [
                    { profit_loss: "100.50", created_at: "2026-07-13T14:00:00Z" },
                    { profit_loss: "-40.25", created_at: "2026-07-13T15:00:00Z" },
                  ],
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "daily_trading_status") {
          return { upsert: upsertSpy };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    return recomputeDailyStatusFromJournal(supabase, "user_1", "2026-07-13").then(() => {
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user_1",
          trade_date: "2026-07-13",
          trades_taken: 2,
          realized_pnl: 60.25,
          last_trade_at: "2026-07-13T15:00:00Z", // the later of the two
        }),
        expect.objectContaining({ onConflict: "user_id,trade_date" })
      );
    });
  });

  it("zeroes out the day when there are no entries left (e.g. after a delete)", () => {
    const upsertSpy = vi.fn(() => ({ error: null }));
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "trade_journal_entries") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ data: [], error: null })),
              })),
            })),
          };
        }
        if (table === "daily_trading_status") {
          return { upsert: upsertSpy };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    return recomputeDailyStatusFromJournal(supabase, "user_1", "2026-07-13").then(() => {
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ trades_taken: 0, realized_pnl: 0, last_trade_at: null }),
        expect.anything()
      );
    });
  });

  it("throws a clear error when the fetch fails", async () => {
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: null, error: { message: "db unavailable" } })),
          })),
        })),
      })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await expect(
      recomputeDailyStatusFromJournal(supabase, "user_1", "2026-07-13")
    ).rejects.toThrow(/db unavailable/);
  });
});
