import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { localRuntimeHandoffRefused, readLocalRuntimeState } from "@/lib/attention-runtime/localRuntimeHandoff";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return NextResponse.json({ snapshot: null, status: "runtime_handoff_not_configured" }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (process.env.ATTENTION_RUNTIME_STORE !== "supabase") {
    if (localRuntimeHandoffRefused()) return NextResponse.json({ snapshot: null, status: "runtime_handoff_not_configured", detail: "local_runtime_refused_in_production" }, { status: 403 });
    try {
      const snapshot = readLocalRuntimeState().snapshot;
      if (!snapshot) return NextResponse.json({ snapshot: null, status: "worker_not_registered" }, { status: 404 });
      const updatedAt = new Date(snapshot.asOf).toISOString();
      return NextResponse.json({ snapshot, instance: { engine_instance_id: snapshot.engineInstanceId, heartbeat_at: updatedAt, health: snapshot.health, ready: snapshot.ready, shadow: snapshot.shadow, updated_at: updatedAt }, updatedAt });
    } catch (error) {
      return NextResponse.json({ snapshot: null, status: "runtime_file_unreadable", detail: error instanceof Error ? error.message : String(error) }, { status: 503 });
    }
  }

  const engineInstanceId = process.env.ATTENTION_ENGINE_INSTANCE_ID;
  if (!engineInstanceId) return NextResponse.json({ snapshot: null, status: "runtime_handoff_not_configured", detail: "ATTENTION_ENGINE_INSTANCE_ID_REQUIRED" }, { status: 503 });
  const [snapshotResult, instanceResult] = await Promise.all([
    supabase.from("attention_live_snapshots").select("snapshot,updated_at").eq("engine_instance_id", engineInstanceId).maybeSingle(),
    supabase.from("attention_engine_instances").select("engine_instance_id,user_id,heartbeat_at,health,ready,shadow,updated_at,ingestion_mode,last_completed_minute").eq("engine_instance_id", engineInstanceId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (snapshotResult.error || instanceResult.error) return NextResponse.json({ snapshot: null, status: "runtime_handoff_unavailable", detail: snapshotResult.error?.message ?? instanceResult.error?.message }, { status: 503 });
  if (!snapshotResult.data?.snapshot || !instanceResult.data) return NextResponse.json({ snapshot: null, status: "worker_not_registered" }, { status: 404 });
  return NextResponse.json({ snapshot: snapshotResult.data.snapshot, instance: instanceResult.data, updatedAt: snapshotResult.data.updated_at });
}
