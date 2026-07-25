import { describe, it, expect, vi } from "vitest";
import { getRiskSettings, upsertRiskSettings } from "@/lib/risk/queries";
import { defaultRiskSettings } from "@/lib/risk/defaults";

function makeFakeSupabaseForRead(minSetupScoreInDb: number) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: {
              max_trades_per_day: 3,
              max_loss_per_day: "400",
              daily_profit_target: "300",
              max_risk_per_trade: "200",
              min_setup_score: minSetupScoreInDb,
              min_minutes_between_trades: 15,
              allowed_sessions: ["regular"],
              block_after_target: true,
              block_after_loss_limit: true,
            },
            error: null,
          })),
        })),
      })),
    })),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("getRiskSettings clamps stale/legacy scores on read", () => {
  it("clamps a legacy min_setup_score above 10 down to 10", async () => {
    const supabase = makeFakeSupabaseForRead(14);
    const settings = await getRiskSettings(supabase, "user_1");
    expect(settings.minSetupScore).toBe(10);
  });

  it("leaves an already-valid min_setup_score unchanged", async () => {
    const supabase = makeFakeSupabaseForRead(6);
    const settings = await getRiskSettings(supabase, "user_1");
    expect(settings.minSetupScore).toBe(6);
  });
});

describe("upsertRiskSettings validates before writing", () => {
  it("clamps an out-of-range value before it reaches the database", async () => {
    const upsertSpy = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({ upsert: upsertSpy })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await upsertRiskSettings(supabase, "user_1", { ...defaultRiskSettings, minSetupScore: 14 });

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ min_setup_score: 10 }),
      expect.anything()
    );
  });

  it("rejects NaN before ever calling the database", async () => {
    const upsertSpy = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({ upsert: upsertSpy })),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await expect(
      upsertRiskSettings(supabase, "user_1", { ...defaultRiskSettings, minSetupScore: NaN })
    ).rejects.toThrow();
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});
