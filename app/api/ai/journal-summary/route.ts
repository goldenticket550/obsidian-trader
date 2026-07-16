import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listJournalEntries } from "@/lib/journal/queries";
import { computeJournalStatistics } from "@/lib/journal/statistics";
import { callClaude, isAiConfigured } from "@/lib/ai/client";
import { buildEndOfDaySummaryPrompt } from "@/lib/ai/prompts";

export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI summaries require ANTHROPIC_API_KEY to be configured." },
      { status: 501 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = await request.json();
    const date = typeof body.date === "string" ? body.date : new Date().toISOString().slice(0, 10);

    const allEntries = await listJournalEntries(supabase, user.id);
    const dayEntries = allEntries.filter((e) => e.tradeDate === date);

    if (dayEntries.length === 0) {
      return NextResponse.json(
        { error: `No journal entries found for ${date}` },
        { status: 404 }
      );
    }

    const stats = computeJournalStatistics(dayEntries);
    const { system, user: userPrompt } = buildEndOfDaySummaryPrompt(dayEntries, stats, date);
    const summary = await callClaude(system, userPrompt, 400);

    return NextResponse.json({ summary, stats });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
