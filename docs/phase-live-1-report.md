# Phase LIVE-1 — Supabase publication and Vercel deployment

Status: **complete**, with the physical-device limitation stated under Verification.

## Production

- Canonical URL: https://obsidian-trader-blue.vercel.app
- Vercel deployment: `dpl_9ftLXSmnUPzR8PzgfnuycV6bEAs5` (`READY`, production)
- Worker remains on Windows, supervised, free IEX REST polling, shadow mode.
- Active engine remains `legacy`; `attentionLiveAlertingEnabled=false`.

## Storage decision and measurements

The full runtime checkpoint remains in the atomically replaced local JSON mirror. Supabase receives only the current snapshot, immutable detected events, delivery envelopes (when enabled), instance health, lease and controls. `commit_attention_runtime_minute` no longer accepts or inserts a checkpoint.

- Measured regular-session checkpoint: **3,025,353 bytes**.
- Measured `processorState` within it: **3,024,570 bytes**.
- Rejected cloud design: 3,025,353 × 390 = **1,179,887,670 bytes/session** (1,125.2 MiB); at 21 sessions, **23.08 GiB/month**, before Postgres overhead.
- Cloud checkpoint after fix: **0 bytes/minute and 0 rows**.
- Measured current snapshot JSON: **1,451 bytes**, overwritten in one row rather than appended.
- Phase C sample: 94 events / 5 sessions; mean serialized event **1,972.9 bytes**, p95 2,117, max 2,133.
- Average raw event projection: about **36.2 KiB/session** and **0.74 MiB/21-session month**; allowing approximately 2× for row/index overhead remains about **1.5 MiB/month**. Outbox growth is zero while live attention delivery is disabled.

Crash recovery is covered by `tests/attentionSupabaseRuntimeStore.test.ts`: the full checkpoint stays local, a killed worker restores the exact watermark and resumes at the next sequence without replay or event loss. Mid-commit rollback restores sequence, processor and delivery state if cloud publication fails.

## Migration 0009

Applied once, transactionally, to Supabase project `nqjbxxopmcfytdtnqqac`. The transaction itself was the rollback boundary: any apply failure rolls back the whole migration.

Verified after apply:

- 7 tables
- 4 SELECT policies
- 4 functions
- ordered hot-read index on `(engine_instance_id, qualified_at desc)`
- 0 rows in `attention_engine_checkpoints`

Contact finding: PostgreSQL treated `lease_expires_at` as ambiguous inside the table-returning lease function. The function was corrected to qualify the table column and replaced transactionally. The worker then acquired and renewed the lease normally.

## Runtime and publication proof

Production engine `attention-shadow-iex-static-v1`:

- authenticated user / instance user: `e0f59fc7-c0f8-48c4-ad5d-cc256cf26e68` (exact match)
- current run: `9a62fc00-f159-420f-8659-2cba53779cd8`
- fencing token: 9
- sequence observed after final restart: 24
- health: `dark_window`; ready: false; shadow: true
- ingestion: `iex_rest_polling`
- controls: attention false, legacy true, active engine legacy
- production rows: 1 current snapshot, 0 events today, 0 outbox, 0 cloud checkpoints

Faithful recorded-session publication used the actual `AttentionLiveWorker -> SupabaseRuntimeStore -> commit_attention_runtime_minute` path under isolated instance `attention-live1-replay-verification`:

- source event: recorded Phase C `NOW_IN_PLAY` / GLD
- 1 snapshot row
- 1 event row
- 0 outbox rows (delivery disabled)

The supervisor's normalized Supabase lease-conflict path was exercised live. A replacement was refused, backed off for 95 seconds, and acquired the lease after expiry; no double writer occurred.

A dark-window restart also exposed and fixed an edge case: regular-session gap reconciliation had incorrectly been required during a multi-hour IEX dark window. The guard now applies only in the regular session. Dark-window heartbeats advance without processing or erasing processor state; regular-session gaps remain fail-closed. The regression is in `tests/attentionRuntimeOvernight.test.ts`.

## Deployed APIs and page

Final authenticated public-network verification:

- `/api/attention/live`: HTTP 200, 1,177.6 ms; pinned engine id, sequence 23 at that request, dark window, shadow true, delivery false.
- `/api/attention/events`: HTTP 200, 529.6 ms; 0 events in today's ET range.
- `/attention` with an iPhone user-agent: HTTP 200, 316.3 ms, production HTML rendered.
- unauthenticated `/api/attention/live`: HTTP 307 to sign-in.
- unauthenticated `/api/attention/events`: HTTP 307 to sign-in.

The 15-second client poll remains unchanged. Connection failure is distinct from worker failure: it displays `CONNECTION STALE` and `CONNECTION LOST — SHOWING LAST CONFIRMED DATA`, and hides rankings until cloud connectivity returns.

Current closed-market screen:

- badges: `IEX PARTIAL`, `iex_rest_polling`, `SHADOW — ON-PAGE ONLY · NO OUT-OF-BAND DELIVERY`, `CURRENT`
- header: `Market closed — regular-session scanning resumes at 09:30 ET.`
- feed badge: `MARKET CLOSED — REGULAR SESSION ONLY`
- empty state: `Market is closed. Free IEX shadow scanning resumes at 09:30 ET; no regular-session detection is running now.`
- closed panel: `Closed for the day` and the 09:30–16:00 ET regular-session statement
- latest counters at sequence 24: 0 detection-run, 0 incomplete, 24 non-regular, 0 guard-suppressed

This is a dark/non-regular window, not `QUIET — DETECTION RAN`. Today's event count is zero because LIVE-1 came up after the close; it is not evidence that the regular session was quiet.

Production cannot read the local runtime file: `data/runtime-shadow/` is excluded from the Vercel deployment, and production keeps the local handoff disabled/refused. The 1.1 GiB local archive/calibration corpus is also excluded; deployment upload fell to 5.4 MiB initially and 169 KiB incrementally.

The service role is confined to trusted server/worker code. Browser components import neither `createAdminClient` nor `SUPABASE_SERVICE_ROLE_KEY`; under `app/`, only the server route `app/api/cron/scan/route.ts` imports the admin client. User-facing attention APIs use the cookie-authenticated server client and RLS.

## Environment

Present in Vercel production (values not printed):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `ATTENTION_RUNTIME_STORE`
- `ATTENTION_ENGINE_INSTANCE_ID`
- `ATTENTION_USER_ID`
- `ALPACA_API_KEY_ID`
- `ALPACA_API_SECRET_KEY`
- `ALPACA_FEED`
- `ALPACA_PAID_PLAN`
- `CRON_SECRET`
- `ANTHROPIC_API_KEY`

`ATTENTION_USER_ID` is set in both the Windows worker environment and Vercel Production. Supabase contained exactly one user; `auth.getUser()` on an authenticated session resolved `goldenticket550@gmail.com` to `e0f59fc7-c0f8-48c4-ad5d-cc256cf26e68`, exactly matching `attention_engine_instances.user_id`.

The legacy cron returned HTTP 200 after deployment. This deployment also publishes the previously fixed legacy `computeWeightedScore` required-condition semantics for the first time while the legacy engine remains active.

## Verification

- Typecheck: clean
- Lint: clean, zero warnings
- Full suite: **134 files, 1,589 tests passed**
- Production build: successful
- Authenticated API UUID equals the engine instance UUID
- Worker PID at final verification: 7768; supervisor PID 17620; status running

Physical-device limitation: the deployed page was tested over the public production URL with an iPhone user-agent and an authenticated short-lived trader session, then that session was revoked. This workspace cannot truthfully certify that a separate physical phone/tablet was used. Opening the canonical URL on the trader's actual device remains the only manual acceptance item.

## Standing constraints

No paid data feed was purchased or enabled. Free IEX remains active. No threshold, universe entry, calibration id, score formula, scoring value, or state transition was changed. Attention delivery remains disabled and the active alert engine remains legacy.
