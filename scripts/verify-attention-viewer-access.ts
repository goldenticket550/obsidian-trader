import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "../lib/supabase/admin";
import { loadEnvLocal } from "../lib/replay/env";

const SCANNER_READ_TABLES = [
  "attention_engine_instances",
  "attention_live_snapshots",
  "attention_events",
  "attention_engine_memberships",
] as const;

const PRIVATE_TABLES = [
  "alert_events",
  "attention_delivery_outbox",
  "attention_engine_checkpoints",
  "attention_ingestion_audit",
  "attention_runtime_controls",
  "core_signal_outbox",
  "daily_trading_status",
  "risk_settings",
  "scan_snapshots",
  "strategy_configs",
  "trade_journal_entries",
  "trader_run_reports",
  "watchlist_symbols",
  "watchlists",
] as const;

const ALL_TABLES = [...SCANNER_READ_TABLES, ...PRIVATE_TABLES] as const;

async function findUser(email: string) {
  const admin = createAdminClient();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 1_000) throw new Error(`No auth user exists for ${email}. Grant the viewer first.`);
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: npx tsx scripts/verify-attention-viewer-access.ts <email> [site-url]");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const engineInstanceId = process.env.ATTENTION_ENGINE_INSTANCE_ID;
  const siteUrl = process.argv[3]?.trim() || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  if (!url || !anonKey || !engineInstanceId) throw new Error("Supabase and attention runtime environment are required.");

  const admin = createAdminClient();
  const user = await findUser(email);
  const { data: membership, error: membershipError } = await admin
    .from("attention_engine_memberships")
    .select("role")
    .eq("engine_instance_id", engineInstanceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (membership?.role !== "viewer") throw new Error(`${email} is not a viewer of ${engineInstanceId}.`);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${siteUrl.replace(/\/$/, "")}/auth/callback?redirectTo=%2Fattention` },
  });
  if (linkError) throw linkError;
  const tokenHash = link.properties.hashed_token;
  if (!tokenHash) throw new Error("Supabase did not return a hashed magic-link token.");

  const viewer = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sessionData, error: verifyError } = await viewer.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyError || !sessionData.session || !sessionData.user || sessionData.user.id !== user.id) {
    throw verifyError ?? new Error("Magic-link session did not resolve to the invited viewer.");
  }

  const responseCookies: Array<{ name: string; value: string }> = [];
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => { responseCookies.splice(0, responseCookies.length, ...cookies); },
    },
  });
  const { error: sessionCookieError } = await ssr.auth.setSession({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  });
  if (sessionCookieError || responseCookies.length === 0) {
    throw sessionCookieError ?? new Error("Supabase SSR session cookies were not created.");
  }
  const cookieHeader = responseCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  const productionOrigin = siteUrl.replace(/\/$/, "");
  const productionResponses = await Promise.all([
    fetch(`${productionOrigin}/attention`, { headers: { cookie: cookieHeader }, redirect: "manual" }),
    fetch(`${productionOrigin}/api/attention/access`, { headers: { cookie: cookieHeader } }),
    fetch(`${productionOrigin}/api/attention/live`, { headers: { cookie: cookieHeader } }),
    fetch(`${productionOrigin}/api/attention/events?limit=200`, { headers: { cookie: cookieHeader } }),
    fetch(`${productionOrigin}/api/labels?date=2026-08-19`, { headers: { cookie: cookieHeader } }),
  ]);
  const [pageResponse, accessResponse, liveResponse, eventsResponse, labelsResponse] = productionResponses;
  const pageHtml = await pageResponse.text();
  const [accessText, liveText, eventsText] = await Promise.all([accessResponse.text(), liveResponse.text(), eventsResponse.text()]);
  const parseJson = <T>(response: Response, body: string): T | null => response.headers.get("content-type")?.includes("application/json") ? JSON.parse(body) as T : null;
  const accessBody = parseJson<{ role?: string }>(accessResponse, accessText);
  const liveBody = parseJson<{ snapshot?: { sequence?: number; health?: string; shadow?: boolean; liveDeliveryEnabled?: boolean; statusMessage?: string; feedBadge?: string; ingestionMode?: string; darkWindowReason?: string | null } }>(liveResponse, liveText);
  const eventsBody = parseJson<{ events?: unknown[]; detection?: { status?: string; reason?: string | null } }>(eventsResponse, eventsText);
  if (pageResponse.status !== 200 || !pageHtml.includes("Live Attention") || accessResponse.status !== 200 || accessBody?.role !== "viewer" || liveResponse.status !== 200 || !liveBody?.snapshot || eventsResponse.status !== 200 || labelsResponse.status !== 403) {
    throw new Error(`Production viewer E2E failed: ${JSON.stringify({ cookies: responseCookies.map((cookie) => ({ name: cookie.name, length: cookie.value.length })), page: pageResponse.status, pageLocation: pageResponse.headers.get("location"), pageRendered: pageHtml.includes("Live Attention"), access: accessResponse.status, accessType: accessResponse.headers.get("content-type"), role: accessBody?.role, live: liveResponse.status, liveType: liveResponse.headers.get("content-type"), events: eventsResponse.status, eventsType: eventsResponse.headers.get("content-type"), labels: labelsResponse.status })}`);
  }
  const scannerReads: Record<string, number> = {};
  for (const table of SCANNER_READ_TABLES) {
    let query = viewer.from(table).select("*", { count: "exact", head: true });
    if (table !== "attention_engine_memberships") query = query.eq("engine_instance_id", engineInstanceId);
    else query = query.eq("engine_instance_id", engineInstanceId).eq("user_id", user.id);
    const { count, error } = await query;
    if (error) throw new Error(`Viewer scanner read failed for ${table}: ${error.message}`);
    scannerReads[table] = count ?? 0;
  }
  if (scannerReads.attention_engine_instances !== 1 || scannerReads.attention_live_snapshots !== 1 || scannerReads.attention_engine_memberships !== 1) {
    throw new Error(`Viewer scanner read counts are incomplete: ${JSON.stringify(scannerReads)}`);
  }

  // Seed one viewer-owned private row with the service role. If the private-table
  // restrictive SELECT/UPDATE/DELETE policies are missing, this probe exposes it.
  const probeName = `LIVE2-RLS-${randomUUID()}`;
  const { data: probe, error: probeError } = await admin
    .from("watchlists")
    .insert({ user_id: user.id, name: probeName })
    .select("id,name")
    .single();
  if (probeError) throw probeError;

  try {
    const privateReads: Record<string, number> = {};
    for (const table of PRIVATE_TABLES) {
      const { count, error } = await viewer.from(table).select("*", { count: "exact", head: true });
      if (error) throw new Error(`Private read probe errored for ${table}: ${error.message}`);
      privateReads[table] = count ?? 0;
      if ((count ?? 0) !== 0) throw new Error(`Viewer read ${count} row(s) from private table ${table}.`);
    }

    const deniedInserts: Record<string, string> = {};
    for (const table of ALL_TABLES) {
      const { error } = await viewer.from(table).insert({});
      if (!error) throw new Error(`Viewer INSERT unexpectedly succeeded on ${table}.`);
      deniedInserts[table] = error.code ?? "denied";
    }

    const { data: updateRows, error: updateError } = await viewer
      .from("watchlists")
      .update({ name: `${probeName}-changed` })
      .eq("id", probe.id)
      .select("id");
    if (updateError || (updateRows?.length ?? 0) !== 0) {
      throw new Error(`Viewer private UPDATE was not a clean RLS no-op: ${updateError?.message ?? JSON.stringify(updateRows)}`);
    }
    const { data: deleteRows, error: deleteError } = await viewer
      .from("watchlists")
      .delete()
      .eq("id", probe.id)
      .select("id");
    if (deleteError || (deleteRows?.length ?? 0) !== 0) {
      throw new Error(`Viewer private DELETE was not a clean RLS no-op: ${deleteError?.message ?? JSON.stringify(deleteRows)}`);
    }
    const { data: preserved, error: preservedError } = await admin.from("watchlists").select("name").eq("id", probe.id).single();
    if (preservedError || preserved.name !== probeName) throw new Error("Private probe row changed despite viewer write denial.");

    const { error: membershipUpdateError } = await viewer
      .from("attention_engine_memberships")
      .update({ role: "owner" })
      .eq("engine_instance_id", engineInstanceId)
      .eq("user_id", user.id);
    const { error: membershipDeleteError } = await viewer
      .from("attention_engine_memberships")
      .delete()
      .eq("engine_instance_id", engineInstanceId)
      .eq("user_id", user.id);
    if (!membershipUpdateError || !membershipDeleteError) throw new Error("Viewer changed its scanner membership.");

    console.log(JSON.stringify({
      email, userId: user.id, engineInstanceId,
      magicLinkSession: "verified",
      scannerReads,
      privateReads,
      deniedInsertTables: Object.keys(deniedInserts).length,
      privateUpdate: "denied",
      privateDelete: "denied",
      membershipUpdate: "denied",
      membershipDelete: "denied",
      production: {
        origin: productionOrigin,
        attentionPageStatus: pageResponse.status,
        attentionPageRendered: true,
        accessStatus: accessResponse.status,
        role: accessBody.role,
        liveStatus: liveResponse.status,
        eventsStatus: eventsResponse.status,
        labelsStatus: labelsResponse.status,
        snapshot: liveBody.snapshot,
        eventCount: eventsBody?.events?.length ?? 0,
        detection: eventsBody?.detection ?? null,
      },
    }, null, 2));
  } finally {
    await admin.from("watchlists").delete().eq("id", probe.id);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
