# Live Attention session runbook (local shadow)

This procedure runs the free-IEX shadow worker and the production-built dashboard locally on the Surface. It does not deploy, enable out-of-band delivery, apply a migration, or purchase data.

## Before the session

Open PowerShell in `C:\Users\golde\projects\obsidian-trader`. Confirm the normal local environment variables are present, including Alpaca free-IEX credentials and the existing Supabase browser-auth variables.

Build the dashboard before starting the market-hours session:

```powershell
$env:ATTENTION_LOCAL_RUNTIME_HANDOFF_ENABLED = "true"
npm run build
```

The explicit variable permits the local `next start` process to read the host runtime file. A deployed production environment is still refused.

## Start the two long-running processes

In PowerShell window 1:

```powershell
cd C:\Users\golde\projects\obsidian-trader
npm run runtime:worker
```

In PowerShell window 2:

```powershell
cd C:\Users\golde\projects\obsidian-trader
$env:ATTENTION_LOCAL_RUNTIME_HANDOFF_ENABLED = "true"
npm run start
```

Leave both windows running. The supervisor restarts the worker if its child exits; the fencing lease prevents a second writer.

## Sign in, then open the page

1. Open [http://localhost:3000/login](http://localhost:3000/login).

## Read-only viewer administration

Run viewer administration only on the trusted owner machine; it uses the server-only service-role credential from `.env.local` and never prints it.

- Grant with an optional invitation attempt: `npm run attention:viewer -- grant person@example.com`
- Grant without sending email: `npm run attention:viewer -- grant person@example.com --no-invite`
- List: `npm run attention:viewer -- list`
- Revoke: `npm run attention:viewer -- revoke person@example.com`
- Verify production: `npx tsx scripts/verify-attention-viewer-access.ts person@example.com https://obsidian-trader-blue.vercel.app`

Grant first finds or creates the auth identity without sending email, then independently upserts the durable `viewer` membership with `ATTENTION_USER_ID` as grantor. A normal grant attempts an invitation only after membership succeeds. Mail failure is reported as `invitationSent: false` with `invitationReason`, but the membership remains active. Repeating a grant updates the same membership and is safe.

An invitation is not required. A viewer who has membership can open `/login?redirectTo=/attention`, enter their email, and request their own magic link. Use `--no-invite` as the normal path when adding several people at once or whenever Supabase's administrative mail quota is constrained; it sends nothing and reports the resulting `userId` and `role`.

The viewer sees only `/attention` in navigation. RLS, not navigation, denies every private table and every write. The canonical owner cannot be revoked by the script. See `docs/attention-viewer-access.md` for the full matrix and verifier behavior.

At the LIVE-2 check, Supabase signup was open (`disable_signup=false`). A stranger can create an auth account but has no data access without membership. To make creation invitation-only, disable new-user signup in Supabase Auth and keep the owner-issued admin invitation as the provisioning path; retest invitations after changing that setting.
2. Request and complete the magic-link sign-in. The callback must finish before opening the live page.
3. Open [http://localhost:3000/attention](http://localhost:3000/attention).

## What working looks like in the first two minutes

- During the regular session, the health badge reads `CURRENT` after the first completed minute.
- The `Last updated HH:MM:SS ET` field advances after each 15-second page refresh. It is independent of the snapshot watermark.
- The persistent mode badge reads `SHADOW — ON-PAGE ONLY · NO OUT-OF-BAND DELIVERY`.
- The latest-minute detection badge reads either `QUIET — DETECTION RAN`, a non-zero detected count, or `DETECTION SUPPRESSED — <reason>`. Suppressed is unavailable, not quiet.
- The ranked table is visible only while the snapshot is current. The Live Alerts feed remains visible if the worker becomes stale, the window is dark, or ingestion is degraded.
- `liveDeliveryEnabled` remains false in the worker state and `envelopesCreated` remains 0.

If the page says `SIGNED OUT — SIGN IN AGAIN`, repeat the login flow. If it says `WORKER DOWN`, inspect `data/runtime-shadow/worker-liveness.log` and `data/runtime-shadow/supervisor.log`; do not trust the last ranked snapshot as live.
