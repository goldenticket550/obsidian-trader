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

The full processor checkpoint now persists in Supabase. Migration `0010_attention_durable_checkpoints.sql` is checked in but intentionally not applied.
