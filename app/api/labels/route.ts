import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listJournalEntries } from "@/lib/journal/queries";
import { generateLabelCandidates, labelsFromExecutedTrades } from "@/lib/replay/labelAssistant";
import { addMissedCandidateLabel, adjudicateLabelCandidate, getLabelReview, reviewToSessionLabels, saveGeneratedLabelReview, updateLabelSession } from "@/lib/replay/labelStore";
import type { RecordedSession } from "@/lib/replay/types";

async function authenticated() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(request: Request) {
  const { supabase, user } = await authenticated();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const date = new URL(request.url).searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date is required" }, { status: 400 });
  try {
    const review = await getLabelReview(supabase, user.id, date);
    const labels = reviewToSessionLabels(review);
    if (new URL(request.url).searchParams.get("download") === "1") {
      return NextResponse.json(labels, { headers: { "Content-Disposition": `attachment; filename="${date}-labels.json"` } });
    }
    return NextResponse.json({ review, labels });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { supabase, user } = await authenticated();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const tradingDate = String(body.tradingDate ?? "");
    if (!tradingDate) return NextResponse.json({ error: "tradingDate is required" }, { status: 400 });
    if (action === "generate") {
      const path = resolve("data", "replay", "sessions", `${tradingDate}.json.gz`);
      if (!existsSync(path)) return NextResponse.json({ error: `Recorded session not found: ${tradingDate}` }, { status: 404 });
      const session = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as RecordedSession;
      const entries = await listJournalEntries(supabase, user.id, 2_000);
      const executed = labelsFromExecutedTrades(entries, tradingDate);
      const generation = generateLabelCandidates(session, executed.labels.map((label) => label.symbol));
      await saveGeneratedLabelReview(supabase, user.id, generation, executed.labels);
      const review = await getLabelReview(supabase, user.id, tradingDate);
      return NextResponse.json({ review, skippedExecutedTrades: executed.skipped });
    }
    if (action === "manual_add") {
      await addMissedCandidateLabel(supabase, user.id, tradingDate, {
        symbol: String(body.symbol ?? ""),
        time_it_became_interesting: body.time_it_became_interesting ? String(body.time_it_became_interesting) : null,
        time_i_actually_noticed: body.time_i_actually_noticed ? String(body.time_i_actually_noticed) : null,
        direction: body.direction === "bullish" || body.direction === "bearish" ? body.direction : "mixed",
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { supabase, user } = await authenticated();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "candidate") {
      await adjudicateLabelCandidate(supabase, user.id, String(body.candidateId ?? ""), {
        decision: body.decision === "accepted" || body.decision === "rejected" || body.decision === "pending" ? body.decision : undefined,
        time_i_actually_noticed: body.time_i_actually_noticed === undefined ? undefined : body.time_i_actually_noticed ? String(body.time_i_actually_noticed) : null,
      });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "session") {
      await updateLabelSession(supabase, user.id, String(body.tradingDate ?? ""), {
        quietSession: typeof body.quietSession === "boolean" ? body.quietSession : undefined,
        reviewCompleted: typeof body.reviewCompleted === "boolean" ? body.reviewCompleted : undefined,
      });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
