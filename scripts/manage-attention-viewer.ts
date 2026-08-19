import { createAdminClient } from "../lib/supabase/admin";
import { loadEnvLocal } from "../lib/replay/env";
import { grantAttentionViewer } from "../lib/attention-runtime/viewerGrant";

type Operation = "grant" | "revoke" | "list";

interface Options {
  operation: Operation;
  email: string | null;
  engineInstanceId: string;
  ownerId: string;
  redirectTo: string;
  noInvite: boolean;
}

function optionsFromArgs(): Options {
  loadEnvLocal();
  const [command, ...rawArgs] = process.argv.slice(2);
  if (command !== "grant" && command !== "revoke" && command !== "list") {
    throw new Error("Usage: npm run attention:viewer -- <grant|revoke|list> [email] [--no-invite]");
  }
  const noInvite = rawArgs.includes("--no-invite");
  if (noInvite && command !== "grant") throw new Error("--no-invite is valid only with grant.");
  const positionalArgs = rawArgs.filter((argument) => argument !== "--no-invite");
  if (positionalArgs.length > 1) throw new Error(`Unexpected arguments: ${positionalArgs.slice(1).join(" ")}`);
  const [rawEmail] = positionalArgs;
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
    noInvite,
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

  if (options.operation === "grant") {
    const result = await grantAttentionViewer({
      email,
      engineInstanceId: options.engineInstanceId,
      ownerId: options.ownerId,
      redirectTo: options.redirectTo,
      noInvite: options.noInvite,
    }, {
      findUserByEmail: async () => user,
      createUserWithoutEmail: async (newEmail) => {
        const { data, error } = await admin.auth.admin.createUser({
          email: newEmail,
          email_confirm: true,
        });
        if (error) throw error;
        user = data.user;
        return data.user;
      },
      upsertMembership: async (membership) => {
        const { error } = await admin.from("attention_engine_memberships").upsert({
          engine_instance_id: membership.engineInstanceId,
          user_id: membership.userId,
          role: membership.role,
          granted_by: membership.grantedBy,
        }, { onConflict: "engine_instance_id,user_id" });
        if (error) throw error;
      },
      sendInvitation: async (invitationEmail, redirectTo) => {
        const { error } = await admin.auth.admin.inviteUserByEmail(invitationEmail, { redirectTo });
        if (error) throw error;
      },
    });
    console.log(JSON.stringify(result));
    return;
  }

  if (!user) {
    console.log(JSON.stringify({ operation: "revoke", email, engineInstanceId: options.engineInstanceId, removed: false, reason: "auth_user_not_found" }));
    return;
  }
  if (user.id === options.ownerId) throw new Error("The canonical owner cannot be granted or revoked as a viewer.");


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
