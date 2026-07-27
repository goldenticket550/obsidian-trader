import { NextResponse } from "next/server";
import { getAlertStore } from "@/lib/alerts/alertStore";
import { getRecentAlertEvents } from "@/lib/alerts/persistentAlertStore";
import { createClient } from "@/lib/supabase/server";

function supabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export async function GET() {
  if (!supabaseConfigured()) {
    const store = getAlertStore();
    return NextResponse.json({ events: store.getRecentEvents(100) });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const events = await getRecentAlertEvents(supabase, user.id, 100);
    return NextResponse.json({ events });
  } catch (error) {
    // Log the full error (with stack) server-side so it lands in Vercel's
    // function logs — the response body only carries the message string, so
    // without this the real cause is invisible in Observability. No user id,
    // token, or PII is logged, only the DB/library error itself.
    console.error("[api/alerts] getRecentAlertEvents failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
