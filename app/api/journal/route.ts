import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listJournalEntries, createJournalEntry } from "@/lib/journal/queries";
import type { NewJournalEntry } from "@/types/journal";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const entries = await listJournalEntries(supabase, user.id);
    return NextResponse.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const body = (await request.json()) as NewJournalEntry;

    if (!body.symbol?.trim()) {
      return NextResponse.json({ error: "Symbol is required" }, { status: 400 });
    }
    if (!body.tradeDate) {
      return NextResponse.json({ error: "Trade date is required" }, { status: 400 });
    }
    if (!body.entryTime || !Number.isFinite(Date.parse(body.entryTime))) {
      return NextResponse.json({ error: "Actual entry time is required" }, { status: 400 });
    }
    if (typeof body.entryPrice !== "number" || typeof body.positionSize !== "number") {
      return NextResponse.json(
        { error: "Entry price and position size are required numbers" },
        { status: 400 }
      );
    }

    const entry = await createJournalEntry(supabase, user.id, body);
    return NextResponse.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
