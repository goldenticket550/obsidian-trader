import { createAdminClient } from "../lib/supabase/admin";
import { loadEnvLocal } from "../lib/replay/env";

type Operation = "grant" | "revoke" | "list";

interface Options {
  operation: Operation;
  email: string | null;
  engineInstanceId: string;
  ownerId: string;
  redirectTo: string;
}

function optionsFromArgs(): Options {
  loadEnvLocal();
  const [command, rawEmail] = process.argv.slice(2);
  if (command !== "grant" && command !== "revoke" && command !== "list") {
    throw new Error("Usage: npm run attention:viewer -- <grant|revoke|list> [email]");
  }
  const email = rawEmail?.trim().toLowerCase() ?? null;
  if (command !== "list" && !email) throw new Error(`${command} requires an email address.`);
  const engineInstanceId = process.env.ATTENTION_ENGINE_INSTANCE_ID;
  const ownerId = process.env.ATTENTION_USER_ID;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  if (!engineInstanceId || !ownerId) throw new Error("ATTENTION_ENGINE_INSTANCE_ID and ATTENTION_USER_ID are required.");
  return {
    operation: command,
    email,
    engineInstanceId,
    ownerId,
    redirectTo: `${siteUrl.replace(/\/$/, "")}/auth/callback?redirectTo=%2Fattention`,
  };
}

async function findUserByEmail(email: string) {
  const admin = createAdminClient();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 1_000) return null;
  }
}

async function assertOwner(engineInstanceId: string, ownerId: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("attention_engine_instances")
    .select("engine_instance_id,user_id")
    .eq("engine_instance_id", engineInstanceId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`ATTENTION_USER_ID does not own ${engineInstanceId}; refusing administrative change.`);
}

async function main(): Promise<void> {
  const options = optionsFromArgs();
  const admin = createAdminClient();
  await assertOwner(options.engineInstanceId, options.ownerId);

  if (options.operation === "list") {
    const { data, error } = await admin
      .from("attention_engine_memberships")
      .select("user_id,role,granted_by,granted_at")
      .eq("engine_instance_id", options.engineInstanceId)
      .order("granted_at");
    if (error) throw error;
    const users = await Promise.all((data ?? []).map(async (membership) => {
      const { data: userResult, error: userError } = await admin.auth.admin.getUserById(membership.user_id);
      if (userError) throw userError;
      return { email: userResult.user.email ?? "(no email)", ...membership };
    }));
    console.table(users);
    return;
  }

  const email = options.email!;
  let user = await findUserByEmail(email);
  let invitationSent = false;
  if (options.operation === "grant" && !user) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: options.redirectTo });
    if (error) throw error;
    user = data.user;
    invitationSent = true;
  }

  if (!user) {
    console.log(JSON.stringify({ operation: "revoke", email, engineInstanceId: options.engineInstanceId, removed: false, reason: "auth_user_not_found" }));
    return;
  }
  if (user.id === options.ownerId) throw new Error("The canonical owner cannot be granted or revoked as a viewer.");

  if (options.operation === "grant") {
    const { error } = await admin.from("attention_engine_memberships").upsert({
      engine_instance_id: options.engineInstanceId,
      user_id: user.id,
      role: "viewer",
      granted_by: options.ownerId,
    }, { onConflict: "engine_instance_id,user_id" });
    if (error) throw error;
    console.log(JSON.stringify({ operation: "grant", email, userId: user.id, engineInstanceId: options.engineInstanceId, role: "viewer", invitationSent, redirectTo: "/attention" }));
    return;
  }

  const { error, count } = await admin
    .from("attention_engine_memberships")
    .delete({ count: "exact" })
    .eq("engine_instance_id", options.engineInstanceId)
    .eq("user_id", user.id);
  if (error) throw error;
  console.log(JSON.stringify({ operation: "revoke", email, userId: user.id, engineInstanceId: options.engineInstanceId, removed: (count ?? 0) > 0 }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
