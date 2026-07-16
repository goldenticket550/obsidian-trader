import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listJournalEntries } from "@/lib/journal/queries";
import { computeJournalStatistics } from "@/lib/journal/statistics";
import { callClaude, isAiConfigured } from "@/lib/ai/client";
import { buildPatternAnalysisPrompt, hasEnoughDataForPatternAnalysis } from "@/lib/ai/prompts";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const entries = await listJournalEntries(supabase, user.id);

    // Per the spec: "Do not add advanced AI analysis until enough
    // journal data exists." This check happens BEFORE isAiConfigured()
    // or any API call — insufficient data is a real, expected state,
    // not an error, and we don't want to spend an API call finding
    // that out.
    if (!hasEnoughDataForPatternAnalysis(entries.length)) {
      return NextResponse.json({
        available: false,
        entryCount: entries.length,
        message:
          "Not enough journal entries yet for meaningful pattern analysis. Keep logging trades.",
      });
    }

    if (!isAiConfigured()) {
      return NextResponse.json(
        { error: "Pattern analysis requires ANTHROPIC_API_KEY to be configured." },
        { status: 501 }
      );
    }

    const stats = computeJournalStatistics(entries);
    const { system, user: userPrompt } = buildPatternAnalysisPrompt(entries, stats);
    const analysis = await callClaude(system, userPrompt, 600);

    return NextResponse.json({ available: true, analysis, entryCount: entries.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
