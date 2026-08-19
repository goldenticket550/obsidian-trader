import { NextResponse } from "next/server";
import { configuredAttentionEngineInstanceId, resolveAttentionAccess } from "@/lib/attention-runtime/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ role: null, status: "runtime_handoff_not_configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const engineInstanceId = configuredAttentionEngineInstanceId();
  if (!engineInstanceId) {
    return NextResponse.json({ role: null, status: "runtime_handoff_not_configured" }, { status: 503 });
  }
  try {
    const access = await resolveAttentionAccess(supabase, user.id, engineInstanceId);
    if (!access) return NextResponse.json({ role: null, status: "attention_access_denied" }, { status: 403 });
    return NextResponse.json({ role: access.role, engineInstanceId: access.engineInstanceId });
  } catch (error) {
    return NextResponse.json({ role: null, status: "attention_access_unavailable", detail: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
