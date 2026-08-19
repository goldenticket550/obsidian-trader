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
