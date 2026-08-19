import type { SupabaseClient } from "@supabase/supabase-js";

export type AttentionAccessRole = "owner" | "viewer";

export interface AttentionAccess {
  engineInstanceId: string;
  role: AttentionAccessRole;
}

export async function resolveAttentionAccess(
  supabase: SupabaseClient,
  userId: string,
  engineInstanceId: string,
): Promise<AttentionAccess | null> {
  const { data: instance, error: instanceError } = await supabase
    .from("attention_engine_instances")
    .select("engine_instance_id,user_id")
    .eq("engine_instance_id", engineInstanceId)
    .maybeSingle();

  if (instanceError) throw new Error(`Attention access lookup failed: ${instanceError.message}`);
  if (!instance) return null;
  if (instance.user_id === userId) return { engineInstanceId, role: "owner" };

  const { data: membership, error: membershipError } = await supabase
    .from("attention_engine_memberships")
    .select("role")
    .eq("engine_instance_id", engineInstanceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) throw new Error(`Attention membership lookup failed: ${membershipError.message}`);
  if (membership?.role !== "owner" && membership?.role !== "viewer") return null;
  return { engineInstanceId, role: membership.role };
}

export function configuredAttentionEngineInstanceId(): string | null {
  return process.env.ATTENTION_ENGINE_INSTANCE_ID ?? null;
}
