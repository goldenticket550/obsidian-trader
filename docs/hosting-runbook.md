# Attention Worker Hosting Runbook

## What this deploys

One Railway service runs the Attention supervisor and its child worker continuously. It polls all 68 configured symbols through Alpaca multi-symbol REST on the free IEX feed. It operates only during the regular session. It remains in shadow mode: Attention alert delivery is disabled and the legacy engine remains active.

Do not create more than one Railway replica. Do not start Railway until the Surface task is disabled.

## One-time prerequisite: durable checkpoint migration

This repository contains `supabase/migrations/0010_attention_durable_checkpoints.sql`. It is designed but has not been applied by Codex.

Before the Railway service starts:

1. Open the existing Supabase project.
2. Open **SQL Editor**.
3. Click **New query**.
4. Paste the complete contents of `supabase/migrations/0010_attention_durable_checkpoints.sql`.
5. Review it, then click **Run** once.
6. Confirm the query finishes successfully.

This makes the full engine checkpoint durable in Supabase. Without it, the hosted worker intentionally fails rather than restarting without state.

## Permanently stop the Surface writer

The exact worker task on this Surface is **ObsidianAttentionShadowWorker**.

1. Open **Task Scheduler** from the Windows Start menu.
2. Click **Task Scheduler Library**.
3. Select **ObsidianAttentionShadowWorker**.
4. In the right-hand panel click **End**.
5. Click **Disable**.
6. Confirm its status is **Disabled**, not merely Ready.
7. Leave **ObsidianAttentionShadowLivenessReport** disabled or delete it after Railway is verified; it is only a local report.
8. Open Task Manager, go to **Details**, and confirm no Node process has the command `run-attention-live-supervisor.ts`.
9. Wait at least 90 seconds (one lease TTL) before starting Railway. This allows a process that died without releasing to become claimable.

Rollback to the Surface is the reverse: stop the Railway service first, wait 90 seconds, then enable and run **ObsidianAttentionShadowWorker**. Never overlap them.

## Create Railway and connect GitHub

1. Go to https://railway.com and click **Login**.
2. Sign in with the GitHub account that can access the `obsidian-trader` repository.
3. Complete Railway account and billing setup yourself. Codex has not purchased or created anything.
4. From the Railway dashboard click **New Project**.
5. Choose **Deploy from GitHub repo**.
6. If prompted, install/authorize the Railway GitHub App for only the `obsidian-trader` repository.
7. Select `obsidian-trader`.
8. Select branch `checkpoint/attention-engine-live1` (or the branch containing the reported HOST-1 SHA).
9. Name the service **obsidian-attention-worker**.
10. Keep replicas at **1**.
11. In service **Settings**, confirm Railway detected the repository Dockerfile. The checked-in `railway.toml` supplies the start command, health path `/healthz`, and restart policy.
12. Disable automatic deployment until all variables below are entered.

Railway services linked to GitHub can autodeploy on pushes; the trigger branch and autodeploy switch live in Service Settings: https://docs.railway.com/deployments/github-autodeploys

## Set variables

Open the service, click **Variables**, then **New Variable**. Enter the following. Copy secret values from the existing secure environment; do not paste them into chat or logs.

### Required

| Variable | Required value/purpose |
|---|---|
| `ALPACA_API_KEY_ID` | Alpaca API key ID. Secret. |
| `ALPACA_API_SECRET_KEY` | Alpaca API secret. Secret. |
| `ALPACA_FEED` | Must be `iex`; startup rejects anything else. |
| `ALPACA_PAID_PLAN` | Must be `false`; no subscription is used. |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role key. Secret; never expose to the browser. |
| `ATTENTION_USER_ID` | Existing trader `auth.users` UUID that owns runtime rows. |
| `ATTENTION_RUNTIME_STORE` | Set to `supabase`; hosted state must not use a local JSON file. |
| `ATTENTION_ENGINE_INSTANCE_ID` | Set to `attention-shadow-iex-static-v1`; this is the single-writer identity. |
| `ATTENTION_BASELINE_TABLE_ID` | Set to `0bdc723e1df978fce3842255a31997e0f1b40d4f3f6c4ed85f6024b2eb817775`. Startup recomputes and verifies it. |

### Optional, with checked-in defaults

| Variable | Default | Purpose |
|---|---:|---|
| `ATTENTION_BASELINE_TABLE_PATH` | `data/replay/calibration/iex-live-baseline-table.json` | Container path to the baked calibration table. |
| `ATTENTION_THRESHOLDS_PATH` | `data/replay/reports/attention-thresholds.json` | Container path to calibrated thresholds. |
| `ATTENTION_POLL_LOOKBACK_MINUTES` | `420` | Full-session recovery lookback; values below 390 are rejected. |
| `ATTENTION_RUNTIME_DIAGNOSTICS_DIR` | `data/runtime-shadow` | Ephemeral logs/liveness files only; not engine state. |
| `ATTENTION_WORKER_RESTART_DELAY_MS` | `5000` | Delay after a failed child exits. |
| `ATTENTION_LEASE_CONFLICT_DELAY_MS` | `95000` | Delay before retrying a lease held by another writer. |
| `ATTENTION_WORKER_STALL_TIMEOUT_MS` | `180000` | Health becomes failed and a stalled child is terminated after no completed minute. |
| `ATTENTION_WORKER_STARTUP_GRACE_MS` | `600000` | Allows a bounded initial recovery before first heartbeat. |
| `ATTENTION_REPEATED_FAILURE_LIMIT` | `3` | Identical restart failures before a prominent error and failed health response. |
| `ATTENTION_HEALTH_PORT` | `8080` | Local fallback only. Railway supplies `PORT`; do not set `PORT` yourself. |

`ATTENTION_RUNTIME_STATE_PATH` is local-development-only and must not be set on Railway. No desktop notifier is required.

## Deploy and verify

1. Re-check that **ObsidianAttentionShadowWorker** is Disabled and at least 90 seconds have elapsed.
2. In Railway open the service and click **Deploy** (or enable autodeploy and choose **Deploy Latest Commit**).
3. Open **Deployments**, select the active deployment, and click **View Logs**.
4. Confirm the build passes typecheck.
5. Confirm startup logs include `health_server_started`, `supervisor_started`, `child_started`, and then `worker_heartbeat`.
6. Confirm startup does not contain `ATTENTION_BASELINE_ID_MISMATCH`, `Runtime lease is held`, or `REPEATED_WORKER_FAILURE_ESCALATION`.
7. Open the generated Railway service domain plus `/healthz`. The response must have:
   - `"healthy": true`
   - `"processAlive": true`
   - a non-null `lastCompletedMinuteAt` during regular hours
   - `"escalation": null`
8. Open the existing Obsidian site and confirm the Attention page updates once per minute.
9. Confirm it still shows **SHADOW**, **IEX PARTIAL**, and no out-of-band Attention delivery.
10. In Supabase, confirm `attention_engine_instances` has one owner and increasing `last_completed_minute`, and `attention_engine_checkpoints` gains increasing sequences.
11. Keep autodeploy disabled for the first observed session. Enable it later only if desired.

Railway healthchecks wait for an HTTP 200 and use the injected `PORT`: https://docs.railway.com/deployments/healthchecks

## Logs, restart, and stop

- **Logs:** service -> **Deployments** -> active deployment -> **View Logs**.
- **Restart:** service -> active deployment -> three-dot menu -> **Restart**. A restart restores the latest Supabase checkpoint and obtains a new fencing token.
- **Stop:** service -> **Settings** -> set replicas to zero or remove/pause the deployment. Wait 90 seconds before starting another writer.
- If logs repeat the same failure three times, `/healthz` returns 503 and logs emit `REPEATED_WORKER_FAILURE_ESCALATION`. Fix the cause; do not keep manually restarting.
- If a child is alive but stops completing minutes for 180 seconds, the supervisor terminates it and health fails so Railway can replace the service.

## Cost

Railway Hobby is a $5 monthly minimum and includes the first $5 of resource usage. Usage above $5 is billed additionally. Current published rates are approximately $10/GB-month RAM, $20/vCPU-month CPU, $0.15/GB-month volume storage, and $0.05/GB egress. An always-on Node process can exceed the included $5—especially if it holds near 0.5 GB RAM or uses sustained CPU during market hours.

Use **$5-$10/month as the initial planning range**, not a guaranteed $5 ceiling. After one full week, open Workspace **Usage** and use Railway's estimated monthly usage; Railway itself recommends a one-week observation. Set a spend alert/limit appropriate to the account.

Official references:
- https://railway.com/pricing
- https://docs.railway.com/pricing
- https://docs.railway.com/pricing/faqs
