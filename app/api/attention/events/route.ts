import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { detectionSummary, easternDayRange, eventsForEasternDay, localRuntimeHandoffRefused, readLocalRuntimeState } from "@/lib/attention-runtime/localRuntimeHandoff";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return NextResponse.json({ events: [], status: "runtime_handoff_not_configured" }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const requestedLimit = Math.min(500, Math.max(1, Number(new URL(request.url).searchParams.get("limit") ?? 200)));
  const now = Date.now();
  const range = easternDayRange(now);

  if (process.env.ATTENTION_RUNTIME_STORE !== "supabase") {
    if (localRuntimeHandoffRefused()) return NextResponse.json({ events: [], status: "runtime_handoff_not_configured", detail: "local_runtime_refused_in_production" }, { status: 403 });
    try {
      const state = readLocalRuntimeState();
      if (!state.snapshot) return NextResponse.json({ events: [], status: "worker_not_registered" }, { status: 404 });
      return NextResponse.json({ events: eventsForEasternDay(state.events, now, requestedLimit), tradingDate: range.tradingDate, range: { startAt: range.startAt, endAt: range.endAt }, guard: state.snapshot.guard, detection: detectionSummary(state.snapshot), updatedAt: new Date(state.snapshot.asOf).toISOString() });
    } catch (error) {
      return NextResponse.json({ events: [], status: "runtime_file_unreadable", detail: error instanceof Error ? error.message : String(error) }, { status: 503 });
    }
  }

  const engineInstanceId = process.env.ATTENTION_ENGINE_INSTANCE_ID;
  if (!engineInstanceId) return NextResponse.json({ events: [], status: "runtime_handoff_not_configured", detail: "ATTENTION_ENGINE_INSTANCE_ID_REQUIRED" }, { status: 503 });
  const [eventsResult, snapshotResult, instanceResult] = await Promise.all([
    supabase.from("attention_events").select("payload").eq("engine_instance_id", engineInstanceId).gte("qualified_at", new Date(range.startAt).toISOString()).lt("qualified_at", new Date(range.endAt).toISOString()).order("qualified_at", { ascending: false }).limit(requestedLimit),
    supabase.from("attention_live_snapshots").select("snapshot,updated_at").eq("engine_instance_id", engineInstanceId).maybeSingle(),
    supabase.from("attention_engine_instances").select("engine_instance_id,user_id").eq("engine_instance_id", engineInstanceId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (eventsResult.error || snapshotResult.error || instanceResult.error) return NextResponse.json({ events: [], status: "runtime_handoff_unavailable", detail: eventsResult.error?.message ?? snapshotResult.error?.message ?? instanceResult.error?.message }, { status: 503 });
  if (!instanceResult.data || !snapshotResult.data?.snapshot) return NextResponse.json({ events: [], status: "worker_not_registered" }, { status: 404 });
  const snapshot = snapshotResult.data.snapshot;
  return NextResponse.json({ events: (eventsResult.data ?? []).map((row) => row.payload), tradingDate: range.tradingDate, range: { startAt: range.startAt, endAt: range.endAt }, guard: snapshot.guard, detection: detectionSummary(snapshot), updatedAt: snapshotResult.data.updated_at });
}
