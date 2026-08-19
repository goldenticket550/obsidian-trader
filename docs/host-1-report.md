# HOST-1 Implementation Report

## Safety state

- Attention live alerting remains disabled.
- The active alert engine remains legacy.
- Feed remains free IEX through multi-symbol REST polling.
- No subscription, hosting account, deployment, or migration was purchased or applied.
- No universe, calibration, threshold, scoring, or state-machine value changed.

## Lease rule

A worker earns lease renewal only after productive work:

1. A normal cycle first commits its minute under the existing fencing token, then renews.
2. A long recovery may renew only after each recovery minute processes successfully.
3. Any cycle exception releases the lease immediately and exits the child.
4. The TTL is the crash-only fallback when a process cannot execute release.
5. Every commit still verifies owner run ID, fencing token, and unexpired lease.

This prevents a live-but-failing process from renewing forever while preserving a productive holder.

## Supervisor

The supervisor exposes `GET /healthz` with process status, last heartbeat, and last completed minute. It terminates a child that has not completed work within the configured stall window. Three identical failures trigger a prominent `REPEATED_WORKER_FAILURE_ESCALATION`, make health fail, and remain visible in host logs.

## Session-boundary coverage gap

The prior tests covered isolated calendar facts but did not cover recovery as one continuous lifecycle. The missing matrix was:

- prior-day regular checkpoint -> midnight/date rollover -> unsupported IEX dark window -> next open;
- recovery start selection when the durable watermark is from a dark or prior-date snapshot;
- polling lookback large enough to prove continuity back to the regular open;
- restart state continuity across those boundaries.

Coverage now lives across:
- `attentionRuntimeOvernight.test.ts`
- `attentionRuntimeStateContinuity.test.ts`
- `attentionRuntimeOpeningAvailability.test.ts`
- `attentionRuntimeLeaseProductivity.test.ts`
- `liveAttentionPage.test.tsx`

The host rejects a polling lookback below 390 minutes, uses 420 by default, and the dashboard determines open/closed from the current exchange calendar rather than stale detection state.

## Hosting and artifacts

Railway uses the checked-in Dockerfile and `railway.toml`. The exact 20.8 MB live baseline is stored as a normal Git blob for this path and baked into the container; this avoids Railway/Git-LFS checkout ambiguity and avoids boot-time network/object-storage dependencies. Startup parses it, recomputes its content identity, and requires table ID:

`0bdc723e1df978fce3842255a31997e0f1b40d4f3f6c4ed85f6024b2eb817775`

Thresholds and the typed universe are also baked from the same commit. A missing file, malformed table, or identity mismatch is fatal before a lease is acquired.

The full processor checkpoint is designed to persist in Supabase through `0012_attention_durable_checkpoints.sql`, which remains intentionally unapplied.

## Checkpoint retention correction

The measured latest local checkpoint is 4,357,293 UTF-8 bytes (4.16 MiB); 4,356,034 bytes are processor state. Without pruning, 390 regular-session commits would write and retain about 1.58 GiB per session and 33.24 GiB over 21 sessions.

Retention is three rows per engine: current plus two preceding durable boundaries. Three supports immediate recovery and leaves two forensic/fallback boundaries without pretending the database is a history store. Pruning occurs in the same fenced transaction as insertion.

Conservative logical retained size is approximately 12.47 MiB, with a momentary pre-delete maximum of 16.62 MiB. Logical retained growth after the third commit is zero per day and zero per month; PostgreSQL row/index overhead and vacuum lag are additional, while JSONB TOAST compression may reduce physical size. Write churn remains approximately 1.58 GiB per full session, but it no longer accumulates as retained table data.

A restart regression commits five minutes, verifies only sequences 3/4/5 remain, kills the holder, restores sequence 5 in a fresh worker, commits minute 6, and verifies retained sequences 4/5/6 with six unique events—no loss and no replay.

## Migration order and production status

The production migration ledger was read-only audited and is currently empty. Representative production-object probes confirm the SQL effects through viewer membership are present; the commit RPC OpenAPI schema confirms only the old six-argument function exists, and the checkpoint table has zero rows.

| Version | Migration | Production status |
|---|---|---|
| 0001 | watchlist and config | Applied manually; object present |
| 0002 | risk and daily status | Applied manually; object present |
| 0003 | trade journal | Applied manually; object present |
| 0004 | background scanning | Applied manually; objects present |
| 0005 | scan snapshot RLS fix | Applied as part of the working production scanner policy |
| 0006 | minimum setup-score clamp | Applied in the production risk schema |
| 0007 | scan snapshot updated-at trigger | Applied in the working production scan path |
| 0008 | core reporting outbox | Applied manually; both tables present |
| 0009 | label assistant | Applied manually; all three label tables present |
| 0010 | Attention live runtime | Applied manually; runtime tables present and six-argument RPC exposed |
| 0011 | Attention viewer membership | Applied manually; membership table present |
| 0012 | retained durable checkpoints | **Not applied**; seven-argument RPC absent; zero checkpoint rows |

The runbook first repairs ledger versions 0001-0011 as applied, then pushes only 0012. This prevents an applied migration from rerunning and prevents 0012 from being skipped.

## Event payload contract

Storing the whole event is intentional and matches production data. A read-only production probe found outer keys `eventId/type/symbol/qualifiedAt/emittedAt/payload`, with score, freshness and context under the nested `payload`. The API selects the database `payload` column as an event and the UI reads `event.payload`.

Migration 0012 therefore inserts `e`, not `e->'payload'`. Migration and UI tests fail if this regresses to the nested payload only.
