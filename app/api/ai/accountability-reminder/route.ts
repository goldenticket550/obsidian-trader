import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRiskSettings, getOrCreateTodayStatus } from "@/lib/risk/queries";
import { computeAccountabilityChecks } from "@/lib/risk/accountabilityEngine";
import { computeSessionInfo } from "@/lib/market-data/session";
import { callClaude, isAiConfigured } from "@/lib/ai/client";
import { buildAccountabilityReminderPrompt } from "@/lib/ai/prompts";

export async function GET() {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "Accountability reminders require ANTHROPIC_API_KEY to be configured." },
      { status: 501 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const settings = await getRiskSettings(supabase, user.id);
    const status = await getOrCreateTodayStatus(supabase, user.id);
    const session = computeSessionInfo();
    const checks = computeAccountabilityChecks({
      settings,
      status,
      session,
      now: new Date().toISOString(),
    });

    const { system, user: userPrompt } = buildAccountabilityReminderPrompt(checks, settings);
    const reminder = await callClaude(system, userPrompt, 150);

    return NextResponse.json({ reminder, checks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
